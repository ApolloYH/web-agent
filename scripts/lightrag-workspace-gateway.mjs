import { createServer, request as proxyRequest } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { handleAnthropicChat } from './openai-anthropic-adapter.mjs';

const host = '127.0.0.1';
const port = Number(process.env.LIGHTRAG_GATEWAY_PORT || 9700);
const maxInstances = Number(process.env.LIGHTRAG_MAX_WORKSPACES || 3);
const idleMs = Number(process.env.LIGHTRAG_WORKSPACE_IDLE_MS || 1_800_000);
const binary = process.env.LIGHTRAG_SERVER_BIN || '/opt/apollo-rag/lightrag/.venv/bin/lightrag-server';
const storage = process.env.LIGHTRAG_STORAGE_DIR || '/opt/apollo-rag/shared/lightrag/storage';
const input = process.env.LIGHTRAG_INPUT_DIR || '/opt/apollo-rag/shared/lightrag/input';
const promptRoot = process.env.LIGHTRAG_PROMPT_DIR || `${storage}/prompts`;
const promptSample = process.env.LIGHTRAG_PROMPT_SAMPLE || `${process.cwd()}/prompts/samples/entity_type_prompt.sample.yml`;
const instances = new Map();
let nextPort = Number(process.env.LIGHTRAG_WORKSPACE_PORT_START || 9800);
let launchQueue = Promise.resolve();

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function ready(instance) {
  const deadline = Date.now() + 240_000;
  while (Date.now() < deadline) {
    if (instance.exited) throw new Error('LightRAG workspace exited during startup');
    try {
      const response = await fetch(`http://${host}:${instance.port}/health`, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return;
    } catch { /* still starting */ }
    await delay(2_000);
  }
  throw new Error('LightRAG workspace startup timed out');
}

function stop(instance) {
  instance.exited = true;
  instance.process.kill('SIGTERM');
  if (instances.get(instance.workspace) === instance) instances.delete(instance.workspace);
}

function parseBuildConfig(headers) {
  const encoded = headers['x-apollo-lightrag-config'];
  if (!encoded) return null;
  if (typeof encoded !== 'string' || encoded.length > 8_000) throw new Error('invalid LightRAG build config');
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    throw new Error('invalid LightRAG build config');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid LightRAG build config');
  const entityTypes = typeof parsed.entityTypes === 'string' ? parsed.entityTypes.trim() : '';
  const relationConfig = typeof parsed.relationConfig === 'string' ? parsed.relationConfig.trim() : '';
  const maxExtractionEntities = Number(parsed.maxExtractionEntities || 0);
  if (entityTypes.length > 1_000 || relationConfig.length > 4_000 || !Number.isInteger(maxExtractionEntities) || maxExtractionEntities < 0 || maxExtractionEntities > 500) throw new Error('invalid LightRAG build config');
  return entityTypes || relationConfig || maxExtractionEntities ? { entityTypes, relationConfig, maxExtractionEntities } : null;
}

async function promptProfile(workspace, config) {
  if (!config?.entityTypes && !config?.relationConfig) return '';
  const sample = await readFile(promptSample, 'utf8');
  const examplesIndex = sample.indexOf('entity_extraction_examples:');
  if (examplesIndex < 0) throw new Error('LightRAG prompt sample is invalid');
  const examples = sample.slice(examplesIndex);
  const guidance = [
    config.entityTypes ? `Classify entities using these types:\n${config.entityTypes.split(/\r?\n/).filter(Boolean).map((item) => `- ${item}`).join('\n')}` : 'Classify each entity using the most specific semantic type.',
    config.relationConfig ? `Relationship extraction guidance:\n${config.relationConfig}` : '',
  ].filter(Boolean).join('\n\n');
  const directory = `${promptRoot}/entity_type`;
  const fileName = `apollo-${workspace}.yml`;
  await mkdir(directory, { recursive: true });
  await writeFile(`${directory}/${fileName}`, `entity_types_guidance: |\n${guidance.split('\n').map((line) => `  ${line}`).join('\n')}\n${examples}`, { mode: 0o600 });
  return fileName;
}

async function workspaceInstance(workspace, config) {
  const previousLaunch = launchQueue;
  let releaseLaunch;
  launchQueue = new Promise((resolve) => { releaseLaunch = resolve; });
  await previousLaunch;

  let instance;
  try {
    const signature = config ? JSON.stringify(config) : '';
    const existing = instances.get(workspace);
    if (existing && !existing.exited) {
      if (!config || existing.signature === signature) {
        existing.lastUsed = Date.now();
        instance = existing;
      } else {
        if (existing.active) throw new Error('LightRAG workspace is busy');
        stop(existing);
      }
    }
    if (!instance) {
      if (instances.size >= maxInstances) {
        const candidate = [...instances.values()].filter((item) => item.active === 0 && Date.now() - item.lastUsed >= idleMs).sort((a, b) => a.lastUsed - b.lastUsed)[0];
        if (!candidate) throw new Error('LightRAG workspace capacity reached');
        stop(candidate);
      }
      await mkdir(`${input}/${workspace}`, { recursive: true });
      const profile = await promptProfile(workspace, config);
      const childPort = nextPort++;
      const childEnv = { ...process.env };
      if (config?.maxExtractionEntities) childEnv.MAX_EXTRACTION_ENTITIES = String(config.maxExtractionEntities);
      if (profile) { childEnv.PROMPT_DIR = promptRoot; childEnv.ENTITY_TYPE_PROMPT_FILE = profile; }
      const child = spawn(binary, [
        '--host', host, '--port', String(childPort), '--workspace', workspace,
        '--working-dir', storage, '--input-dir', input, '--workers', '1', '--max-async', '2',
      ], { env: childEnv, stdio: 'inherit' });
      instance = { workspace, signature, port: childPort, process: child, active: 0, lastUsed: Date.now(), exited: false };
      child.once('exit', () => { instance.exited = true; if (instances.get(workspace) === instance) instances.delete(workspace); });
      child.once('error', () => { instance.exited = true; if (instances.get(workspace) === instance) instances.delete(workspace); });
      instance.starting = ready(instance).catch((error) => { stop(instance); throw error; });
      instances.set(workspace, instance);
    }
  } finally {
    releaseLaunch();
  }
  await instance.starting;
  return instance;
}

function proxy(req, res, instance, path) {
  instance.active += 1;
  instance.lastUsed = Date.now();
  let released = false;
  const release = () => { if (!released) { released = true; instance.active -= 1; instance.lastUsed = Date.now(); } };
  const headers = { ...req.headers, host: `${host}:${instance.port}` };
  delete headers['x-apollo-lightrag-config'];
  const upstream = proxyRequest({ host, port: instance.port, path, method: req.method, headers }, (response) => {
    res.writeHead(response.statusCode || 502, response.headers);
    response.pipe(res);
    response.once('end', release);
    response.once('close', release);
  });
  upstream.once('error', (error) => { release(); if (!res.headersSent) res.writeHead(502); res.end(error.message); });
  req.pipe(upstream);
}

const server = createServer(async (req, res) => {
  if (req.url === '/llm/v1/chat/completions') return handleAnthropicChat(req, res);
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ status: 'healthy', workspaces: instances.size, capacity: maxInstances }));
  }
  const match = (req.url || '').match(/^\/([A-Za-z0-9_-]{1,64})(\/.*)$/);
  if (!match) { res.writeHead(404); return res.end('workspace path required'); }
  try {
    const instance = await workspaceInstance(match[1], parseBuildConfig(req.headers));
    proxy(req, res, instance, match[2]);
  } catch (error) {
    res.writeHead(String(error.message).includes('invalid') ? 400 : String(error.message).includes('capacity') || String(error.message).includes('busy') ? 503 : 502);
    res.end(error.message);
  }
});

server.requestTimeout = 300_000;
server.listen(port, host, () => console.log(`[LightRAG gateway] listening on http://${host}:${port}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  server.close();
  for (const instance of instances.values()) stop(instance);
});

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitFor(url) {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) { await response.arrayBuffer(); return; }
    } catch { /* still starting */ }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timed out waiting for ${url}`);
}

test('serializes concurrent launches for the same LightRAG workspace', { timeout: 15_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'apollo-lightrag-gateway-'));
  const binary = join(directory, 'fake-lightrag-server.mjs');
  const spawnLog = join(directory, 'spawns.log');
  const gatewayPort = await freePort();
  const workspacePort = await freePort();
  await writeFile(binary, `#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
import { createServer } from 'node:http';
const args = process.argv.slice(2);
const value = (name) => args[args.indexOf(name) + 1];
appendFileSync(process.env.SPAWN_LOG, value('--workspace') + '\\n');
const server = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'ok', path: req.url }));
});
server.listen(Number(value('--port')), value('--host'));
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close(() => process.exit()));
`);
  await chmod(binary, 0o755);
  const gateway = spawn(process.execPath, ['scripts/lightrag-workspace-gateway.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      LIGHTRAG_GATEWAY_PORT: String(gatewayPort),
      LIGHTRAG_WORKSPACE_PORT_START: String(workspacePort),
      LIGHTRAG_SERVER_BIN: binary,
      LIGHTRAG_STORAGE_DIR: join(directory, 'storage'),
      LIGHTRAG_INPUT_DIR: join(directory, 'input'),
      LIGHTRAG_PROMPT_DIR: join(directory, 'prompts'),
      SPAWN_LOG: spawnLog,
    },
    stdio: 'ignore',
  });
  try {
    await waitFor(`http://127.0.0.1:${gatewayPort}/health`);
    const responses = await Promise.all([
      fetch(`http://127.0.0.1:${gatewayPort}/same/documents/track_status/a`, { headers: { Connection: 'close' } }),
      fetch(`http://127.0.0.1:${gatewayPort}/same/documents/track_status/b`, { headers: { Connection: 'close' } }),
    ]);
    assert.deepEqual(responses.map((response) => response.status), [200, 200]);
    await Promise.all(responses.map((response) => response.arrayBuffer()));
    assert.equal((await readFile(spawnLog, 'utf8')).trim().split('\n').length, 1);
  } finally {
    const exited = new Promise((resolve) => gateway.once('exit', resolve));
    gateway.kill('SIGTERM');
    const forceKill = setTimeout(() => gateway.kill('SIGKILL'), 250);
    await exited;
    clearTimeout(forceKill);
    await rm(directory, { recursive: true, force: true });
  }
});

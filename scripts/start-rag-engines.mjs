import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import process from 'node:process';

process.loadEnvFile(resolve('.env'));

const root = process.cwd();
const runtime = resolve(root, '.apollo/rag');
const weknoraRoot = process.env.WEKNORA_ROOT || resolve(root, '../rag-engines/WeKnora-Lite');
const weknoraBinary = process.env.WEKNORA_BINARY || resolve(weknoraRoot, 'WeKnora-lite');
const lightRagBinary = process.env.LIGHTRAG_SERVER_BIN || resolve(homedir(), '.local/bin/lightrag-server');
const secretsFile = resolve(runtime, 'secrets.json');

for (const file of [weknoraBinary, lightRagBinary, secretsFile]) {
  if (!existsSync(file)) throw new Error(`RAG runtime missing: ${file}`);
}
const useAnthropicAdapter = Boolean(process.env.ANTHROPIC_AUTH_TOKEN);
for (const name of ['SILICONFLOW_API_KEY', 'WEKNORA_API_KEY', 'LIGHTRAG_API_KEY', ...(useAnthropicAdapter ? [] : ['RAG_CHAT_API_KEY'])]) {
  if (!process.env[name]) throw new Error(`${name} is required`);
}

const secrets = JSON.parse(readFileSync(secretsFile, 'utf8'));
for (const name of ['lightRagTokenSecret', 'weknoraAesKey', 'weknoraJwtSecret']) {
  if (!secrets[name]) throw new Error(`RAG runtime missing secret: ${name}`);
}
const lightRagGatewayPort = process.env.LIGHTRAG_GATEWAY_PORT || '9700';
await Promise.all([
  mkdir(resolve(runtime, 'weknora/data/files'), { recursive: true }),
  mkdir(resolve(runtime, 'lightrag/storage'), { recursive: true }),
  mkdir(resolve(runtime, 'lightrag/input'), { recursive: true }),
]);

const common = { ...process.env };
const weknora = spawn(weknoraBinary, [], {
  cwd: weknoraRoot,
  env: {
    ...common,
    GIN_MODE: 'release',
    SERVER_HOST: '127.0.0.1',
    SERVER_PORT: '18473',
    DB_DRIVER: 'sqlite',
    DB_PATH: resolve(runtime, 'weknora/data/weknora.db'),
    RETRIEVE_DRIVER: 'sqlite',
    STORAGE_TYPE: 'local',
    LOCAL_STORAGE_BASE_DIR: resolve(runtime, 'weknora/data/files'),
    STREAM_MANAGER_TYPE: 'memory',
    SYSTEM_AES_KEY: secrets.weknoraAesKey,
    TENANT_AES_KEY: secrets.weknoraAesKey,
    JWT_SECRET: secrets.weknoraJwtSecret,
    NEO4J_ENABLE: 'false',
    ENABLE_GRAPH_RAG: 'false',
    WEKNORA_SANDBOX_MODE: 'disabled',
  },
  stdio: 'inherit',
});

const lightRag = spawn(process.execPath, [resolve(root, 'scripts/lightrag-workspace-gateway.mjs')], {
  cwd: root,
  env: {
    ...common,
    LIGHTRAG_SERVER_BIN: lightRagBinary,
    LIGHTRAG_STORAGE_DIR: resolve(runtime, 'lightrag/storage'),
    LIGHTRAG_INPUT_DIR: resolve(runtime, 'lightrag/input'),
    LIGHTRAG_PROMPT_DIR: resolve(runtime, 'lightrag/prompts'),
    LLM_BINDING: 'openai',
    LLM_BINDING_HOST: useAnthropicAdapter ? `http://127.0.0.1:${lightRagGatewayPort}/llm/v1` : process.env.RAG_CHAT_BASE_URL,
    LLM_BINDING_API_KEY: useAnthropicAdapter ? 'local-adapter' : process.env.RAG_CHAT_API_KEY,
    LLM_MODEL: (useAnthropicAdapter ? process.env.ANTHROPIC_MODEL : process.env.RAG_CHAT_MODEL) || 'glm-5.2',
    TOKEN_SECRET: secrets.lightRagTokenSecret,
    EMBEDDING_BINDING: 'openai',
    EMBEDDING_BINDING_HOST: process.env.RAG_EMBEDDING_BASE_URL || 'https://api.siliconflow.cn/v1',
    EMBEDDING_BINDING_API_KEY: process.env.SILICONFLOW_API_KEY,
    EMBEDDING_MODEL: process.env.RAG_EMBEDDING_MODEL || 'BAAI/bge-m3',
    EMBEDDING_DIM: '1024',
    SUMMARY_LANGUAGE: 'Chinese',
  },
  stdio: 'inherit',
});

const children = [weknora, lightRag];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  setTimeout(() => process.exit(code), 5_000).unref();
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => stop());
for (const child of children) child.once('exit', (code, signal) => {
  if (!stopping) {
    console.error(`[RAG runtime] child exited (${signal || code})`);
    stop(code || 1);
  }
});

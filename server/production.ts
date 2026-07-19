import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { createApolloMiddleware } from './apollo-middleware.js';
import { startOfficeRuntimeServer } from './office-runtime.js';

const root = process.cwd();
const dist = path.join(root, 'dist');
const port = Number(process.env.PORT || 9130);
const officeServer = startOfficeRuntimeServer(Number(process.env.OFFICE_HOST_PORT || 5174));
const apollo = createApolloMiddleware({
  workspaceRoot: root,
  envPath: path.join(root, '.env'),
  registrationInvite: process.env.WEB_REGISTRATION_INVITE || '',
  adminUsername: process.env.WEB_ADMIN_USERNAME || '',
  allowUnrestricted: process.env.WEB_ALLOW_UNRESTRICTED === 'true',
  maxConcurrentRuns: Number(process.env.WEB_MAX_CONCURRENT_RUNS || 8),
  maxRunsPerUser: Number(process.env.WEB_MAX_RUNS_PER_USER || 3),
  minFreeDiskBytes: Number(process.env.WEB_MIN_FREE_DISK_BYTES || 536870912),
  userStorageQuotaBytes: Number(process.env.WEB_USER_STORAGE_QUOTA_BYTES || 2147483648),
  uploadRetentionDays: Number(process.env.WEB_UPLOAD_RETENTION_DAYS || 7),
  trustedProxyAddresses: (process.env.WEB_TRUSTED_PROXIES || '').split(',').map((value) => value.trim()).filter(Boolean),
  managedBrowser: process.env.APOLLO_BROWSER_WORKER_URL ? {
    url: process.env.APOLLO_BROWSER_WORKER_URL,
    token: process.env.APOLLO_BROWSER_WORKER_TOKEN || '',
  } : undefined,
  sitesBaseUrl: process.env.APOLLO_SITES_BASE_URL || '',
  rag: {
    siliconflowApiKey: process.env.SILICONFLOW_API_KEY || '',
    rerankerModel: process.env.RAG_RERANKER_MODEL || 'BAAI/bge-reranker-v2-m3',
    mineruApiKey: process.env.MINERU_API_KEY || '',
    chatApiKey: process.env.RAG_CHAT_API_KEY || '',
    chatBaseUrl: process.env.RAG_CHAT_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4',
    chatModel: process.env.RAG_CHAT_MODEL || 'glm-4.7-flashx',
    weknoraBaseUrl: process.env.WEKNORA_BASE_URL || '',
    weknoraApiKey: process.env.WEKNORA_API_KEY || '',
    weknoraEmbeddingModelId: process.env.WEKNORA_EMBEDDING_MODEL_ID || '',
    lightRagBaseUrlTemplate: process.env.LIGHTRAG_BASE_URL_TEMPLATE || '',
    lightRagApiKey: process.env.LIGHTRAG_API_KEY || '',
    externalTimeoutMs: Number(process.env.RAG_EXTERNAL_TIMEOUT_MS || 300_000),
  },
  entry: {
    langcoreApiKey: process.env.LANGCORE_API_KEY || '',
    langhubApiKey: process.env.NOUMI_API_KEY || '',
    langhubBaseUrl: process.env.NOUMI_API_BASE || 'https://www.langhub.cn/api/external/v1',
    projects: {
      risk_card: process.env.LANGHUB_PROJECT_RISK_CARD || '',
      supervision_notice: process.env.LANGHUB_PROJECT_SUPERVISION_NOTICE || '',
      supervision_log: process.env.LANGHUB_PROJECT_SUPERVISION_LOG || '',
      supervision_document: process.env.LANGHUB_PROJECT_SUPERVISION_DOCUMENT || '',
      hazard_analysis: process.env.LANGHUB_PROJECT_HAZARD || '',
      plan_review: process.env.LANGHUB_PROJECT_PLAN_REVIEW || '',
      drawing_compare: process.env.LANGHUB_PROJECT_DRAWING_COMPARE || '',
    },
  },
});

const server = createServer((req, res) => {
  if (req.url === '/livez' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ alive: true, uptimeSeconds: Math.round(process.uptime()) }));
    return;
  }
  if (req.url === '/healthz' && req.method === 'GET') {
    const health = {
      ...apollo.health(),
      officeReady: Boolean(officeServer),
      uptimeSeconds: Math.round(process.uptime()),
      memoryRssBytes: process.memoryUsage().rss,
    };
    health.ready = health.ready && health.officeReady;
    res.writeHead(health.ready ? 200 : 503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(health));
    return;
  }
  apollo.handle(req, res, () => {
    void serveStatic(req.url || '/', req.method || 'GET', res).catch((error) => {
      console.error(`[Apollo] 静态资源处理失败：${error instanceof Error ? error.message : String(error)}`);
      if (!res.headersSent) res.writeHead(500).end('Internal server error');
      else if (!res.writableEnded) res.end();
    });
  });
});

server.headersTimeout = 15_000;
server.requestTimeout = 5 * 60_000;
server.keepAliveTimeout = 5_000;
server.maxRequestsPerSocket = 1_000;
server.on('clientError', (_error, socket) => {
  if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
});

server.listen(port, '127.0.0.1', () => console.info(`[Apollo] 生产服务已启动：http://127.0.0.1:${port}`));

let shuttingDown = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => { void shutdown(signal); });
}

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.info(`[Apollo] 收到 ${signal}，开始优雅停机`);
  server.close();
  const forceClose = setTimeout(() => server.closeAllConnections(), 15_000);
  forceClose.unref();
  try {
    await apollo.close();
  } finally {
    server.closeAllConnections();
    officeServer?.close();
    clearTimeout(forceClose);
    process.exitCode = 0;
  }
}

async function serveStatic(rawUrl: string, method: string, res: import('node:http').ServerResponse): Promise<void> {
  if (method !== 'GET' && method !== 'HEAD') {
    res.writeHead(405).end('Method not allowed');
    return;
  }
  const pathname = decodeURIComponent(new URL(rawUrl, 'http://localhost').pathname);
  const requested = path.resolve(dist, `.${pathname}`);
  const relative = path.relative(dist, requested);
  const stat = !relative.startsWith('..') && !path.isAbsolute(relative) ? await fs.stat(requested).catch(() => null) : null;
  const file = stat?.isFile() ? requested : stat?.isDirectory() ? path.join(requested, 'index.html') : path.join(dist, 'index.html');
  const fileStat = await fs.stat(file).catch(() => null);
  if (!fileStat?.isFile()) {
    res.writeHead(404).end('Not found');
    return;
  }
  const compressed = `${file}.br`;
  const compressedStat = /(?:^|,)\s*br\s*(?:;|,|$)/i.test(res.req.headers['accept-encoding'] || '')
    ? await fs.stat(compressed).catch(() => null)
    : null;
  const servedFile = compressedStat?.isFile() && compressedStat.mtimeMs >= fileStat.mtimeMs ? compressed : file;
  const servedStat = servedFile === compressed ? compressedStat : fileStat;
  const ext = path.extname(file).toLowerCase();
  res.writeHead(200, {
    'Content-Type': mime(ext),
    'Content-Length': servedStat!.size,
    'Cache-Control': file.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache',
    'Vary': 'Accept-Encoding',
    ...(servedFile === compressed ? { 'Content-Encoding': 'br' } : {}),
  });
  if (method === 'HEAD') res.end();
  else {
    const stream = createReadStream(servedFile);
    stream.on('error', (error) => {
      console.error(`[Apollo] 静态文件读取失败：${error.message}`);
      if (!res.writableEnded) res.destroy();
    });
    res.on('close', () => stream.destroy());
    stream.pipe(res);
  }
}

function mime(ext: string): string {
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.js' || ext === '.mjs') return 'text/javascript; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.png') return 'image/png';
  if (ext === '.ico') return 'image/x-icon';
  if (ext === '.woff2') return 'font/woff2';
  return 'application/octet-stream';
}

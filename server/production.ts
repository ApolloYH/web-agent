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
  void apollo.handle(req, res, () => { void serveStatic(req.url || '/', req.method || 'GET', res); });
});

server.listen(port, '127.0.0.1', () => console.info(`[Apollo] 生产服务已启动：http://127.0.0.1:${port}`));

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => server.close(() => {
    officeServer?.close();
    void apollo.close().finally(() => process.exit(0));
  }));
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
  const file = stat?.isFile() ? requested : path.join(dist, 'index.html');
  const fileStat = await fs.stat(file).catch(() => null);
  if (!fileStat?.isFile()) {
    res.writeHead(404).end('Not found');
    return;
  }
  const ext = path.extname(file).toLowerCase();
  res.writeHead(200, {
    'Content-Type': mime(ext),
    'Content-Length': fileStat.size,
    'Cache-Control': file.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  if (method === 'HEAD') res.end();
  else createReadStream(file).pipe(res);
}

function mime(ext: string): string {
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.js') return 'text/javascript; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.png') return 'image/png';
  if (ext === '.ico') return 'image/x-icon';
  if (ext === '.woff2') return 'font/woff2';
  return 'application/octet-stream';
}

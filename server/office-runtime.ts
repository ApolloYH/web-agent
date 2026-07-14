import { createReadStream, statSync } from 'node:fs';
import { createServer, type Server as HttpServer } from 'node:http';
import { resolve } from 'node:path';

export function serveOfficeRuntime(
  req: import('node:http').IncomingMessage,
  res: import('node:http').ServerResponse,
  next: () => void,
): void {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  let pathname: string;
  try { pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname); }
  catch { return next(); }
  const root = resolve(process.cwd(), '.apollo', 'onlyoffice-runtime');
  const file = resolve(root, `.${pathname}`);
  const relative = file.slice(root.length + 1);
  if (!relative || relative.startsWith('..')) return next();
  let stat;
  try { stat = statSync(file); } catch { return next(); }
  if (!stat.isFile()) return next();
  const compressedFile = `${file}.br`;
  const acceptsBrotli = /(?:^|,)\s*br\s*(?:;|,|$)/i.test(req.headers['accept-encoding'] || '');
  let servedFile = file;
  if (acceptsBrotli && file.endsWith('/wasm/x2t/x2t.wasm')) {
    try {
      const compressedStat = statSync(compressedFile);
      if (compressedStat.isFile()) {
        servedFile = compressedFile;
        stat = compressedStat;
      }
    } catch { /* The uncompressed runtime file remains the fallback. */ }
  }
  res.writeHead(200, {
    'Content-Type': officeMime(file),
    'Content-Length': stat.size,
    'Cache-Control': 'no-cache',
    'Vary': 'Accept-Encoding',
    ...(servedFile === compressedFile ? { 'Content-Encoding': 'br' } : {}),
  });
  if (req.method === 'HEAD') res.end();
  else createReadStream(servedFile).pipe(res);
}

export function startOfficeRuntimeServer(port: number): HttpServer | null {
  const runtime = resolve(process.cwd(), '.apollo', 'onlyoffice-runtime', 'office-host.html');
  try { if (!statSync(runtime).isFile()) return null; } catch { return null; }
  const server = createServer((req, res) => serveOfficeRuntime(req, res, () => { res.writeHead(404).end('Not found'); }));
  server.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code !== 'EADDRINUSE') console.error(`[Apollo] Office Host 启动失败：${error.message}`);
  });
  server.listen(port, '127.0.0.1', () => console.info(`[Apollo] Office Host：http://127.0.0.1:${port}/office-host.html`));
  return server;
}

function officeMime(file: string): string {
  if (file.endsWith('.html')) return 'text/html; charset=utf-8';
  if (file.endsWith('.js') || file.endsWith('.mjs')) return 'text/javascript; charset=utf-8';
  if (file.endsWith('.css')) return 'text/css; charset=utf-8';
  if (file.endsWith('.json')) return 'application/json; charset=utf-8';
  if (file.endsWith('.wasm')) return 'application/wasm';
  if (file.endsWith('.svg')) return 'image/svg+xml';
  if (file.endsWith('.png')) return 'image/png';
  if (file.endsWith('.woff2')) return 'font/woff2';
  if (file.endsWith('.woff')) return 'font/woff';
  if (file.endsWith('.ttf') || file.endsWith('.ttc')) return 'font/ttf';
  return 'application/octet-stream';
}

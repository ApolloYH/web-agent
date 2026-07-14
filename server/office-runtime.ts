import { createReadStream, readFileSync, statSync } from 'node:fs';
import { createServer, type Server as HttpServer } from 'node:http';
import { resolve } from 'node:path';

const OFFICE_WARMUP_HTML = '<!doctype html><meta charset="utf-8"><script>(async()=>{try{if("serviceWorker" in navigator){await navigator.serviceWorker.register("/document_editor_service_worker.js");await navigator.serviceWorker.ready;if(!navigator.serviceWorker.controller)await new Promise(r=>navigator.serviceWorker.addEventListener("controllerchange",r,{once:true}))}const response=await fetch("/wasm/x2t/x2t.wasm");await response.arrayBuffer()}catch{}})()</script>';
const SERVICE_WORKER_STRATEGY_MARKER = '  // 8. Determine Strategy';
const SERVICE_WORKER_EVICTION_MARKER = '        cache.delete(keys[0]).then(() => limitCacheSize(name, maxItems));';
const CONVERTER_SAFE_EVICTION = `        const oldest = keys.find((key) => !new URL(key.url).pathname.endsWith('/wasm/x2t/x2t.wasm'));
        if (oldest) cache.delete(oldest).then(() => limitCacheSize(name, maxItems));`;
const CONVERTER_CACHE_FIRST = `  if (url.pathname === '/wasm/x2t/x2t.wasm') {
    event.respondWith(caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(event.request);
      if (cached) return cached;
      const response = await fetch(event.request);
      if (response.ok) await cache.put(event.request, response.clone());
      return response;
    }));
    return;
  }

`;

export function serveOfficeRuntime(
  req: import('node:http').IncomingMessage,
  res: import('node:http').ServerResponse,
  next: () => void,
): void {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  let pathname: string;
  try { pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname); }
  catch { return next(); }
  if (pathname === '/office-warmup.html') {
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': Buffer.byteLength(OFFICE_WARMUP_HTML),
      'Cache-Control': 'no-store',
    });
    res.end(req.method === 'HEAD' ? undefined : OFFICE_WARMUP_HTML);
    return;
  }
  const root = resolve(process.cwd(), '.apollo', 'onlyoffice-runtime');
  const file = resolve(root, `.${pathname}`);
  const relative = file.slice(root.length + 1);
  if (!relative || relative.startsWith('..')) return next();
  let stat;
  try { stat = statSync(file); } catch { return next(); }
  if (!stat.isFile()) return next();
  if (pathname === '/sw.js') {
    const source = readFileSync(file, 'utf8');
    const body = source
      .replace(SERVICE_WORKER_EVICTION_MARKER, CONVERTER_SAFE_EVICTION)
      .replace(SERVICE_WORKER_STRATEGY_MARKER, `${CONVERTER_CACHE_FIRST}${SERVICE_WORKER_STRATEGY_MARKER}`);
    res.writeHead(200, {
      'Content-Type': 'text/javascript; charset=utf-8',
      'Content-Length': Buffer.byteLength(body),
      'Cache-Control': 'no-cache',
      'Service-Worker-Allowed': '/',
    });
    res.end(req.method === 'HEAD' ? undefined : body);
    return;
  }
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
  const isConverterWasm = file.endsWith('/wasm/x2t/x2t.wasm');
  res.writeHead(200, {
    'Content-Type': officeMime(file),
    'Content-Length': stat.size,
    'Cache-Control': isConverterWasm ? 'public, max-age=3600' : 'no-cache',
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

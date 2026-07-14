import { createReadStream, readFileSync, statSync } from 'node:fs';
import { createServer, type Server as HttpServer } from 'node:http';
import { resolve } from 'node:path';

const OFFICE_WARM_ASSETS = [
  '/wasm/x2t/x2t.wasm',
  '/sdkjs/word/sdk-all.js',
  '/sdkjs/common/libfont/engine/fonts.wasm',
  '/sdkjs/common/spell/spell/spell.wasm',
  '/sdkjs/common/zlib/engine/zlib.wasm',
  '/web-apps/apps/documenteditor/main/app.js',
  '/web-apps/apps/documenteditor/main/code.js',
  '/fonts/000.ttf',
  '/fonts/001.ttc',
];
const OFFICE_WARMUP_HTML = `<!doctype html><meta charset="utf-8"><script>(async()=>{try{if("serviceWorker" in navigator){await navigator.serviceWorker.register("/document_editor_service_worker.js");await navigator.serviceWorker.ready;if(!navigator.serviceWorker.controller)await new Promise(r=>navigator.serviceWorker.addEventListener("controllerchange",r,{once:true}))}await Promise.all(${JSON.stringify(OFFICE_WARM_ASSETS)}.map(async path=>{const response=await fetch(path);await response.arrayBuffer()}))}catch{}})()</script>`;
const SERVICE_WORKER_GLOBAL_MARKER = 'const ONLYOFFICE_RUNTIME_ASSET_REGEX =';
const SERVICE_WORKER_STRATEGY_MARKER = '  // 7. Skip font files';
const SERVICE_WORKER_EVICTION_MARKER = '        cache.delete(keys[0]).then(() => limitCacheSize(name, maxItems));';
const WARM_ASSET_SET = `const APOLLO_WARM_ASSETS = new Set(${JSON.stringify(OFFICE_WARM_ASSETS)});
`;
const WARM_ASSET_SAFE_EVICTION = `        const oldest = keys.find((key) => !APOLLO_WARM_ASSETS.has(new URL(key.url).pathname));
        if (oldest) cache.delete(oldest).then(() => limitCacheSize(name, maxItems));`;
const WARM_ASSET_CACHE_FIRST = `  if (APOLLO_WARM_ASSETS.has(url.pathname)) {
    event.respondWith(caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(event.request);
      if (cached) return cached;
      try {
        const response = await fetch(event.request);
        if (response.ok) await cache.put(event.request, response.clone());
        return response;
      } catch {
        return new Response('', { status: 503 });
      }
    }));
    return;
  }

  // Browser HTTP caching handles the rest. The worker only owns warm assets and print PDFs.
  return;

`;
const EMPTY_SVG = '<svg xmlns="http://www.w3.org/2000/svg"></svg>';
const OFFICE_IMAGE_BRIDGE = `<script>(()=>{const app=window.APP=window.APP||{};app.AddImage=(done)=>{const input=document.createElement('input');input.type='file';input.accept='image/*';input.onchange=()=>{const file=input.files?.[0];if(!file)return;const reader=new FileReader();reader.onload=()=>{if(typeof reader.result==='string')done({url:reader.result})};reader.onerror=()=>console.error('OnlyOffice image could not be read');reader.readAsDataURL(file)};input.click()}})()</script>`;

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
  if (pathname === '/web-apps/apps/common/main/resources/img/doc-formats/formats@2.5x.svg') {
    res.writeHead(200, {
      'Content-Type': 'image/svg+xml',
      'Content-Length': Buffer.byteLength(EMPTY_SVG),
      'Cache-Control': 'public, max-age=31536000, immutable',
    });
    res.end(req.method === 'HEAD' ? undefined : EMPTY_SVG);
    return;
  }
  const root = resolve(process.cwd(), '.apollo', 'onlyoffice-runtime');
  const file = resolve(root, `.${pathname}`);
  const relative = file.slice(root.length + 1);
  if (!relative || relative.startsWith('..')) return next();
  let stat;
  try { stat = statSync(file); } catch { return next(); }
  if (!stat.isFile()) return next();
  if (pathname === '/sw.js' || pathname === '/document_editor_service_worker.js') {
    const source = readFileSync(resolve(root, './sw.js'), 'utf8');
    const body = source
      .replace(SERVICE_WORKER_GLOBAL_MARKER, `${WARM_ASSET_SET}${SERVICE_WORKER_GLOBAL_MARKER}`)
      .replace(SERVICE_WORKER_EVICTION_MARKER, WARM_ASSET_SAFE_EVICTION)
      .replace(SERVICE_WORKER_STRATEGY_MARKER, `${WARM_ASSET_CACHE_FIRST}${SERVICE_WORKER_STRATEGY_MARKER}`);
    res.writeHead(200, {
      'Content-Type': 'text/javascript; charset=utf-8',
      'Content-Length': Buffer.byteLength(body),
      'Cache-Control': 'no-cache',
      'Service-Worker-Allowed': '/',
    });
    res.end(req.method === 'HEAD' ? undefined : body);
    return;
  }
  if (pathname === '/office-host.html') {
    const body = readFileSync(file, 'utf8').replace('<script type="module"', `${OFFICE_IMAGE_BRIDGE}\n    <script type="module"`);
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': Buffer.byteLength(body),
      'Cache-Control': 'no-cache',
    });
    res.end(req.method === 'HEAD' ? undefined : body);
    return;
  }
  if (/\/assets\/(?:converter|officeHost)-[^/]+\.js$/.test(pathname)) {
    const body = readFileSync(file, 'utf8')
      .replace('catch(e){console.warn(`Directory ${t} may already exist:`,e)}', 'catch{}')
      .replace('spellcheck:this.options.spellcheck??!1,autosave:', 'autosave:');
    res.writeHead(200, {
      'Content-Type': 'text/javascript; charset=utf-8',
      'Content-Length': Buffer.byteLength(body),
      'Cache-Control': 'no-cache',
    });
    res.end(req.method === 'HEAD' ? undefined : body);
    return;
  }
  const compressedFile = `${file}.br`;
  const acceptsBrotli = /(?:^|,)\s*br\s*(?:;|,|$)/i.test(req.headers['accept-encoding'] || '');
  let servedFile = file;
  if (acceptsBrotli) {
    try {
      const compressedStat = statSync(compressedFile);
      if (compressedStat.isFile() && compressedStat.mtimeMs >= stat.mtimeMs) {
        servedFile = compressedFile;
        stat = compressedStat;
      }
    } catch { /* The uncompressed runtime file remains the fallback. */ }
  }
  const cacheable = !file.endsWith('.html') && !file.endsWith('.json');
  res.writeHead(200, {
    'Content-Type': officeMime(file),
    'Content-Length': stat.size,
    'Cache-Control': cacheable ? 'public, max-age=3600' : 'no-cache',
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

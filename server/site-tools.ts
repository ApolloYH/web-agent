import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ToolDefinition } from '@apolloyh/apollo-agent';
import { injectSiteInspector } from './site-inspector.js';

const SITE_EXTENSIONS = new Set(['.html', '.css', '.js', '.mjs', '.json', '.svg', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.woff', '.woff2', '.txt', '.xml', '.webmanifest']);
const MAX_SITE_FILES = 200;
const MAX_SITE_BYTES = 25 * 1024 * 1024;
const MANIFEST = '.apollo-site.json';

export type PublishedSite = {
  slug: string;
  name: string;
  url: string;
  sourceDir: string;
  conversationId?: string;
  publishedAt: string;
  fileCount: number;
  size: number;
};

type StoredSite = PublishedSite & { ownerId: string };

export function createSiteTools(config: { publicRoot: string; baseUrl: string; ownerId: string; conversationId?: string }): ToolDefinition[] {
  if (!config.baseUrl) return [];
  return [{
    name: 'site_publish',
    description: '将当前用户工作区内的静态网站目录发布为公开 URL。目录必须包含 index.html，仅支持 HTML/CSS/JS 和常见静态资源。',
    risk: 'high',
    input_schema: {
      type: 'object',
      properties: {
        source_dir: { type: 'string', description: '相对当前工作区的网站目录，例如 sites/my-portfolio' },
        name: { type: 'string', description: '站点展示名称' },
        slug: { type: 'string', description: '可选 URL 标识，只允许小写字母、数字和连字符' },
      },
      required: ['source_dir', 'name'],
    },
    execute: async (input, context) => {
      try {
        const site = await publishSite({
          workspaceRoot: context.workspaceRoot,
          publicRoot: config.publicRoot,
          baseUrl: config.baseUrl,
          ownerId: config.ownerId,
          conversationId: config.conversationId,
          sourceDir: requiredText(input.source_dir, 'source_dir'),
          name: requiredText(input.name, 'name'),
          slug: typeof input.slug === 'string' ? input.slug : undefined,
        });
        return { content: `站点已发布：${site.url}\n后续继续描述修改，Apollo 会更新源码并再次发布。` };
      } catch (error) {
        return { content: error instanceof Error ? error.message : String(error), isError: true };
      }
    },
  }];
}

export async function publishSite(input: {
  workspaceRoot: string;
  publicRoot: string;
  baseUrl: string;
  ownerId: string;
  conversationId?: string;
  sourceDir: string;
  name: string;
  slug?: string;
}): Promise<PublishedSite> {
  const sourceDir = safeRelativeDirectory(input.sourceDir);
  const source = path.resolve(input.workspaceRoot, sourceDir);
  const realRoot = await fs.realpath(input.workspaceRoot);
  const realSource = await fs.realpath(source).catch(() => { throw new Error(`网站目录不存在：${sourceDir}`); });
  const relative = path.relative(realRoot, realSource);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('网站目录必须位于当前工作区内');
  if (!(await fs.stat(path.join(realSource, 'index.html')).catch(() => null))?.isFile()) throw new Error('网站目录必须包含 index.html');

  const files = await collectSiteFiles(realSource);
  const requestedSlug = input.slug ? normalizeSlug(input.slug) : normalizeSlug(path.basename(sourceDir));
  const slug = requestedSlug || `site-${randomUUID().slice(0, 8)}`;
  const target = path.join(input.publicRoot, slug);
  const existing = await readManifest(target);
  if (existing && existing.ownerId !== input.ownerId) throw new Error('这个站点地址已被占用，请换一个名称');

  await fs.mkdir(input.publicRoot, { recursive: true });
  const temporary = path.join(input.publicRoot, `.${slug}-${randomUUID()}`);
  const backup = path.join(input.publicRoot, `.${slug}-backup-${randomUUID()}`);
  await fs.mkdir(temporary, { recursive: true });
  try {
    for (const file of files.items) {
      const destination = path.join(temporary, file.relative);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.copyFile(file.absolute, destination);
    }
    const publishedAt = new Date().toISOString();
    const site: StoredSite = {
      ownerId: input.ownerId,
      slug,
      name: input.name.trim().slice(0, 80),
      url: `${input.baseUrl.replace(/\/$/, '')}/sites/${slug}/`,
      sourceDir,
      ...(input.conversationId || existing?.conversationId ? { conversationId: input.conversationId || existing?.conversationId } : {}),
      publishedAt,
      fileCount: files.items.length,
      size: files.size,
    };
    await fs.writeFile(path.join(temporary, MANIFEST), `${JSON.stringify(site, null, 2)}\n`);
    if (await fs.stat(target).catch(() => null)) await fs.rename(target, backup);
    try {
      await fs.rename(temporary, target);
      await fs.rm(backup, { recursive: true, force: true });
    } catch (error) {
      if (await fs.stat(backup).catch(() => null)) await fs.rename(backup, target).catch(() => undefined);
      throw error;
    }
    return publicSite(site);
  } finally {
    await Promise.all([fs.rm(temporary, { recursive: true, force: true }), fs.rm(backup, { recursive: true, force: true })]);
  }
}

export async function listPublishedSites(publicRoot: string, ownerId: string, resolveConversationId?: (site: PublishedSite) => string | undefined): Promise<PublishedSite[]> {
  const entries = await fs.readdir(publicRoot, { withFileTypes: true }).catch(() => []);
  const sites = await Promise.all(entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith('.')).map((entry) => readManifest(path.join(publicRoot, entry.name))));
  return sites.filter((site): site is StoredSite => site?.ownerId === ownerId).map(publicSite).map((site) => site.conversationId || !resolveConversationId ? site : { ...site, conversationId: resolveConversationId(site) }).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}

export async function deletePublishedSite(publicRoot: string, ownerId: string, slug: string): Promise<void> {
  const safeSlug = normalizeSlug(slug);
  if (!safeSlug || safeSlug !== slug) throw new Error('站点地址无效');
  const target = path.join(publicRoot, safeSlug);
  const site = await readManifest(target);
  if (!site || site.ownerId !== ownerId) throw new Error('站点不存在');
  await fs.rm(target, { recursive: true, force: true });
}

export async function servePublishedSite(req: IncomingMessage, res: ServerResponse, publicRoot: string, baseUrl: string): Promise<boolean> {
  const requestUrl = new URL(req.url || '/', 'http://localhost');
  const match = requestUrl.pathname.match(/^\/sites\/([a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?)(?:\/(.*))?$/);
  if (!match) return false;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end('Method not allowed');
    return true;
  }
  const expectedHost = new URL(baseUrl).host;
  if (expectedHost && req.headers.host !== expectedHost) {
    res.writeHead(302, { Location: `${baseUrl.replace(/\/$/, '')}${requestUrl.pathname}${requestUrl.search}` }).end();
    return true;
  }
  const root = path.join(publicRoot, match[1]!);
  const relative = decodeURIComponent(match[2] || 'index.html');
  if (!relative || relative.startsWith('.') || relative.split('/').some((part) => !part || part === '..')) {
    res.writeHead(404).end('Not found');
    return true;
  }
  const file = path.resolve(root, relative);
  const confined = await confinedFile(root, file);
  if (!confined || path.basename(confined) === MANIFEST) {
    res.writeHead(404).end('Not found');
    return true;
  }
  let bytes = await fs.readFile(confined);
  if (path.extname(confined).toLowerCase() === '.html') bytes = Buffer.from(injectSiteInspector(bytes.toString('utf8')));
  res.writeHead(200, {
    'Content-Type': siteMime(path.extname(confined).toLowerCase()),
    'Content-Length': bytes.length,
    'Cache-Control': path.basename(confined) === 'index.html' ? 'no-cache' : 'public, max-age=3600',
    'Content-Security-Policy': "sandbox allow-scripts allow-forms allow-popups allow-modals allow-downloads; default-src 'self' https: data: blob:; script-src 'self' 'unsafe-inline' https:; style-src 'self' 'unsafe-inline' https:; img-src 'self' https: data: blob:; font-src 'self' https: data:; connect-src https:; frame-ancestors https:",
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
  });
  if (req.method === 'HEAD') res.end(); else res.end(bytes);
  return true;
}

function requiredText(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} 不能为空`);
  return value.trim();
}

function safeRelativeDirectory(value: string): string {
  const normalized = value.trim().replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/$/, '');
  if (!normalized || path.isAbsolute(normalized) || normalized.split('/').some((part) => !part || part === '.' || part === '..' || part.startsWith('.'))) throw new Error('source_dir 必须是工作区内的普通相对目录');
  return normalized;
}

function normalizeSlug(value: string): string {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64).replace(/-+$/g, '');
}

async function collectSiteFiles(root: string): Promise<{ items: Array<{ absolute: string; relative: string }>; size: number }> {
  const items: Array<{ absolute: string; relative: string }> = [];
  let size = 0;
  const walk = async (directory: string): Promise<void> => {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) throw new Error('网站目录不能包含隐藏文件');
      const absolute = path.join(directory, entry.name);
      const stat = await fs.lstat(absolute);
      if (stat.isSymbolicLink()) throw new Error('网站目录不能包含符号链接');
      if (stat.isDirectory()) {
        await walk(absolute);
        continue;
      }
      if (!stat.isFile() || !SITE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) throw new Error(`不支持的网站文件：${path.relative(root, absolute)}`);
      items.push({ absolute, relative: path.relative(root, absolute) });
      size += stat.size;
      if (items.length > MAX_SITE_FILES || size > MAX_SITE_BYTES) throw new Error('轻站点最多 200 个文件、总大小 25MB');
    }
  };
  await walk(root);
  return { items, size };
}

async function readManifest(root: string): Promise<StoredSite | null> {
  try {
    return JSON.parse(await fs.readFile(path.join(root, MANIFEST), 'utf8')) as StoredSite;
  } catch {
    return null;
  }
}

async function confinedFile(root: string, file: string): Promise<string | null> {
  try {
    const [realRoot, realFile, stat] = await Promise.all([fs.realpath(root), fs.realpath(file), fs.lstat(file)]);
    const relative = path.relative(realRoot, realFile);
    return stat.isFile() && !stat.isSymbolicLink() && !relative.startsWith('..') && !path.isAbsolute(relative) ? realFile : null;
  } catch {
    return null;
  }
}

function publicSite({ ownerId: _ownerId, ...site }: StoredSite): PublishedSite {
  return site;
}

function siteMime(ext: string): string {
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.js' || ext === '.mjs') return 'text/javascript; charset=utf-8';
  if (ext === '.json' || ext === '.webmanifest') return 'application/json; charset=utf-8';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.ico') return 'image/x-icon';
  if (ext === '.woff') return 'font/woff';
  if (ext === '.woff2') return 'font/woff2';
  if (ext === '.xml') return 'application/xml; charset=utf-8';
  if (ext === '.txt') return 'text/plain; charset=utf-8';
  return 'image/jpeg';
}

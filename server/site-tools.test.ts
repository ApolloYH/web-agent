import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { injectSiteInspector } from './site-inspector.js';
import { deletePublishedSite, listPublishedSites, publishSite } from './site-tools.js';

test('static sites publish atomically and stay isolated by owner', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'apollo-sites-'));
  const workspace = path.join(root, 'workspace');
  const publicRoot = path.join(root, 'public');
  await fs.mkdir(path.join(workspace, 'sites', 'demo'), { recursive: true });
  await fs.writeFile(path.join(workspace, 'sites', 'demo', 'index.html'), '<h1>Apollo</h1>');
  try {
    const site = await publishSite({ workspaceRoot: workspace, publicRoot, baseUrl: 'https://sites.example.com', ownerId: 'u1', conversationId: 'chat-1', sourceDir: 'sites/demo', name: 'Demo' });
    assert.equal(site.url, 'https://sites.example.com/sites/demo/');
    assert.equal((await listPublishedSites(publicRoot, 'u1'))[0]?.conversationId, 'chat-1');
    assert.equal((await listPublishedSites(publicRoot, 'u2')).length, 0);
    await assert.rejects(deletePublishedSite(publicRoot, 'u2', 'demo'), /不存在/);
    await deletePublishedSite(publicRoot, 'u1', 'demo');
    assert.equal((await listPublishedSites(publicRoot, 'u1')).length, 0);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('site publishing rejects workspace escapes and symlinks', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'apollo-sites-safe-'));
  const workspace = path.join(root, 'workspace');
  await fs.mkdir(workspace, { recursive: true });
  try {
    await assert.rejects(publishSite({ workspaceRoot: workspace, publicRoot: path.join(root, 'public'), baseUrl: 'https://sites.example.com', ownerId: 'u1', sourceDir: '../outside', name: 'Bad' }), /相对目录/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});


test('site inspector is injected once into HTML', () => {
  const html = '<!doctype html><html><body><h1>Apollo</h1></body></html>';
  const injected = injectSiteInspector(html);
  assert.match(injected, /data-apollo-site-inspector/);
  assert.match(injected, /getAttribute\('data-od-id'\)/);
  assert.ok(injected.indexOf('data-apollo-site-inspector') < injected.indexOf('</body>'));
  assert.equal(injectSiteInspector(injected), injected);
  assert.match(injectSiteInspector('<h1>fragment</h1>'), /<h1>fragment<\/h1><script data-apollo-site-inspector>/);
  const script = injected.match(/<script data-apollo-site-inspector>([\s\S]*)<\/script>/)?.[1];
  assert.ok(script);
  assert.doesNotThrow(() => new Function(script));
});

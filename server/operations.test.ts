import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer, type IncomingMessage } from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { clientAddress, createApolloMiddleware, isSameOriginMutation, isWebToolAllowed } from './apollo-middleware.js';

const exec = promisify(execFile);

function mockRequest(method: string, headers: IncomingMessage['headers'], remoteAddress = '127.0.0.1'): IncomingMessage {
  return { method, headers, socket: { remoteAddress } } as unknown as IncomingMessage;
}

test('client IP headers are only trusted from configured proxies', () => {
  const spoofed = mockRequest('POST', { 'x-real-ip': '198.51.100.20' });
  assert.equal(clientAddress(spoofed, new Set()), '127.0.0.1');
  assert.equal(clientAddress(spoofed, new Set(['127.0.0.1'])), '198.51.100.20');

  const forwarded = mockRequest('POST', { 'x-forwarded-for': '203.0.113.8, 10.0.0.2' });
  assert.equal(clientAddress(forwarded, new Set(['127.0.0.1', '10.0.0.2'])), '203.0.113.8');
});

test('state-changing requests require an exact Origin', () => {
  assert.equal(isSameOriginMutation(mockRequest('GET', { host: 'apollo.example' })), true);
  assert.equal(isSameOriginMutation(mockRequest('POST', { host: 'apollo.example' })), false);
  assert.equal(isSameOriginMutation(mockRequest('POST', { host: 'apollo.example', origin: 'https://apollo.example', 'x-forwarded-proto': 'https' })), true);
  assert.equal(isSameOriginMutation(mockRequest('POST', { host: 'apollo.example', origin: 'http://apollo.example', 'x-forwarded-proto': 'https' })), false);
});

test('login identity limit survives rotating trusted client IP headers', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'apollo-rate-limit-'));
  await fs.mkdir(path.join(root, 'config'), { recursive: true });
  await fs.mkdir(path.join(root, 'entry-skills'), { recursive: true });
  await fs.writeFile(path.join(root, 'config', 'web-entry-apollo.json'), '{}');
  await fs.writeFile(path.join(root, 'config', 'web-assistant-apollo.json'), JSON.stringify({ skills: { directories: ['./assistant-skills'] } }));
  const middleware = createApolloMiddleware({
    workspaceRoot: root,
    envPath: path.join(root, '.env'),
    registrationInvite: '',
    adminUsername: '',
    minFreeDiskBytes: 0,
    trustedProxyAddresses: ['127.0.0.1'],
    entry: { langcoreApiKey: '', langhubApiKey: '', langhubBaseUrl: '', projects: {} },
  });
  const server = createServer((req, res) => middleware.handle(req, res, () => res.writeHead(404).end()));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  try {
    for (let attempt = 0; attempt < 11; attempt += 1) {
      const response = await fetch(`${base}/apollo-api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: base, 'X-Real-IP': `198.51.100.${attempt + 1}` },
        body: JSON.stringify({ username: 'victim', password: 'wrong-password' }),
      });
      assert.equal(response.status, attempt < 10 ? 400 : 429);
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await middleware.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('Web deployment permanently blocks host and external execution tools', () => {
  for (const tool of ['shell_exec', 'workspace_boundary', 'sensitive_file_read', 'skill_install', 'mcp_list_tools', 'mcp_call_tool']) {
    assert.equal(isWebToolAllowed(tool), false, tool);
  }
  assert.equal(isWebToolAllowed('read_file'), true);
  assert.equal(isWebToolAllowed('document_get_context'), true);
  assert.equal(isWebToolAllowed('browser_get_state'), true);
});

test('health checks database and disk instead of returning a static flag', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'apollo-health-'));
  await fs.mkdir(path.join(root, 'config'), { recursive: true });
  await fs.mkdir(path.join(root, 'entry-skills'), { recursive: true });
  await fs.writeFile(path.join(root, 'config', 'web-entry-apollo.json'), '{}');
  await fs.writeFile(path.join(root, 'config', 'web-assistant-apollo.json'), JSON.stringify({ skills: { directories: ['./assistant-skills'] } }));
  const middleware = createApolloMiddleware({
    workspaceRoot: root,
    envPath: path.join(root, '.env'),
    registrationInvite: '',
    adminUsername: '',
    minFreeDiskBytes: 0,
    entry: { langcoreApiKey: '', langhubApiKey: '', langhubBaseUrl: '', projects: {} },
  });
  try {
    const health = middleware.health();
    assert.equal(health.ready, true);
    assert.equal(health.databaseReady, true);
    assert.ok(health.diskFreeBytes > 0);
  } finally {
    await middleware.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('regular users cannot read or replace agent runtime configuration', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'apollo-authz-'));
  await fs.mkdir(path.join(root, 'config'), { recursive: true });
  await fs.mkdir(path.join(root, 'entry-skills'), { recursive: true });
  await fs.writeFile(path.join(root, 'config', 'web-entry-apollo.json'), '{}');
  await fs.writeFile(path.join(root, 'config', 'web-assistant-apollo.json'), JSON.stringify({ skills: { directories: ['./assistant-skills'] } }));
  const middleware = createApolloMiddleware({
    workspaceRoot: root,
    envPath: path.join(root, '.env'),
    registrationInvite: 'test-invite',
    adminUsername: 'admin',
    minFreeDiskBytes: 0,
    entry: { langcoreApiKey: '', langhubApiKey: '', langhubBaseUrl: '', projects: {} },
  });
  const server = createServer((req, res) => middleware.handle(req, res, () => res.writeHead(404).end()));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  try {
    for (const username of ['admin', 'member']) {
      const response = await fetch(`${base}/apollo-api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: base },
        body: JSON.stringify({ username, password: 'secure-password', inviteCode: 'test-invite' }),
      });
      assert.equal(response.status, 200);
      if (username === 'member') {
        const cookie = response.headers.get('set-cookie')?.split(';', 1)[0];
        assert.ok(cookie);
        const getConfig = await fetch(`${base}/apollo-api/config`, { headers: { Cookie: cookie } });
        assert.equal(getConfig.status, 403);
        const saveConfig = await fetch(`${base}/apollo-api/config`, {
          method: 'POST',
          headers: { Cookie: cookie, 'Content-Type': 'application/json', Origin: base },
          body: JSON.stringify({ config: '{}' }),
        });
        assert.equal(saveConfig.status, 403);
      }
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await middleware.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('IM settings are user-scoped, secret-safe, and deny unsafe defaults', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'apollo-im-settings-'));
  await fs.mkdir(path.join(root, 'config'), { recursive: true });
  await fs.mkdir(path.join(root, 'entry-skills'), { recursive: true });
  await fs.writeFile(path.join(root, 'config', 'web-entry-apollo.json'), '{}');
  await fs.writeFile(path.join(root, 'config', 'web-assistant-apollo.json'), JSON.stringify({ skills: { directories: ['./assistant-skills'] } }));
  const middleware = createApolloMiddleware({
    workspaceRoot: root,
    envPath: path.join(root, '.env'),
    registrationInvite: 'test-invite',
    adminUsername: 'member',
    minFreeDiskBytes: 0,
    entry: { langcoreApiKey: '', langhubApiKey: '', langhubBaseUrl: '', projects: {} },
  });
  const server = createServer((req, res) => middleware.handle(req, res, () => res.writeHead(404).end()));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const registration = await fetch(`${base}/apollo-api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: base },
      body: JSON.stringify({ username: 'member', password: 'secure-password', inviteCode: 'test-invite' }),
    });
    const cookie = registration.headers.get('set-cookie')?.split(';', 1)[0];
    assert.ok(cookie);
    const settings = await fetch(`${base}/apollo-api/im/telegram`, { headers: { Cookie: cookie } });
    const payload = await settings.json() as Record<string, unknown>;
    assert.equal(settings.status, 200);
    assert.equal(payload.tokenConfigured, false);
    assert.equal('token' in payload, false);

    const allSettings = await fetch(`${base}/apollo-api/im`, { headers: { Cookie: cookie } });
    const allPayload = await allSettings.json() as { channels: Record<string, Record<string, unknown>> };
    assert.equal(allSettings.status, 200);
    assert.deepEqual(Object.keys(allPayload.channels).sort(), ['dingtalk', 'feishu', 'telegram', 'wecom', 'weixin']);
    for (const channel of Object.values(allPayload.channels)) {
      for (const secret of ['token', 'appSecret', 'secret', 'clientSecret', 'botToken', 'getUpdatesBuf']) assert.equal(secret in channel, false);
    }

    const disabled = await fetch(`${base}/apollo-api/im/telegram`, {
      method: 'PUT',
      headers: { Cookie: cookie, 'Content-Type': 'application/json', Origin: base },
      body: JSON.stringify({ enabled: false, allowedUserIds: [] }),
    });
    assert.equal(disabled.status, 200);
    const database = new DatabaseSync(path.join(root, '.apollo', 'web-agent.sqlite'), { readOnly: true });
    const userId = (database.prepare('SELECT id FROM users WHERE username = ?').get('member') as { id: string }).id;
    database.close();
    const secretFile = path.join(root, '.apollo', 'im-channels', `${userId}.telegram.json`);
    assert.equal((await fs.stat(secretFile)).mode & 0o777, 0o600);
    await assert.rejects(fs.access(path.join(root, '.apollo', 'users', userId, 'workspace', '.apollo', 'telegram.json')));

    for (const [platform, body] of [
      ['feishu', { enabled: false, appId: '', allowedUserIds: [] }],
      ['wecom', { enabled: false, botId: '', allowedUserIds: [] }],
      ['dingtalk', { enabled: false, clientId: '', allowedUserIds: [] }],
      ['weixin', { enabled: false, allowedUserIds: [] }],
    ] as const) {
      const saved: Response = await fetch(`${base}/apollo-api/im/${platform}`, {
        method: 'PUT',
        headers: { Cookie: cookie, 'Content-Type': 'application/json', Origin: base },
        body: JSON.stringify(body),
      });
      assert.equal(saved.status, 200, `${platform} should save while disabled`);
      assert.equal((await fs.stat(path.join(root, '.apollo', 'im-channels', `${userId}.${platform}.json`))).mode & 0o777, 0o600);
    }

    const unsafe = await fetch(`${base}/apollo-api/im/telegram`, {
      method: 'PUT',
      headers: { Cookie: cookie, 'Content-Type': 'application/json', Origin: base },
      body: JSON.stringify({ enabled: true, allowedUserIds: [] }),
    });
    assert.equal(unsafe.status, 400);
    assert.match((await unsafe.json() as { error: string }).error, /Bot Token/);

    for (const platform of ['feishu', 'wecom', 'dingtalk', 'weixin']) {
      const rejected: Response = await fetch(`${base}/apollo-api/im/${platform}`, {
        method: 'PUT',
        headers: { Cookie: cookie, 'Content-Type': 'application/json', Origin: base },
        body: JSON.stringify({ enabled: true, allowedUserIds: [] }),
      });
      assert.equal(rejected.status, 400, `${platform} must reject unsafe enablement`);
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await middleware.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('per-user storage quota rejects new uploads before writing files', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'apollo-quota-'));
  await fs.mkdir(path.join(root, 'config'), { recursive: true });
  await fs.mkdir(path.join(root, 'entry-skills'), { recursive: true });
  await fs.writeFile(path.join(root, 'config', 'web-entry-apollo.json'), '{}');
  await fs.writeFile(path.join(root, 'config', 'web-assistant-apollo.json'), JSON.stringify({ skills: { directories: ['./assistant-skills'] } }));
  const middleware = createApolloMiddleware({
    workspaceRoot: root,
    envPath: path.join(root, '.env'),
    registrationInvite: 'test-invite',
    adminUsername: 'member',
    minFreeDiskBytes: 0,
    userStorageQuotaBytes: 1,
    entry: { langcoreApiKey: '', langhubApiKey: '', langhubBaseUrl: '', projects: {} },
  });
  const server = createServer((req, res) => middleware.handle(req, res, () => res.writeHead(404).end()));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const registration = await fetch(`${base}/apollo-api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: base },
      body: JSON.stringify({ username: 'member', password: 'secure-password', inviteCode: 'test-invite' }),
    });
    const cookie = registration.headers.get('set-cookie')?.split(';', 1)[0];
    assert.ok(cookie);
    const form = new FormData();
    form.append('files', new File(['too large'], 'note.txt', { type: 'text/plain' }));
    const upload = await fetch(`${base}/apollo-api/uploads`, { method: 'POST', headers: { Cookie: cookie, Origin: base }, body: form });
    assert.equal(upload.status, 507);
    assert.match((await upload.json() as { error: string }).error, /存储配额不足/);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await middleware.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('backup and restore preserve SQLite and user files but skip Office cache', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'apollo-backup-'));
  const source = path.join(root, 'source');
  const backups = path.join(root, 'backups');
  const restoreTarget = path.join(root, 'restore');
  await fs.mkdir(path.join(source, '.apollo', 'users', 'u1', 'workspace', 'artifacts'), { recursive: true });
  await fs.mkdir(path.join(source, '.apollo', 'onlyoffice-runtime'), { recursive: true });
  await fs.writeFile(path.join(source, '.apollo', 'users', 'u1', 'workspace', 'artifacts', 'report.md'), 'saved');
  await fs.writeFile(path.join(source, '.apollo', 'onlyoffice-runtime', 'large.wasm'), 'cache');
  await fs.writeFile(path.join(source, '.env'), 'SECRET=test\n');
  const databasePath = path.join(source, '.apollo', 'web-agent.sqlite');
  const database = new DatabaseSync(databasePath);
  database.exec('CREATE TABLE sample (value TEXT); INSERT INTO sample VALUES (\'durable\');');
  database.close();

  await exec(process.execPath, [path.join(process.cwd(), 'scripts', 'backup-production.mjs'), '--source', source, '--destination', backups]);
  const snapshots = (await fs.readdir(backups)).filter((entry) => !entry.startsWith('.tmp-'));
  assert.equal(snapshots.length, 1);
  const snapshot = path.join(backups, snapshots[0]!);
  assert.equal(await fs.readFile(path.join(snapshot, '.apollo', 'users', 'u1', 'workspace', 'artifacts', 'report.md'), 'utf8'), 'saved');
  await assert.rejects(fs.access(path.join(snapshot, '.apollo', 'onlyoffice-runtime')));
  const copiedDatabase = new DatabaseSync(path.join(snapshot, '.apollo', 'web-agent.sqlite'), { readOnly: true });
  assert.equal((copiedDatabase.prepare('SELECT value FROM sample').get() as { value: string }).value, 'durable');
  copiedDatabase.close();

  await fs.mkdir(path.join(restoreTarget, '.apollo'), { recursive: true });
  await fs.writeFile(path.join(restoreTarget, '.apollo', 'old.txt'), 'old');
  await exec(process.execPath, [path.join(process.cwd(), 'scripts', 'restore-production.mjs'), '--snapshot', snapshot, '--target', restoreTarget, '--confirm']);
  assert.equal(await fs.readFile(path.join(restoreTarget, '.apollo', 'users', 'u1', 'workspace', 'artifacts', 'report.md'), 'utf8'), 'saved');
  assert.ok((await fs.readdir(restoreTarget)).some((entry) => entry.startsWith('.apollo.pre-restore-')));
  await fs.rm(root, { recursive: true, force: true });
});

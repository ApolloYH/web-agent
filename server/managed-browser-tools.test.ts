import assert from 'node:assert/strict';
import test from 'node:test';
import { createManagedBrowserTools } from './managed-browser-tools.js';

test('managed browser tool is registered only when worker is configured', () => {
  assert.deepEqual(createManagedBrowserTools(), []);
  assert.equal(createManagedBrowserTools({ url: 'http://127.0.0.1:9140', token: 'test' })[0]?.risk, 'high');
});

test('managed browser tool binds a view session before starting the worker', async () => {
  const originalFetch = globalThis.fetch;
  let sessionId = '';
  let requestBody: Record<string, unknown> = {};
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };
  try {
    const tool = createManagedBrowserTools({
      url: 'http://127.0.0.1:9140',
      token: 'test',
      onSession: (value) => { sessionId = value; },
    })[0]!;
    await tool.execute({ task: 'test' }, { workspaceRoot: '.', emit: () => undefined, requestApproval: async () => true });
    assert.match(sessionId, /^[0-9a-f-]{36}$/);
    assert.equal(requestBody.session_id, sessionId);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

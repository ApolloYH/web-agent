import assert from 'node:assert/strict';
import test from 'node:test';
import { createBrowserTools } from './browser-tools.js';

test('browser tools expose read and mutation risk levels', async () => {
  const calls: Array<{ action: string; input: object }> = [];
  const tools = createBrowserTools(async (action, input) => {
    calls.push({ action, input });
    return { ok: true };
  });

  assert.equal(tools.find((tool) => tool.name === 'browser_get_state')?.risk, 'low');
  assert.equal(tools.find((tool) => tool.name === 'browser_click')?.risk, 'medium');
  const click = tools.find((tool) => tool.name === 'browser_click');
  assert.ok(click);
  await click.execute({ index: 7 }, { workspaceRoot: '/tmp', emit: () => undefined, requestApproval: async () => true });
  assert.deepEqual(calls, [{ action: 'click', input: { index: 7 } }]);
});

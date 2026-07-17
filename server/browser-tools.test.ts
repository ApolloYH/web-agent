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
  assert.match(tools[0]!.description, /对话上下文/);
  assert.match(tools[0]!.description, /不要要求用户每轮重复/);
  assert.match(tools[0]!.description, /页面变化后必须重新读取状态/);
  assert.match(tools[0]!.description, /每次最多滚动 1 页/);
  const click = tools.find((tool) => tool.name === 'browser_click');
  assert.ok(click);
  await click.execute({ index: 7 }, { workspaceRoot: '/tmp', emit: () => undefined, requestApproval: async () => true });
  assert.deepEqual(calls, [{ action: 'click', input: { index: 7 } }]);
});

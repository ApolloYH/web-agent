import assert from 'node:assert/strict';
import test from 'node:test';
import { createBrowserTools, explicitlyRequestsUserBrowser } from './browser-tools.js';

test('user browser requires an explicit current-turn request', () => {
  assert.equal(explicitlyRequestsUserBrowser('帮我搜索今天的新闻'), false);
  assert.equal(explicitlyRequestsUserBrowser('打开浏览器搜索今天的新闻'), false);
  assert.equal(explicitlyRequestsUserBrowser('当前 Web 工作区是用户浏览器中的本地文件夹'), false);
  assert.equal(explicitlyRequestsUserBrowser('请使用我自己的浏览器搜索今天的新闻'), true);
  assert.equal(explicitlyRequestsUserBrowser('在我的 Chrome 里打开这个页面'), true);
  assert.equal(explicitlyRequestsUserBrowser('不要使用我的浏览器'), false);
  assert.equal(explicitlyRequestsUserBrowser("don't use my browser"), false);
  assert.equal(explicitlyRequestsUserBrowser('use my browser to open the page'), true);
});

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

test('user browser tools reject calls unless the current turn opted in', async () => {
  let called = false;
  const tool = createBrowserTools(async () => {
    called = true;
    return { ok: true };
  }, () => false).find((item) => item.name === 'browser_get_state');
  assert.ok(tool);
  const result = await tool.execute({}, { workspaceRoot: '/tmp', emit: () => undefined, requestApproval: async () => true });
  assert.equal(result.isError, true);
  assert.equal(called, false);
});

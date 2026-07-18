import assert from 'node:assert/strict';
import test from 'node:test';
import { createDocumentTools } from './document-tools.js';

test('local folder write validates names and dispatches approved text writes', async () => {
  const calls: Array<{ action: string; input: object }> = [];
  const tools = createDocumentTools(async (action, input) => {
    calls.push({ action, input });
    return { ok: true };
  });
  const write = tools.find((tool) => tool.name === 'local_folder_write_file');
  assert.ok(write);
  assert.equal(write.risk, 'high');
  const context = { workspaceRoot: '/tmp', emit: () => undefined, requestApproval: async () => true };
  assert.equal((await write.execute({ name: '../secret.txt', content: 'x' }, context)).isError, true);
  await write.execute({ name: 'hello.txt', content: '你好' }, context);
  assert.deepEqual(calls, [{ action: 'write_local_file', input: { name: 'hello.txt', content: '你好', overwrite: false } }]);
});

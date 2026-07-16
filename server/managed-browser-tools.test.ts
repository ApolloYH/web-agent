import assert from 'node:assert/strict';
import test from 'node:test';
import { createManagedBrowserTools } from './managed-browser-tools.js';

test('managed browser tool is registered only when worker is configured', () => {
  assert.deepEqual(createManagedBrowserTools(), []);
  assert.equal(createManagedBrowserTools({ url: 'http://127.0.0.1:9140', token: 'test' })[0]?.risk, 'high');
});

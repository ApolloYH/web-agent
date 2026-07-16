import assert from 'node:assert/strict';
import test from 'node:test';
import { agentRunKey, capacityReason } from './concurrency.js';

test('run keys isolate users and conversations', () => {
  assert.notEqual(agentRunKey('a', 'assistant'), agentRunKey('b', 'assistant'));
  assert.notEqual(agentRunKey('a', 'entry', 'chat-1'), agentRunKey('a', 'entry', 'chat-2'));
});

test('capacity enforces global and per-user limits', () => {
  const runs = [{ userId: 'a' }, { userId: 'a' }, { userId: 'b' }];
  assert.equal(capacityReason(runs, 'a', 8, 2), 'user');
  assert.equal(capacityReason(runs, 'c', 4, 2, 1), 'global');
  assert.equal(capacityReason(runs, 'c', 8, 2), null);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { agentRunKey, capacityReason, consumeFixedWindow, pruneExpiredWindows } from './concurrency.js';

test('run keys isolate users and conversations', () => {
  assert.notEqual(agentRunKey('a', 'assistant'), agentRunKey('b', 'assistant'));
  assert.notEqual(agentRunKey('a', 'entry', 'chat-1'), agentRunKey('a', 'entry', 'chat-2'));
});

test('capacity enforces global and per-user limits', () => {
  const runs = [{ userId: 'a' }, { userId: 'a' }, { userId: 'b' }];
  assert.equal(capacityReason(runs, 'a', 8, 2), 'user');
  assert.equal(capacityReason(runs, 'c', 4, 2, 1), 'global');
  assert.equal(capacityReason(runs, 'c', 8, 2, 0, 2), 'user');
  assert.equal(capacityReason(runs, 'c', 8, 2), null);
});

test('fixed windows reject excess attempts and expire', () => {
  const windows = new Map();
  assert.equal(consumeFixedWindow(windows, 'ip', 2, 1_000, 100), 0);
  assert.equal(consumeFixedWindow(windows, 'ip', 2, 1_000, 200), 0);
  assert.equal(consumeFixedWindow(windows, 'ip', 2, 1_000, 300), 1);
  pruneExpiredWindows(windows, 1_100);
  assert.equal(windows.size, 0);
});

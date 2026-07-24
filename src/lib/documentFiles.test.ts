import assert from 'node:assert/strict';
import test from 'node:test';
import { readTextPreview } from './documentFiles';

test('readTextPreview reads only the configured byte limit', async () => {
  const exact = await readTextPreview(new Blob(['hello']), 5);
  assert.deepEqual(exact, { content: 'hello', truncated: false });

  const large = await readTextPreview(new Blob(['abcdefghij']), 4);
  assert.deepEqual(large, { content: 'abcd', truncated: true });
});

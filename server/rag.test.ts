import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { chunkRagByMethod, createRagCollection, ensureRagSchema, ingestRagDocument, searchRag } from './rag.js';

test('RAG templates index documents and keep tenants isolated', async () => {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys = ON; CREATE TABLE users (id TEXT PRIMARY KEY); INSERT INTO users VALUES (\'user-a\'), (\'user-b\');');
  ensureRagSchema(database);

  const collection = createRagCollection(database, 'user-a', '安全制度', '', 'laws');
  await ingestRagDocument(database, 'user-a', collection.id, 'rules.txt', new TextEncoder().encode('第一条 建设单位承担安全责任。\n第二条 作业前必须完成审批。'));

  const hits = await searchRag(database, 'user-a', '安全责任', collection.id);
  assert.equal(hits.length, 1);
  assert.match(hits[0]!.content, /第一条/);
  assert.deepEqual(await searchRag(database, 'user-b', '安全责任'), []);
  assert.equal(chunkRagByMethod('问题：如何报销？\n\n答案：提交发票。', 'qa').length, 1);
  assert.deepEqual(chunkRagByMethod('短文全文', 'one'), ['短文全文']);

  database.close();
});

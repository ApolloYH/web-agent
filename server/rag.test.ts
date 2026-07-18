import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { chunkRagByMethod, createRagCollection, ensureRagSchema, ingestRagDocument, searchRag, updateRagCollection } from './rag.js';

test('RAG templates index documents and keep tenants isolated', async () => {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys = ON; CREATE TABLE users (id TEXT PRIMARY KEY); INSERT INTO users VALUES (\'user-a\'), (\'user-b\');');
  ensureRagSchema(database);

  const collection = createRagCollection(database, 'user-a', '安全制度', '', 'general', 'contextual');
  assert.equal(collection.pipelineTemplate, 'contextual');
  const graph = { nodes: [
    { id: 'source', type: 'source', label: '数据源', description: '', position: { x: 0, y: 0 } },
    { id: 'contextual', type: 'contextual', label: '上下文增强', description: '', position: { x: 300, y: 0 } },
    { id: 'index', type: 'index', label: '知识索引', description: '', position: { x: 600, y: 0 } },
  ], edges: [{ id: 'source-contextual', source: 'source', target: 'contextual' }, { id: 'contextual-index', source: 'contextual', target: 'index' }] };
  assert.equal(updateRagCollection(database, 'user-a', collection.id, { pipelineGraph: graph }).pipelineGraph?.nodes.length, 3);
  assert.throws(() => updateRagCollection(database, 'user-a', collection.id, { pipelineTemplate: 'parent_child' }), /创建知识库时/);
  assert.throws(() => updateRagCollection(database, 'user-a', collection.id, { chunkMethod: 'qa' }), /创建知识库时/);

  const ingesting = ingestRagDocument(database, 'user-a', collection.id, 'rules.txt', new TextEncoder().encode('第一条 建设单位承担安全责任。\n第二条 作业前必须完成审批。'));
  assert.throws(() => updateRagCollection(database, 'user-a', collection.id, { pipelineGraph: null }), /开始处理后/);
  assert.equal(updateRagCollection(database, 'user-a', collection.id, { name: '新版安全制度' }).configurationLocked, true);
  await ingesting;

  const hits = await searchRag(database, 'user-a', '安全责任', collection.id);
  assert.equal(hits.length, 1);
  assert.match(hits[0]!.content, /第一条/);
  assert.match(hits[0]!.content, /^来源文档：rules\.txt/);
  assert.deepEqual(await searchRag(database, 'user-b', '安全责任'), []);
  assert.equal(chunkRagByMethod('问题：如何报销？\n\n答案：提交发票。', 'qa').length, 1);
  assert.deepEqual(chunkRagByMethod('短文全文', 'one'), ['短文全文']);

  database.close();
});

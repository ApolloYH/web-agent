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
    { id: 'extract', type: 'extract', label: '内容提取', description: '', position: { x: 300, y: 0 } },
    { id: 'chunk', type: 'chunk', label: '通用切段', description: '', position: { x: 600, y: 0 } },
    { id: 'contextual', type: 'contextual', label: '上下文增强', description: '', position: { x: 900, y: 0 } },
    { id: 'index', type: 'index', label: '知识索引', description: '', position: { x: 1200, y: 0 } },
  ], edges: [{ id: 'source-extract', source: 'source', target: 'extract' }, { id: 'extract-chunk', source: 'extract', target: 'chunk' }, { id: 'chunk-contextual', source: 'chunk', target: 'contextual' }, { id: 'contextual-index', source: 'contextual', target: 'index' }] };
  assert.equal(updateRagCollection(database, 'user-a', collection.id, { pipelineGraph: graph }).pipelineGraph?.nodes.length, 5);
  assert.throws(() => updateRagCollection(database, 'user-a', collection.id, { pipelineGraph: { nodes: [graph.nodes[0]!, graph.nodes[4]!], edges: [{ id: 'shortcut', source: 'source', target: 'index' }] } }), /内容提取|切段/);
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

  const custom = createRagCollection(database, 'user-a', '自定义流水线', '', 'general', 'custom');
  assert.deepEqual(custom.pipelineGraph?.nodes.map((node) => node.type), ['source', 'extract', 'chunk', 'index']);
  database.prepare('UPDATE rag_collections SET pipeline_graph = ? WHERE id = ?').run(JSON.stringify({ nodes: [custom.pipelineGraph!.nodes[0], custom.pipelineGraph!.nodes[3]], edges: [{ id: 'legacy', source: 'source', target: 'index' }] }), custom.id);
  ensureRagSchema(database);
  assert.deepEqual(JSON.parse((database.prepare('SELECT pipeline_graph AS graph FROM rag_collections WHERE id = ?').get(custom.id) as { graph: string }).graph).nodes.map((item: { type: string }) => item.type), ['source', 'extract', 'chunk', 'index']);

  const generatedQa = createRagCollection(database, 'user-a', '生成问答', '', 'qa', 'llm_qa');
  await assert.rejects(ingestRagDocument(database, 'user-a', generatedQa.id, 'faq.txt', new TextEncoder().encode('Apollo 是一个助理。')), /RAG_CHAT_API_KEY/);

  const parentChild = createRagCollection(database, 'user-a', '父子召回', '', 'manual', 'parent_child');
  await ingestRagDocument(database, 'user-a', parentChild.id, 'manual.txt', new TextEncoder().encode(`# 第一章\n开头说明\n${'甲'.repeat(1_000)}关键术语\n结尾说明`));
  const parentHit = await searchRag(database, 'user-a', '关键术语', parentChild.id);
  assert.match(parentHit[0]!.content, /开头说明/);
  assert.match(parentHit[0]!.content, /结尾说明/);

  database.close();
});

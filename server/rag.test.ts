import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { getLightRagDocumentStatus, getWeKnoraDocumentStatus, insertWeKnoraText } from './rag-engines.js';
import {
  assertMinerUDownloadUrl,
  createRagCollection,
  ensureRagSchema,
  estimateTokenCount,
  getRagCollectionStats,
  getRagDocumentChunks,
  getRagDocumentSource,
  getRagGraph,
  ingestRagDocument,
  refreshRagDocuments,
  retryRagDocument,
  searchRagDetailed,
  updateRagCollection,
} from './rag.js';

test('MinerU only accepts known HTTPS storage hosts', () => {
  assert.equal(assertMinerUDownloadUrl('https://mineru.oss-cn-shanghai.aliyuncs.com/upload?id=1'), 'https://mineru.oss-cn-shanghai.aliyuncs.com/upload?id=1');
  assert.equal(assertMinerUDownloadUrl('https://download.openxlab.org.cn/result.zip'), 'https://download.openxlab.org.cn/result.zip');
  assert.throws(() => assertMinerUDownloadUrl('https://openxlab.org.cn.evil.example/result.zip'), /不受信任/);
  assert.throws(() => assertMinerUDownloadUrl('http://mineru.oss-cn-shanghai.aliyuncs.com/upload'), /不受信任/);
});

test('RAG removes the legacy local-index schema and keeps tenants isolated', async () => {
  const database = new DatabaseSync(':memory:');
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE users (id TEXT PRIMARY KEY);
    INSERT INTO users VALUES ('user-a'), ('user-b');
    CREATE TABLE rag_collections (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
      chunk_method TEXT NOT NULL DEFAULT 'general', pipeline_template TEXT NOT NULL DEFAULT 'general',
      pipeline_graph TEXT NOT NULL DEFAULT '', configuration_locked INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE rag_documents (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, collection_id TEXT NOT NULL, name TEXT NOT NULL,
      size INTEGER NOT NULL, chunk_count INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
    );
    CREATE TABLE rag_chunks (id TEXT PRIMARY KEY, document_id TEXT NOT NULL, content TEXT NOT NULL);
    INSERT INTO rag_collections VALUES ('legacy', 'user-a', '旧测试库', '', 'general', 'qa', '{}', 1, 'now', 'now');
  `);

  ensureRagSchema(database);
  const collectionColumns = (database.prepare('PRAGMA table_info(rag_collections)').all() as Array<{ name: string }>).map((item) => item.name);
  const documentColumns = (database.prepare('PRAGMA table_info(rag_documents)').all() as Array<{ name: string }>).map((item) => item.name);
  assert.equal(collectionColumns.includes('pipeline_template'), false);
  assert.equal(collectionColumns.includes('chunk_method'), false);
  assert.equal(documentColumns.includes('chunk_count'), false);
  assert.equal(documentColumns.includes('token_count'), true);
  assert.equal((database.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE name = 'rag_chunks'").get() as { count: number }).count, 0);

  const collection = createRagCollection(database, 'user-a', '安全制度');
  assert.equal(collection.chunkStrategy, 'automatic');
  assert.equal(collection.chunkSize, 512);
  assert.equal(collection.chunkOverlap, 80);
  assert.equal(collection.parentChild, true);
  const configured = updateRagCollection(database, 'user-a', collection.id, {
    description: '新版制度', parser: 'mineru', chunkStrategy: 'custom', chunkSize: 900, chunkOverlap: 120,
    chunkSeparators: '\\n\\n\n。', parentChild: true, weknoraParentChunkSize: 5000, weknoraChildChunkSize: 500,
    weknoraRecallCount: 9, weknoraRetrievalMode: 'vector', weknoraSimilarityThreshold: 0.45,
    weknoraContextEnrichment: false, lightRagMode: 'mix', graphDepth: 3, lightRagTopK: 16,
    lightRagEntityTypes: '人物\n组织', lightRagMaxExtractionEntities: 30, lightRagRelationConfig: '重点提取责任关系',
    lightRagMaxEntityTokens: 3000, lightRagMaxRelationTokens: 4000, lightRagMaxTotalTokens: 16000,
    finalCount: 5, rerankEnabled: false, rerankerModel: 'custom-reranker',
  });
  assert.equal(configured.description, '新版制度');
  assert.equal(configured.chunkStrategy, 'custom');
  assert.equal(configured.parentChild, true);
  assert.equal(configured.weknoraRetrievalMode, 'vector');
  assert.equal(configured.weknoraSimilarityThreshold, 0.45);
  assert.equal(configured.lightRagEntityTypes, '人物\n组织');
  assert.equal(configured.lightRagMode, 'mix');
  assert.throws(() => updateRagCollection(database, 'user-a', collection.id, { chunkOverlap: 900 }), /重叠长度/);
  const empty = await searchRagDetailed(database, 'user-a', '安全责任', collection.id);
  assert.deepEqual(empty.hits, []);
  assert.deepEqual(empty.engines.map((item) => item.engine), ['weknora', 'lightrag']);
  await assert.rejects(searchRagDetailed(database, 'user-b', '安全责任', collection.id), /知识库不存在/);
  database.close();
});

test('RAG engine adapters expose real processing progress', async () => {
  const server = createServer((request, response) => {
    const url = new URL(request.url || '/', 'http://localhost');
    response.setHeader('Content-Type', 'application/json');
    if (url.pathname === '/api/v1/knowledge/wk-progress') return response.end(JSON.stringify({ success: true, data: { parse_status: 'processing' } }));
    if (url.pathname === '/api/v1/knowledge/wk-progress/spans') return response.end(JSON.stringify({
      success: true,
      data: {
        current_stage: 'embedding',
        trace: { children: [
          { name: 'docreader', kind: 'stage', status: 'done' },
          { name: 'chunking', kind: 'stage', status: 'done' },
          { name: 'embedding', kind: 'stage', status: 'running' },
          { name: 'multimodal', kind: 'stage', status: 'pending' },
          { name: 'postprocess', kind: 'stage', status: 'pending' },
        ] },
      },
    }));
    if (/\/documents\/track_status\/lr-progress$/.test(url.pathname)) return response.end(JSON.stringify({ documents: [{ id: 'doc-progress', status: 'processing', chunks_count: 698 }] }));
    if (/\/documents\/pipeline_status$/.test(url.pathname)) return response.end(JSON.stringify({ latest_message: 'Chunk 26 of 698 extracted 36 Ent + 43 Rel doc-progress-chunk-025' }));
    response.statusCode = 404;
    response.end('{}');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const services = {
      weknoraBaseUrl: `${baseUrl}/api/v1`, weknoraApiKey: 'wk-key', weknoraEmbeddingModelId: 'wk-model',
      lightRagBaseUrlTemplate: `${baseUrl}/light/{collectionId}`, lightRagApiKey: 'lr-key',
    };
    const weknora = await getWeKnoraDocumentStatus('wk-progress', services);
    assert.deepEqual(weknora.progress, { stage: 'embedding', current: 2, total: 5, percent: 40 });
    const lightrag = await getLightRagDocumentStatus('collection-a', 'lr-progress', services);
    assert.deepEqual(lightrag.progress, { stage: 'processing', current: 26, total: 698, percent: 4 });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('RAG uploads, queries and exposes the LightRAG graph', async () => {
  const requests: Array<{ method: string; path: string; search: string; body: string; workspace: string; lightRagConfig: string }> = [];
  const server = createServer(async (request, response) => {
    const url = new URL(request.url || '/', 'http://localhost');
    const chunks: Buffer[] = [];
    request.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    await new Promise<void>((resolve) => request.on('end', resolve));
    requests.push({ method: request.method || '', path: url.pathname, search: url.search, body: Buffer.concat(chunks).toString('utf8'), workspace: String(request.headers['lightrag-workspace'] || ''), lightRagConfig: String(request.headers['x-apollo-lightrag-config'] || '') });
    response.setHeader('Content-Type', 'application/json');
    if (request.method === 'POST' && url.pathname === '/api/v1/knowledge-bases') return response.end(JSON.stringify({ success: true, data: { id: 'wk-kb-1' } }));
    if (request.method === 'POST' && url.pathname === '/api/v1/knowledge-bases/wk-kb-1/knowledge/manual') return response.end(JSON.stringify({ success: true, data: { id: 'wk-manual-1', parse_status: 'processing' } }));
    if (request.method === 'POST' && url.pathname === '/api/v1/knowledge-bases/wk-kb-1/knowledge/file') return response.end(JSON.stringify({ success: true, data: { id: 'wk-doc-1', parse_status: 'processing' } }));
    if (request.method === 'GET' && url.pathname === '/api/v1/knowledge/wk-doc-1') return response.end(JSON.stringify({ success: true, data: { parse_status: 'completed' } }));
    if (request.method === 'GET' && url.pathname === '/api/v1/chunks/wk-doc-1') return response.end(JSON.stringify({ success: true, total: 2, data: [{ id: 'chunk-1', chunk_index: 0, content: '建设单位承担安全责任。' }, { id: 'chunk-2', chunk_index: 1, content: '作业前必须完成审批。' }] }));
    if (request.method === 'GET' && url.pathname === '/api/v1/knowledge/wk-doc-1/download') { response.setHeader('Content-Type', 'text/plain'); return response.end('建设单位承担安全责任。'); }
    if (request.method === 'POST' && url.pathname === '/api/v1/knowledge-bases/wk-kb-1/hybrid-search') return response.end(JSON.stringify({ success: true, data: [{ id: 'wk-chunk-1', knowledge_id: 'wk-doc-1', knowledge_filename: 'rules.txt', chunk_index: 0, content: 'WeKnora：建设单位承担安全责任。', score: 0.96 }] }));
    if (request.method === 'POST' && /\/light\/[^/]+\/documents\/upload$/.test(url.pathname)) return response.end(JSON.stringify({ status: 'success', track_id: 'lr-track-1' }));
    if (request.method === 'POST' && /\/light\/[^/]+\/documents\/text$/.test(url.pathname)) return response.end(JSON.stringify({ status: 'success', track_id: 'lr-track-2' }));
    if (request.method === 'DELETE' && /\/light\/[^/]+\/documents\/delete_document$/.test(url.pathname)) return response.end(JSON.stringify({ status: 'deletion_started' }));
    if (request.method === 'GET' && /\/light\/[^/]+\/documents\/track_status\/lr-track-1$/.test(url.pathname)) return response.end(JSON.stringify({ documents: [{ id: 'lr-doc-1', status: 'processed' }] }));
    if (request.method === 'POST' && /\/light\/[^/]+\/documents\/reprocess_failed$/.test(url.pathname)) return response.end(JSON.stringify({ status: 'reprocessing_started' }));
    if (request.method === 'POST' && /\/light\/[^/]+\/query\/data$/.test(url.pathname)) return response.end(JSON.stringify({ status: 'success', data: { chunks: [{ chunk_id: 'lr-chunk-1', file_path: 'rules.txt', content: 'LightRAG：审批关系来自制度图谱。' }], relationships: [] } }));
    if (request.method === 'GET' && /\/light\/[^/]+\/graph\/label\/popular$/.test(url.pathname)) return response.end(JSON.stringify(['审批']));
    if (request.method === 'GET' && /\/light\/[^/]+\/graphs$/.test(url.pathname)) return response.end(JSON.stringify({ nodes: [{ id: '审批', labels: ['PROCESS'], properties: { description: '作业前置条件' } }, { id: '作业', labels: ['ACTIVITY'], properties: {} }], edges: [{ id: 'edge-1', source: '作业', target: '审批', type: 'REQUIRES', properties: {} }] }));
    response.statusCode = 404;
    response.end(JSON.stringify({ message: 'not found' }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const services = {
    weknoraBaseUrl: `${baseUrl}/api/v1`,
    weknoraApiKey: 'wk-key',
    weknoraEmbeddingModelId: 'wk-embedding-1',
    lightRagBaseUrlTemplate: `${baseUrl}/light/{collectionId}`,
    lightRagApiKey: 'lr-key',
  };
  await insertWeKnoraText('wk-kb-1', 'manual.txt', '人工录入内容', services);
  const database = new DatabaseSync(':memory:');
  database.exec("PRAGMA foreign_keys = ON; CREATE TABLE users (id TEXT PRIMARY KEY); INSERT INTO users VALUES ('user-a');");
  ensureRagSchema(database);
  try {
    const created = createRagCollection(database, 'user-a', '双引擎制度库');
    const collection = updateRagCollection(database, 'user-a', created.id, {
      chunkStrategy: 'recursive', chunkSize: 700, chunkOverlap: 70, chunkSeparators: '\\n\\n\n。', parentChild: true,
      weknoraRecallCount: 7, weknoraRetrievalMode: 'keyword', weknoraSimilarityThreshold: 0.4,
      weknoraContextEnrichment: false, lightRagMode: 'mix', graphDepth: 3, lightRagTopK: 9,
      lightRagEntityTypes: '人物\n组织', lightRagMaxExtractionEntities: 36, lightRagRelationConfig: '重点提取责任关系',
      lightRagMaxEntityTokens: 3000, lightRagMaxRelationTokens: 4000, lightRagMaxTotalTokens: 16000,
      finalCount: 4, rerankEnabled: false,
    });
    await assert.rejects(
      ingestRagDocument(database, 'user-a', collection.id, 'legacy.doc', new Uint8Array([1]), services),
      /旧版 DOC 需要 MinerU/,
    );
    const inserted = await ingestRagDocument(database, 'user-a', collection.id, 'rules.txt', new TextEncoder().encode('建设单位承担安全责任。'), services);
    assert.equal(inserted.weknoraStatus, 'pending');
    assert.equal(inserted.lightRagStatus, 'pending');
    const [refreshed] = await refreshRagDocuments(database, 'user-a', collection.id, services);
    assert.equal(refreshed?.status, 'ready');
    const preview = await getRagDocumentChunks(database, 'user-a', inserted.id, services);
    assert.equal(preview.total, 2);
    assert.equal(preview.chunks[1]?.content, '作业前必须完成审批。');
    const stats = await getRagCollectionStats(database, 'user-a', collection.id, services);
    assert.deepEqual(stats, {
      tokenCount: estimateTokenCount('建设单位承担安全责任。\n作业前必须完成审批。'),
      chunkCount: 2, countedDocumentCount: 1, documentCount: 1, estimated: true,
    });
    const source = await getRagDocumentSource(database, 'user-a', inserted.id, services);
    assert.equal(new TextDecoder().decode(source.bytes), '建设单位承担安全责任。');

    const result = await searchRagDetailed(database, 'user-a', '作业审批责任', collection.id, 6, services);
    assert.deepEqual(new Set(result.hits.map((hit) => hit.engine)), new Set(['weknora', 'lightrag']));
    await searchRagDetailed(database, 'user-a', '你好', collection.id, 6, services);
    assert.throws(() => updateRagCollection(database, 'user-a', collection.id, { chunkSize: 800 }), /已有文档/);
    assert.equal(updateRagCollection(database, 'user-a', collection.id, { finalCount: 3 }).finalCount, 3);
    const graph = await getRagGraph(database, 'user-a', collection.id, '', services);
    assert.equal(graph.label, '审批');
    assert.equal(graph.nodes.length, 2);
    assert.deepEqual(graph.edges[0], { id: 'edge-1', source: '作业', target: '审批', type: 'REQUIRES', properties: {} });
    database.prepare("UPDATE rag_documents SET lightrag_status = 'failed' WHERE id = ?").run(inserted.id);
    await retryRagDocument(database, 'user-a', inserted.id, services);
    database.prepare("UPDATE rag_documents SET lightrag_status = 'failed', lightrag_error = 'legacy source file not found: rules.txt' WHERE id = ?").run(inserted.id);
    await retryRagDocument(database, 'user-a', inserted.id, services);
    assert.ok(requests.filter((item) => item.path.startsWith('/light/')).every((item) => item.workspace === collection.id.replaceAll('-', '_')));
    const createRequest = requests.find((item) => item.path.endsWith('/knowledge-bases'))!;
    const createBody = JSON.parse(createRequest.body) as { embedding_model_id: string; chunking_config: Record<string, unknown> };
    assert.equal(createBody.embedding_model_id, 'wk-embedding-1');
    assert.deepEqual(createBody.chunking_config, {
      chunk_size: 700, chunk_overlap: 70, separators: ['\n\n', '。'], strategy: 'recursive',
      enable_parent_child: true, parent_chunk_size: 4096, child_chunk_size: 384,
    });
    const lightRagUpload = requests.find((item) => item.path.endsWith('/documents/upload'))!;
    assert.match(lightRagUpload.body, new RegExp(`apollo-${inserted.id}-rules\\.txt`));
    assert.deepEqual(JSON.parse(Buffer.from(lightRagUpload.lightRagConfig, 'base64url').toString()), {
      entityTypes: '人物\n组织', maxExtractionEntities: 36, relationConfig: '重点提取责任关系',
    });
    const lightRagRetry = requests.find((item) => item.path.endsWith('/documents/reprocess_failed'))!;
    assert.deepEqual(JSON.parse(Buffer.from(lightRagRetry.lightRagConfig, 'base64url').toString()), {
      entityTypes: '人物\n组织', maxExtractionEntities: 36, relationConfig: '重点提取责任关系',
    });
    const recoveredText = JSON.parse(requests.find((item) => item.path.endsWith('/documents/text'))!.body) as { text: string };
    assert.match(recoveredText.text, /建设单位承担安全责任/);
    assert.equal(JSON.parse(requests.find((item) => item.path.endsWith('/knowledge/manual'))!.body).status, 'publish');
    assert.deepEqual(JSON.parse(requests.find((item) => item.path.endsWith('/hybrid-search'))!.body), {
      query_text: '作业审批责任',
      match_count: 7,
      vector_threshold: 0.4,
      keyword_threshold: 0.4,
      disable_keywords_match: false,
      disable_vector_match: true,
      skip_context_enrichment: true,
    });
    assert.deepEqual(JSON.parse(requests.find((item) => item.path.endsWith('/query/data'))!.body), {
      query: '作业审批责任', mode: 'mix', hl_keywords: ['作业审批责任'], ll_keywords: ['作业审批责任'], top_k: 9, chunk_top_k: 9, enable_rerank: false,
      max_entity_tokens: 3000, max_relation_tokens: 4000, max_total_tokens: 16000,
    });
    const shortQuery = requests.filter((item) => item.path.endsWith('/query/data')).map((item) => JSON.parse(item.body) as { query: string }).find((item) => item.query.startsWith('你好'));
    assert.equal(shortQuery?.query, '你好？');
    assert.equal(requests.find((item) => item.path.endsWith('/graphs'))!.search, '?label=%E5%AE%A1%E6%89%B9&max_depth=3&max_nodes=60');
  } finally {
    database.close();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

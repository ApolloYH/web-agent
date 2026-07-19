export type ExternalRagServices = {
  weknoraBaseUrl?: string;
  weknoraApiKey?: string;
  weknoraEmbeddingModelId?: string;
  lightRagBaseUrlTemplate?: string;
  lightRagApiKey?: string;
  externalTimeoutMs?: number;
};

export type ExternalEngineHit = {
  id: string;
  documentExternalId?: string;
  documentName: string;
  position: number;
  content: string;
  score?: number;
};

export type ExternalEngineStatus = 'unconfigured' | 'pending' | 'ready' | 'failed';

export type LightRagGraph = {
  label: string;
  labels: string[];
  nodes: Array<{ id: string; labels: string[]; properties: Record<string, unknown> }>;
  edges: Array<{ id: string; source: string; target: string; type: string; properties: Record<string, unknown> }>;
};

type LightRagBuildConfig = { entityTypes: string; maxExtractionEntities: number; relationConfig: string };

type WeKnoraEnvelope<T> = { success?: boolean; data?: T; message?: string; error?: string };

export function weknoraConfigured(services: ExternalRagServices): boolean {
  return Boolean(services.weknoraBaseUrl && services.weknoraApiKey && services.weknoraEmbeddingModelId);
}

export function lightRagConfigured(services: ExternalRagServices): boolean {
  return Boolean(services.lightRagBaseUrlTemplate && services.lightRagApiKey);
}

export async function createWeKnoraKnowledgeBase(
  name: string,
  description: string,
  chunking: { size: number; overlap: number; separators: string[]; parentChild: boolean; parentChunkSize: number; childChunkSize: number; strategy: string },
  services: ExternalRagServices,
): Promise<string> {
  const response = await engineJson<WeKnoraEnvelope<{ id?: string }>>(
    engineUrl(services.weknoraBaseUrl!, '/knowledge-bases'),
    {
      method: 'POST',
      headers: apiHeaders(services.weknoraApiKey!),
      body: JSON.stringify({
        name,
        description,
        type: 'document',
        is_temporary: false,
        embedding_model_id: services.weknoraEmbeddingModelId,
        chunking_config: {
          chunk_size: chunking.size,
          chunk_overlap: chunking.overlap,
          separators: chunking.separators,
          strategy: chunking.strategy,
          enable_parent_child: chunking.parentChild,
          parent_chunk_size: chunking.parentChunkSize,
          child_chunk_size: chunking.childChunkSize,
        },
      }),
    },
    services,
  );
  if (!response.success || !response.data?.id) throw new Error(response.message || response.error || 'WeKnora 创建知识库失败');
  return response.data.id;
}

export async function insertWeKnoraText(
  knowledgeBaseId: string,
  title: string,
  text: string,
  services: ExternalRagServices,
): Promise<{ id: string; status: ExternalEngineStatus }> {
  const response = await engineJson<WeKnoraEnvelope<{ id?: string; parse_status?: string }>>(
    engineUrl(services.weknoraBaseUrl!, `/knowledge-bases/${encodeURIComponent(knowledgeBaseId)}/knowledge/manual`),
    {
      method: 'POST',
      headers: apiHeaders(services.weknoraApiKey!),
      body: JSON.stringify({ title, content: text, status: 'publish', channel: 'apollo' }),
    },
    services,
  );
  if (!response.success || !response.data?.id) throw new Error(response.message || response.error || 'WeKnora 文档入库失败');
  return { id: response.data.id, status: weknoraStatus(response.data.parse_status) };
}

export async function insertWeKnoraFile(
  knowledgeBaseId: string,
  name: string,
  bytes: Uint8Array,
  services: ExternalRagServices,
): Promise<{ id: string; status: ExternalEngineStatus }> {
  const form = new FormData();
  form.append('file', new Blob([bytes.slice().buffer as ArrayBuffer]), name);
  form.append('fileName', name);
  form.append('channel', 'apollo');
  form.append('process_config', JSON.stringify({ parser_engine_rules: [{ file_types: [extensionOf(name)], engine: 'builtin' }] }));
  const response = await engineJson<WeKnoraEnvelope<{ id?: string; parse_status?: string }>>(
    engineUrl(services.weknoraBaseUrl!, `/knowledge-bases/${encodeURIComponent(knowledgeBaseId)}/knowledge/file`),
    { method: 'POST', headers: apiHeaders(services.weknoraApiKey!, false), body: form },
    services,
  );
  if (!response.success || !response.data?.id) throw new Error(response.message || response.error || 'WeKnora 文件入库失败');
  return { id: response.data.id, status: weknoraStatus(response.data.parse_status) };
}

export async function getWeKnoraDocumentStatus(
  knowledgeId: string,
  services: ExternalRagServices,
): Promise<{ status: ExternalEngineStatus; error: string }> {
  const response = await engineJson<WeKnoraEnvelope<{ parse_status?: string; error_message?: string }>>(
    engineUrl(services.weknoraBaseUrl!, `/knowledge/${encodeURIComponent(knowledgeId)}`),
    { headers: apiHeaders(services.weknoraApiKey!, false) },
    services,
  );
  if (!response.success || !response.data) throw new Error(response.message || response.error || 'WeKnora 状态查询失败');
  return { status: weknoraStatus(response.data.parse_status), error: response.data.error_message || '' };
}

export async function reparseWeKnoraDocument(knowledgeId: string, services: ExternalRagServices): Promise<ExternalEngineStatus> {
  const response = await engineJson<WeKnoraEnvelope<{ parse_status?: string }>>(
    engineUrl(services.weknoraBaseUrl!, `/knowledge/${encodeURIComponent(knowledgeId)}/reparse`),
    { method: 'POST', headers: apiHeaders(services.weknoraApiKey!, false) },
    services,
  );
  if (!response.success) throw new Error(response.message || response.error || 'WeKnora 重新解析失败');
  return weknoraStatus(response.data?.parse_status);
}

export async function deleteWeKnoraDocument(knowledgeId: string, services: ExternalRagServices): Promise<void> {
  const response = await engineJson<WeKnoraEnvelope<unknown>>(
    engineUrl(services.weknoraBaseUrl!, `/knowledge/${encodeURIComponent(knowledgeId)}`),
    { method: 'DELETE', headers: apiHeaders(services.weknoraApiKey!, false) },
    services,
  );
  if (!response.success) throw new Error(response.message || response.error || 'WeKnora 删除文档失败');
}

export async function deleteWeKnoraKnowledgeBase(knowledgeBaseId: string, services: ExternalRagServices): Promise<void> {
  const response = await engineJson<WeKnoraEnvelope<unknown>>(
    engineUrl(services.weknoraBaseUrl!, `/knowledge-bases/${encodeURIComponent(knowledgeBaseId)}`),
    { method: 'DELETE', headers: apiHeaders(services.weknoraApiKey!, false) },
    services,
  );
  if (!response.success) throw new Error(response.message || response.error || 'WeKnora 删除知识库失败');
}

export async function searchWeKnora(
  knowledgeBaseId: string,
  query: string,
  limit: number,
  mode: 'vector' | 'keyword' | 'hybrid',
  similarityThreshold: number,
  contextEnrichment: boolean,
  services: ExternalRagServices,
): Promise<ExternalEngineHit[]> {
  const response = await engineJson<WeKnoraEnvelope<Array<{
    id?: string; content?: string; knowledge_id?: string; chunk_index?: number; knowledge_title?: string;
    knowledge_filename?: string; score?: number;
  }>>>(
    engineUrl(services.weknoraBaseUrl!, `/knowledge-bases/${encodeURIComponent(knowledgeBaseId)}/hybrid-search`),
    {
      method: 'POST',
      headers: apiHeaders(services.weknoraApiKey!),
      body: JSON.stringify({
        query_text: query,
        match_count: limit,
        vector_threshold: similarityThreshold,
        keyword_threshold: similarityThreshold,
        disable_keywords_match: mode === 'vector',
        disable_vector_match: mode === 'keyword',
        skip_context_enrichment: !contextEnrichment,
      }),
    },
    services,
  );
  if (!response.success || !Array.isArray(response.data)) throw new Error(response.message || response.error || 'WeKnora 检索失败');
  return response.data.filter((item) => item.content).map((item, index) => ({
    id: item.id || `weknora-${index}`,
    documentExternalId: item.knowledge_id,
    documentName: item.knowledge_filename || item.knowledge_title || 'WeKnora 文档',
    position: item.chunk_index ?? index,
    content: item.content!,
    score: item.score,
  }));
}

export async function insertLightRagText(
  collectionId: string,
  documentId: string,
  title: string,
  text: string,
  buildConfig: LightRagBuildConfig,
  services: ExternalRagServices,
): Promise<{ trackId: string; fileSource: string }> {
  const fileSource = `apollo-${documentId}-${safeFileName(title)}`;
  const response = await engineJson<{ status?: string; message?: string; track_id?: string }>(
    lightRagUrl(services, collectionId, '/documents/text'),
    {
      method: 'POST',
      headers: lightRagHeaders(services.lightRagApiKey!, collectionId, true, buildConfig),
      body: JSON.stringify({ text, file_source: fileSource }),
    },
    services,
  );
  if (response.status !== 'success' || !response.track_id) throw new Error(response.message || 'LightRAG 文档入库失败');
  return { trackId: response.track_id, fileSource };
}

export async function insertLightRagFile(
  collectionId: string,
  documentId: string,
  name: string,
  bytes: Uint8Array,
  buildConfig: LightRagBuildConfig,
  services: ExternalRagServices,
): Promise<{ trackId: string; fileSource: string }> {
  const fileSource = `apollo-${documentId}-${safeFileName(name)}`;
  const form = new FormData();
  form.append('file', new Blob([bytes.slice().buffer as ArrayBuffer]), fileSource);
  const response = await engineJson<{ status?: string; message?: string; track_id?: string }>(
    lightRagUrl(services, collectionId, '/documents/upload'),
    { method: 'POST', headers: lightRagHeaders(services.lightRagApiKey!, collectionId, false, buildConfig), body: form },
    services,
  );
  if (response.status !== 'success' || !response.track_id) throw new Error(response.message || 'LightRAG 文件入库失败');
  return { trackId: response.track_id, fileSource };
}

export async function getLightRagDocumentStatus(
  collectionId: string,
  trackId: string,
  services: ExternalRagServices,
): Promise<{ status: ExternalEngineStatus; documentId: string; error: string }> {
  const response = await engineJson<{
    documents?: Array<{ id?: string; status?: string; error_msg?: string }>;
  }>(lightRagUrl(services, collectionId, `/documents/track_status/${encodeURIComponent(trackId)}`), {
    headers: lightRagHeaders(services.lightRagApiKey!, collectionId, false),
  }, services);
  const document = response.documents?.[0];
  if (!document) return { status: 'pending', documentId: '', error: '' };
  const status = String(document.status || '').toLowerCase();
  return {
    status: status === 'processed' ? 'ready' : status === 'failed' ? 'failed' : 'pending',
    documentId: document.id || '',
    error: document.error_msg || '',
  };
}

export async function reprocessLightRagFailed(collectionId: string, buildConfig: LightRagBuildConfig, services: ExternalRagServices): Promise<void> {
  const response = await engineJson<{ status?: string; message?: string }>(
    lightRagUrl(services, collectionId, '/documents/reprocess_failed'),
    { method: 'POST', headers: lightRagHeaders(services.lightRagApiKey!, collectionId, false, buildConfig) },
    services,
  );
  if (response.status !== 'reprocessing_started') throw new Error(response.message || 'LightRAG 重试失败文档失败');
}

export async function deleteLightRagDocument(collectionId: string, documentId: string, services: ExternalRagServices): Promise<void> {
  const response = await engineJson<{ status?: string; message?: string }>(
    lightRagUrl(services, collectionId, '/documents/delete_document'),
    {
      method: 'DELETE',
      headers: lightRagHeaders(services.lightRagApiKey!, collectionId),
      body: JSON.stringify({ doc_ids: [documentId], delete_file: false, delete_llm_cache: false }),
    },
    services,
  );
  if (response.status !== 'deletion_started') throw new Error(response.message || 'LightRAG 删除文档失败');
}

export async function searchLightRag(
  collectionId: string,
  query: string,
  limit: number,
  mode: 'local' | 'global' | 'hybrid' | 'mix',
  tokenBudget: { entity: number; relation: number; total: number },
  services: ExternalRagServices,
): Promise<ExternalEngineHit[]> {
  const response = await engineJson<{
    status?: string;
    message?: string;
    data?: {
      entities?: Array<{ entity_name?: string; entity_type?: string; description?: string; file_path?: string; reference_id?: string }>;
      relationships?: Array<{ src_id?: string; tgt_id?: string; description?: string; file_path?: string; reference_id?: string; weight?: number }>;
      chunks?: Array<{ content?: string; file_path?: string; chunk_id?: string; reference_id?: string }>;
    };
  }>(lightRagUrl(services, collectionId, '/query/data'), {
    method: 'POST',
    headers: lightRagHeaders(services.lightRagApiKey!, collectionId),
    body: JSON.stringify({
      query,
      mode,
      top_k: limit,
      chunk_top_k: limit,
      enable_rerank: false,
      ...(tokenBudget.entity ? { max_entity_tokens: tokenBudget.entity } : {}),
      ...(tokenBudget.relation ? { max_relation_tokens: tokenBudget.relation } : {}),
      ...(tokenBudget.total ? { max_total_tokens: tokenBudget.total } : {}),
    }),
  }, services);
  if (response.status !== 'success' || !response.data) throw new Error(response.message || 'LightRAG 图谱检索失败');
  const hits: ExternalEngineHit[] = [];
  for (const chunk of response.data.chunks || []) if (chunk.content) hits.push({
    id: chunk.chunk_id || `lightrag-chunk-${hits.length}`,
    documentName: chunk.file_path || 'LightRAG 文档',
    position: hits.length,
    content: chunk.content,
  });
  for (const relation of response.data.relationships || []) if (relation.description) hits.push({
    id: `lightrag-relation-${relation.reference_id || hits.length}`,
    documentName: relation.file_path || 'LightRAG 图谱',
    position: hits.length,
    content: `关系：${relation.src_id || '未知实体'} → ${relation.tgt_id || '未知实体'}\n${relation.description}`,
    score: relation.weight,
  });
  for (const entity of response.data.entities || []) if (entity.description) hits.push({
    id: `lightrag-entity-${entity.reference_id || hits.length}`,
    documentName: entity.file_path || 'LightRAG 图谱',
    position: hits.length,
    content: `实体：${entity.entity_name || '未知实体'}${entity.entity_type ? `（${entity.entity_type}）` : ''}\n${entity.description}`,
  });
  return hits.slice(0, Math.max(limit * 3, limit));
}

export async function getLightRagGraph(collectionId: string, label: string, depth: number, services: ExternalRagServices): Promise<LightRagGraph> {
  const labels = await engineJson<string[]>(
    lightRagUrl(services, collectionId, '/graph/label/popular?limit=100'),
    { headers: lightRagHeaders(services.lightRagApiKey!, collectionId, false) },
    services,
  );
  const selected = label.trim() || labels[0] || '';
  if (!selected) return { label: '', labels, nodes: [], edges: [] };
  const graph = await engineJson<Pick<LightRagGraph, 'nodes' | 'edges'>>(
    lightRagUrl(services, collectionId, `/graphs?label=${encodeURIComponent(selected)}&max_depth=${depth}&max_nodes=200`),
    { headers: lightRagHeaders(services.lightRagApiKey!, collectionId, false) },
    services,
  );
  return { label: selected, labels, nodes: graph.nodes || [], edges: graph.edges || [] };
}

function lightRagUrl(services: ExternalRagServices, collectionId: string, path: string): string {
  const template = services.lightRagBaseUrlTemplate || '';
  if (!template.includes('{collectionId}')) throw new Error('LIGHTRAG_BASE_URL_TEMPLATE 必须包含 {collectionId}，以隔离每个知识库');
  return engineUrl(template.replaceAll('{collectionId}', encodeURIComponent(collectionId)), path);
}

function engineUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, '')}${path}`;
}

function apiHeaders(apiKey: string, json = true): Record<string, string> {
  return { 'X-API-Key': apiKey, ...(json ? { 'Content-Type': 'application/json' } : {}) };
}

function lightRagHeaders(apiKey: string, collectionId: string, json = true, buildConfig?: LightRagBuildConfig): Record<string, string> {
  const configured = buildConfig && (buildConfig.entityTypes.trim() || buildConfig.relationConfig.trim() || buildConfig.maxExtractionEntities > 0);
  return {
    ...apiHeaders(apiKey, json),
    'LIGHTRAG-WORKSPACE': collectionId.replace(/[^a-zA-Z0-9_]/g, '_'),
    ...(configured ? { 'X-Apollo-LightRAG-Config': Buffer.from(JSON.stringify(buildConfig)).toString('base64url') } : {}),
  };
}

async function engineJson<T>(url: string, init: RequestInit, services: ExternalRagServices): Promise<T> {
  const timeout = Math.max(1_000, Math.min(300_000, services.externalTimeoutMs || 300_000));
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeout) });
  const body = await response.json().catch(() => ({})) as T & { detail?: string; message?: string; error?: string };
  if (!response.ok) throw new Error(body.detail || body.message || body.error || `外部知识引擎请求失败 ${response.status}`);
  return body;
}

function safeFileName(value: string): string {
  return value.replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(-100) || 'document.md';
}

function extensionOf(value: string): string {
  return value.includes('.') ? value.slice(value.lastIndexOf('.')).toLowerCase() : '';
}

function weknoraStatus(value?: string): ExternalEngineStatus {
  return value === 'completed' ? 'ready' : ['failed', 'cancelled'].includes(value || '') ? 'failed' : 'pending';
}

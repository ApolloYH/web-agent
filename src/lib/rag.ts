export type RagCollection = {
  id: string;
  name: string;
  description: string;
  parser: RagParser;
  chunkStrategy: RagChunkStrategy;
  chunkSize: number;
  chunkOverlap: number;
  chunkSeparators: string;
  parentChild: boolean;
  weknoraParentChunkSize: number;
  weknoraChildChunkSize: number;
  weknoraRecallCount: number;
  weknoraRetrievalMode: WeKnoraRetrievalMode;
  weknoraSimilarityThreshold: number;
  weknoraContextEnrichment: boolean;
  lightRagMode: LightRagMode;
  graphDepth: number;
  lightRagTopK: number;
  lightRagEntityTypes: string;
  lightRagMaxExtractionEntities: number;
  lightRagRelationConfig: string;
  lightRagMaxEntityTokens: number;
  lightRagMaxRelationTokens: number;
  lightRagMaxTotalTokens: number;
  finalCount: number;
  rerankEnabled: boolean;
  rerankerModel: string;
  weknoraStatus: RagEngineStatus;
  lightRagStatus: RagEngineStatus;
  weknoraError: string;
  lightRagError: string;
  documentCount: number;
  createdAt: string;
  updatedAt: string;
};

export type RagParser = 'native' | 'mineru';
export type RagChunkStrategy = 'automatic' | 'structured' | 'heuristic' | 'recursive' | 'custom';
export type WeKnoraRetrievalMode = 'vector' | 'keyword' | 'hybrid';
export type LightRagMode = 'local' | 'global' | 'hybrid' | 'mix';
export type RagCollectionPatch = Partial<Pick<RagCollection,
  'name' | 'description' | 'parser' | 'chunkStrategy' | 'chunkSize' | 'chunkOverlap' | 'chunkSeparators' |
  'parentChild' | 'weknoraParentChunkSize' | 'weknoraChildChunkSize' | 'weknoraRecallCount' | 'weknoraRetrievalMode' |
  'weknoraSimilarityThreshold' | 'weknoraContextEnrichment' | 'lightRagMode' | 'graphDepth' | 'lightRagTopK' |
  'lightRagEntityTypes' | 'lightRagMaxExtractionEntities' | 'lightRagRelationConfig' | 'lightRagMaxEntityTokens' |
  'lightRagMaxRelationTokens' | 'lightRagMaxTotalTokens' | 'finalCount' | 'rerankEnabled' | 'rerankerModel'
>>;

export type RagGraph = {
  label: string;
  labels: string[];
  nodes: Array<{ id: string; labels: string[]; properties: Record<string, unknown> }>;
  edges: Array<{ id: string; source: string; target: string; type: string; properties: Record<string, unknown> }>;
};

export type RagDocument = {
  id: string;
  collectionId: string;
  name: string;
  size: number;
  status: RagEngineStatus | 'partial';
  weknoraStatus: RagEngineStatus;
  lightRagStatus: RagEngineStatus;
  weknoraError: string;
  lightRagError: string;
  createdAt: string;
  updatedAt: string;
};

export type RagChunkPreview = { id: string; index: number; content: string };

export type RagEngineStatus = 'unconfigured' | 'pending' | 'ready' | 'failed';

export type RagHit = {
  id: string;
  collectionId: string;
  collectionName: string;
  documentId: string;
  documentName: string;
  position: number;
  content: string;
  engine?: 'weknora' | 'lightrag';
  score?: number;
};

export type RagEngineReport = {
  engine: 'weknora' | 'lightrag' | 'reranker';
  status: 'ok' | 'partial' | 'error' | 'unconfigured';
  hitCount: number;
  latencyMs: number;
  error?: string;
};

export type RagSearchResult = { hits: RagHit[]; engines: RagEngineReport[] };

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? `RAG 请求失败 ${response.status}`);
  }
  return response.json();
}

export async function listRagCollections(): Promise<RagCollection[]> {
  return (await request<{ collections: RagCollection[] }>('/apollo-api/rag')).collections;
}

export async function createRagCollection(name: string, description: string): Promise<RagCollection> {
  return (await request<{ collection: RagCollection }>('/apollo-api/rag', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, description }),
  })).collection;
}

export async function updateRagCollection(id: string, patch: RagCollectionPatch): Promise<RagCollection> {
  return (await request<{ collection: RagCollection }>(`/apollo-api/rag/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })).collection;
}

export async function deleteRagCollection(id: string): Promise<void> {
  await request(`/apollo-api/rag/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function listRagDocuments(collectionId: string): Promise<RagDocument[]> {
  return (await request<{ documents: RagDocument[] }>(`/apollo-api/rag/${encodeURIComponent(collectionId)}/documents`)).documents;
}

export async function getRagGraph(collectionId: string, label = ''): Promise<RagGraph> {
  return request<RagGraph>(`/apollo-api/rag/${encodeURIComponent(collectionId)}/graph${label ? `?label=${encodeURIComponent(label)}` : ''}`);
}

export async function uploadRagDocuments(collectionId: string, files: File[]): Promise<RagDocument[]> {
  const form = new FormData();
  files.forEach((file) => form.append('files', file, file.name));
  return (await request<{ documents: RagDocument[] }>(`/apollo-api/rag/${encodeURIComponent(collectionId)}/documents`, { method: 'POST', body: form })).documents;
}

export async function deleteRagDocument(id: string): Promise<void> {
  await request(`/apollo-api/rag/documents/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function retryRagDocument(id: string): Promise<RagDocument> {
  return (await request<{ document: RagDocument }>(`/apollo-api/rag/documents/${encodeURIComponent(id)}/retry`, { method: 'POST' })).document;
}

export async function getRagDocumentChunks(id: string): Promise<{ chunks: RagChunkPreview[]; total: number }> {
  return request(`/apollo-api/rag/documents/${encodeURIComponent(id)}/chunks`);
}

export async function searchRag(query: string, collectionId?: string): Promise<RagSearchResult> {
  return request<RagSearchResult>('/apollo-api/rag/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, collectionId }),
  });
}

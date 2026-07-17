export type RagCollection = {
  id: string;
  name: string;
  description: string;
  chunkMethod: RagChunkMethod;
  documentCount: number;
  chunkCount: number;
  createdAt: string;
  updatedAt: string;
};

export type RagChunkMethod = 'general' | 'qa' | 'manual' | 'table' | 'paper' | 'book' | 'laws' | 'presentation' | 'one';

export type RagDocument = {
  id: string;
  collectionId: string;
  name: string;
  size: number;
  chunkCount: number;
  createdAt: string;
};

export type RagHit = {
  id: string;
  collectionId: string;
  collectionName: string;
  documentId: string;
  documentName: string;
  position: number;
  content: string;
};

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

export async function createRagCollection(name: string, description: string, chunkMethod: RagChunkMethod): Promise<RagCollection> {
  return (await request<{ collection: RagCollection }>('/apollo-api/rag', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, description, chunkMethod }),
  })).collection;
}

export async function deleteRagCollection(id: string): Promise<void> {
  await request(`/apollo-api/rag/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function listRagDocuments(collectionId: string): Promise<RagDocument[]> {
  return (await request<{ documents: RagDocument[] }>(`/apollo-api/rag/${encodeURIComponent(collectionId)}/documents`)).documents;
}

export async function uploadRagDocuments(collectionId: string, files: File[]): Promise<RagDocument[]> {
  const form = new FormData();
  files.forEach((file) => form.append('files', file, file.name));
  return (await request<{ documents: RagDocument[] }>(`/apollo-api/rag/${encodeURIComponent(collectionId)}/documents`, { method: 'POST', body: form })).documents;
}

export async function deleteRagDocument(id: string): Promise<void> {
  await request(`/apollo-api/rag/documents/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function searchRag(query: string, collectionId?: string): Promise<RagHit[]> {
  return (await request<{ hits: RagHit[] }>('/apollo-api/rag/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, collectionId }),
  })).hits;
}

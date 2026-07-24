import type { Artifact } from '@/types';
import type { StoredArtifact } from './apolloAgent';

export type EditableDocumentKind = 'word' | 'markdown' | 'json';
export type DocumentKind = EditableDocumentKind | 'pdf' | 'image';
export type DocumentSource = 'server' | 'local' | 'temporary';

export const TEXT_PREVIEW_BYTES = 512 * 1024;

export async function readTextPreview(file: Blob, maxBytes = TEXT_PREVIEW_BYTES): Promise<{ content: string; truncated: boolean }> {
  const truncated = file.size > maxBytes;
  return { content: await (truncated ? file.slice(0, maxBytes) : file).text(), truncated };
}

export interface WritableFileHandle {
  kind: 'file';
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void> }>;
}

export interface OpenDocument {
  id: string;
  name: string;
  kind: DocumentKind;
  source: DocumentSource;
  file: File;
  url?: string;
  version?: string;
  handle?: WritableFileHandle;
}

export interface LibraryFile extends StoredArtifact {
  source: 'server' | 'local';
  handle?: WritableFileHandle;
  relativePath?: string;
}

export function editableKind(name: string): EditableDocumentKind | null {
  const lower = name.toLowerCase();
  if (lower.endsWith('.docx')) return 'word';
  if (lower.endsWith('.txt') || lower.endsWith('.md') || lower.endsWith('.markdown')) return 'markdown';
  if (lower.endsWith('.json')) return 'json';
  return null;
}

export function libraryKind(name: string): Artifact['kind'] | null {
  const editable = editableKind(name);
  if (editable) return editable;
  const lower = name.toLowerCase();
  if (lower.endsWith('.pdf')) return 'pdf';
  if (/\.(jpe?g|png|webp|gif)$/.test(lower)) return 'image';
  return null;
}

export async function openLibraryFile(item: LibraryFile): Promise<OpenDocument> {
  const kind = libraryKind(item.title);
  if (!kind) throw new Error('这个文件暂不支持打开');
  if (item.source === 'local') {
    if (!item.handle) throw new Error('本地文件句柄已失效，请重新连接文件夹');
    const file = await item.handle.getFile();
    return { id: item.id, name: file.name, kind, source: 'local', file, handle: item.handle };
  }
  if (!item.url) throw new Error('文件缺少读取地址');
  const response = await fetch(item.url);
  if (!response.ok) throw new Error(`读取文件失败 ${response.status}`);
  const blob = await response.blob();
  return {
    id: item.id,
    name: item.title,
    kind,
    source: 'server',
    file: new File([blob], item.title, { type: blob.type }),
    url: item.url,
    version: response.headers.get('ETag') ?? undefined,
  };
}

export async function openArtifact(artifact: Artifact): Promise<OpenDocument> {
  const kind = editableKind(artifact.title);
  if (!kind) throw new Error('这个产出物暂不支持编辑');
  if (artifact.url) {
    const response = await fetch(artifact.url);
    if (!response.ok) throw new Error(`读取文件失败 ${response.status}`);
    const blob = await response.blob();
    return {
      id: artifact.id,
      name: artifact.title,
      kind,
      source: artifact.meta?.path ? 'server' : 'temporary',
      file: new File([blob], artifact.title, { type: blob.type }),
      url: artifact.meta?.path ? artifact.url : undefined,
      version: response.headers.get('ETag') ?? undefined,
    };
  }
  if (typeof artifact.content !== 'string') throw new Error('产出物缺少文件内容');
  const bytes = kind === 'word' ? base64Bytes(artifact.content) : new TextEncoder().encode(artifact.content);
  return {
    id: artifact.id,
    name: artifact.title,
    kind,
    source: 'temporary',
    file: new File([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], artifact.title),
  };
}

export async function saveDocument(document: OpenDocument, file: File): Promise<OpenDocument> {
  if (document.source === 'local') {
    if (!document.handle) throw new Error('本地文件写入权限已失效');
    const writable = await document.handle.createWritable();
    await writable.write(file);
    await writable.close();
    return { ...document, file: await document.handle.getFile() };
  }
  if (document.source === 'server') {
    if (!document.url) throw new Error('文件缺少保存地址');
    const response = await fetch(document.url, {
      method: 'PUT',
      headers: document.version ? { 'If-Match': document.version } : undefined,
      body: file,
    });
    if (response.status === 412) throw new Error('文件已被其他位置修改，请重新打开后再保存');
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: string };
      throw new Error(body.error ?? `保存文件失败 ${response.status}`);
    }
    return { ...document, file, version: response.headers.get('ETag') ?? document.version };
  }
  downloadFile(file);
  return { ...document, file };
}

export function downloadFile(file: File): void {
  const url = URL.createObjectURL(file);
  const link = window.document.createElement('a');
  link.href = url;
  link.download = file.name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function base64Bytes(value: string): Uint8Array {
  const pure = value.includes(',') ? value.slice(value.indexOf(',') + 1) : value;
  const binary = atob(pure);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

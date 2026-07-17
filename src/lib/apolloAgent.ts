import type { TraceEvent } from '@apolloyh/apollo-agent';
import type { Artifact, Attachment, RuntimeStatus } from '@/types';

export type ApolloEvent =
  | { type: 'trace'; event: TraceEvent }
  | {
      type: 'interaction';
      id: string;
      kind: 'approval' | 'question';
      title: string;
      detail?: string;
      risk?: 'low' | 'medium' | 'high';
      options?: string[];
    }
  | { type: 'status'; status: RuntimeStatus }
  | { type: 'done'; artifacts: Artifact[]; status: RuntimeStatus }
  | { type: 'editor_request'; id: string; action: string; input: Record<string, unknown> }
  | { type: 'browser_request'; id: string; action: string; input: Record<string, unknown> }
  | { type: 'error'; message: string };

export type ApolloChannel = 'assistant' | 'entry';

export interface ManagedBrowserView {
  id: string;
  status: 'starting' | 'running' | 'succeeded' | 'failed';
  url: string;
  title: string;
  step: number;
  updated_at: number;
  frame_version: string;
  live_view_url?: string;
  user_controlled?: boolean;
  error?: string;
}

export async function getManagedBrowserView(signal?: AbortSignal): Promise<ManagedBrowserView | null> {
  const response = await fetch('/apollo-api/browser-view', { signal });
  if (!response.ok) throw new Error(`浏览器画面请求失败 ${response.status}`);
  const payload = await response.json() as { session?: ManagedBrowserView | null };
  return payload.session ?? null;
}

export type ManagedBrowserInput =
  | { type: 'click'; x: number; y: number }
  | { type: 'scroll'; x: number; y: number; delta_x: number; delta_y: number }
  | { type: 'key'; key: string }
  | { type: 'text'; text: string }
  | { type: 'resume' };

export async function sendManagedBrowserInput(input: ManagedBrowserInput): Promise<void> {
  const response = await fetch('/apollo-api/browser-view/input', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(`浏览器控制失败 ${response.status}`);
}

export async function uploadInputFiles(files: File[]): Promise<Attachment[]> {
  if (!files.length) return [];
  const body = new FormData();
  for (const file of files) body.append('files', file, file.name);
  const response = await fetch('/apollo-api/uploads', { method: 'POST', body });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error ?? `文件上传失败 ${response.status}`);
  }
  return (await response.json()).files;
}

export interface ApolloMemory {
  id: string;
  title: string;
  content: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export async function streamApollo(
  message: string,
  onEvent: (event: ApolloEvent) => void,
  signal?: AbortSignal,
  channel: ApolloChannel = 'entry',
  conversationId?: string,
): Promise<Artifact[]> {
  const startedAt = Date.now();
  console.log(`[Apollo Web] 开始调用：Apollo Agent｜通道：${channel === 'assistant' ? '助理' : '统一入口'}`);
  const response = await fetch('/apollo-api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, channel, conversationId }),
    signal,
  });
  if (!response.ok || !response.body) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? `智能体请求失败 ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let artifacts: Artifact[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const event = JSON.parse(line.slice(6)) as ApolloEvent;
      if (event.type === 'error') throw new Error(event.message);
      if (event.type === 'done') artifacts = event.artifacts;
      onEvent(event);
    }
  }
  console.log(`[Apollo Web] 调用完成：Apollo Agent｜耗时：${Date.now() - startedAt}ms｜产出文件：${artifacts.length}个`);
  return artifacts;
}

export async function respondApollo(id: string, answer: string): Promise<void> {
  const response = await fetch('/apollo-api/respond', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, answer }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? `提交失败 ${response.status}`);
  }
}

export async function getApolloStatus(): Promise<RuntimeStatus> {
  const response = await fetch('/apollo-api/status');
  if (!response.ok) throw new Error(`智能体状态请求失败 ${response.status}`);
  return response.json();
}

export async function getApolloConfig(): Promise<{ path: string; config: string }> {
  const response = await fetch('/apollo-api/config');
  if (!response.ok) throw new Error(`读取 Apollo 配置失败 ${response.status}`);
  return response.json();
}

export async function saveApolloConfig(config: string): Promise<void> {
  const response = await fetch('/apollo-api/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ config }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? `保存 Apollo 配置失败 ${response.status}`);
  }
}

export async function listApolloMemories(): Promise<ApolloMemory[]> {
  const response = await fetch('/apollo-api/memories');
  if (!response.ok) throw new Error(`读取记忆失败 ${response.status}`);
  return (await response.json()).memories;
}

export async function saveApolloMemory(memory: Pick<ApolloMemory, 'title' | 'content' | 'tags'> & { id?: string }): Promise<ApolloMemory> {
  const response = await fetch('/apollo-api/memories', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(memory),
  });
  if (!response.ok) throw new Error(`保存记忆失败 ${response.status}`);
  return (await response.json()).memory;
}

export async function deleteApolloMemory(id: string): Promise<void> {
  const response = await fetch(`/apollo-api/memories/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!response.ok) throw new Error(`删除记忆失败 ${response.status}`);
}

export type ApolloPermissionMode = 'ask' | 'unrestricted';

export async function getApolloPermission(channel: ApolloChannel = 'assistant'): Promise<ApolloPermissionMode> {
  const response = await fetch(`/apollo-api/permission?channel=${channel}`);
  if (!response.ok) throw new Error(`读取权限模式失败 ${response.status}`);
  return (await response.json()).mode;
}

export async function saveApolloPermission(mode: ApolloPermissionMode, channel: ApolloChannel = 'assistant'): Promise<void> {
  const response = await fetch('/apollo-api/permission', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode, channel }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? `切换权限模式失败 ${response.status}`);
  }
}

export async function summarizeConversationTitle(text: string): Promise<string> {
  const response = await fetch('/apollo-api/title', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!response.ok) throw new Error(`生成对话标题失败 ${response.status}`);
  return (await response.json()).title;
}

export interface StoredArtifact {
  id: string;
  title: string;
  kind: Artifact['kind'];
  size: number;
  modifiedAt: string;
  url?: string;
  content?: string;
  version?: string;
}

export async function getStoredArtifacts(): Promise<StoredArtifact[]> {
  const response = await fetch('/apollo-api/artifacts');
  if (!response.ok) throw new Error(`读取文件库失败 ${response.status}`);
  return (await response.json()).artifacts;
}

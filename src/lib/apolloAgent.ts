import type { TraceEvent } from '../../agent/dist/sdk.js';
import type { Artifact, RuntimeStatus } from '@/types';

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
  | { type: 'error'; message: string };

export async function streamApollo(
  message: string,
  onEvent: (event: ApolloEvent) => void,
  signal?: AbortSignal,
): Promise<Artifact[]> {
  const response = await fetch('/apollo-api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
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

export type ApolloPermissionMode = 'ask' | 'unrestricted';

export async function getApolloPermission(): Promise<ApolloPermissionMode> {
  const response = await fetch('/apollo-api/permission');
  if (!response.ok) throw new Error(`读取权限模式失败 ${response.status}`);
  return (await response.json()).mode;
}

export async function saveApolloPermission(mode: ApolloPermissionMode): Promise<void> {
  const response = await fetch('/apollo-api/permission', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode }),
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
  url: string;
}

export async function getStoredArtifacts(): Promise<StoredArtifact[]> {
  const response = await fetch('/apollo-api/artifacts');
  if (!response.ok) throw new Error(`读取文件库失败 ${response.status}`);
  return (await response.json()).artifacts;
}

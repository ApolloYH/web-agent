import type { ChatMessage } from '@/types';

export interface ConversationSummary {
  id: string;
  title: string;
  group: '最近' | '已归档';
  updatedAt: string;
}

export interface StoredConversation extends ConversationSummary {
  messages: ChatMessage[];
}

export const newConversationId = () => `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export async function listConversations(): Promise<ConversationSummary[]> {
  const response = await fetch('/apollo-api/conversations');
  if (!response.ok) throw new Error(`读取历史对话失败 ${response.status}`);
  return (await response.json()).conversations;
}

export async function getConversation(id: string): Promise<StoredConversation> {
  const response = await fetch(`/apollo-api/conversations/${encodeURIComponent(id)}`);
  if (!response.ok) throw new Error(`读取对话失败 ${response.status}`);
  const conversation = await response.json() as StoredConversation;
  conversation.messages = conversation.messages.map((message) => ({
    ...message,
    content: message.streaming && !message.content ? '生成已中断。' : message.content,
    streaming: false,
    steps: message.steps?.map((step) => ({ ...step, pending: false })),
  }));
  return conversation;
}

export async function saveConversation(conversation: Omit<StoredConversation, 'updatedAt'>): Promise<ConversationSummary> {
  const response = await fetch(`/apollo-api/conversations/${encodeURIComponent(conversation.id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...conversation,
      messages: conversation.messages.map((message) => ({
        ...message,
        artifacts: message.artifacts?.map((artifact) => ({
          ...artifact,
          content: artifact.kind === 'word' ? undefined : artifact.content,
          url: artifact.url?.startsWith('data:') ? undefined : artifact.url,
        })),
      })),
    }),
  });
  if (!response.ok) throw new Error(`保存对话失败 ${response.status}`);
  return response.json();
}

export async function updateConversation(id: string, patch: { title?: string; group?: '最近' | '已归档' }): Promise<void> {
  const response = await fetch(`/apollo-api/conversations/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!response.ok) throw new Error(`更新对话失败 ${response.status}`);
}

export async function deleteConversation(id: string): Promise<void> {
  const response = await fetch(`/apollo-api/conversations/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!response.ok) throw new Error(`删除对话失败 ${response.status}`);
}

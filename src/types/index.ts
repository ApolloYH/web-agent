// 产出物（agent 的产出）类型定义
// 通道 A：agent 在流式消息里返回一个 JSON 字段描述产出物
// 通道 B：产出物同时带一个后台可下载的 url
export type ArtifactKind = 'word' | 'pdf' | 'json' | 'markdown';

export interface Artifact {
  /** 稳定 id，用于面板选中 / 去重 */
  id: string;
  kind: ArtifactKind;
  /** 展示用标题，如 “季度报告.docx” */
  title: string;
  /** 通道 B：后台可下载地址（Word/PDF 通常走这个） */
  url?: string;
  /** 通道 A：内联内容（JSON/Markdown 通常直接内联，省一次请求） */
  content?: string;
  /** 可选：文件字节大小 */
  size?: number;
  /** 原样保留 agent 给的扩展元数据 */
  meta?: Record<string, unknown>;
}

export type ChatRole = 'user' | 'assistant' | 'system';

/** 过程块：可点击展开的 Thought / 工具运行（对齐 Grok / Claude 风格） */
export type ProcessStepKind =
  | 'thought'
  | 'tool_run'
  | 'notice'
  | 'task'
  | 'workflow'
  | 'goal'
  | 'plan'
  | 'approval'
  | 'question';

export interface FileChange {
  path: string;
  kind: 'create' | 'update';
  added: number;
  removed: number;
  lines: string[];
  omitted: number;
}

export interface WorkflowPhase {
  name: string;
  label: string;
  status: string;
  summary?: string;
}

export interface ProcessStep {
  id: string;
  kind: ProcessStepKind;
  /** 标题行：Thought / Run extract files… */
  title: string;
  /** 展开后的正文 */
  detail?: string;
  /** 耗时秒数（Thought for 0.5s） */
  durationSec?: number;
  /** 当前模型思考段开始时间，仅用于计算独立 Thought 耗时 */
  startedAtMs?: number;
  /** 进行中 */
  pending?: boolean;
  /** 可选：命令行风格预览（tool_run） */
  command?: string;
  toolName?: string;
  tone?: 'neutral' | 'success' | 'warning' | 'error' | 'info';
  risk?: 'low' | 'medium' | 'high';
  fileChange?: FileChange;
  progress?: string[];
  result?: string;
  phases?: WorkflowPhase[];
  goal?: string;
  status?: string;
  iteration?: number;
  maxIterations?: number;
  interactionId?: string;
  options?: string[];
  answer?: string;
}

export interface RuntimeStatus {
  product: string;
  version: string;
  model: string;
  baseUrl: string;
  maxTokens: number;
  contextMaxChars: number;
  cwd: string;
  messages: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cacheHitRate: number | null;
  requestHitRate: number | null;
  latestHitRate: number | null;
  cacheMode: string;
  cacheKeys: { prefix: string | null; config: string | null; system: string | null; tools: string | null };
  categories: Record<string, { requests: number; requestsWithCacheRead: number; cacheHitRate: number | null }>;
  mode: string;
  goal: string | null;
  session: string | null;
}

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  /** 该条 assistant 消息附带的产出物 */
  artifacts?: Artifact[];
  /** 可折叠过程：Thought / Run 工具 */
  steps?: ProcessStep[];
  /** 流式进行中标记 */
  streaming?: boolean;
}

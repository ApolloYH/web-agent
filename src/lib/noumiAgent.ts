// Noumi External API 适配器（langhub.cn）。
//
// Noumi 使用「项目 / 话题」模型：
//   1. POST /projects/{pid}/topics/{tid}/messages   发问 → 返回 taskId
//   2. GET  /projects/{pid}/topics/{tid}/stream      SSE：事件通知 + 快照（非逐字 delta）
//   3. 产出物落在 workspace 文件系统里，用 tree / files 接口拿
//
// 关键设计：把产出物「预取成内联」再交给前端预览层——
//   Word → files?format=binary 拿 base64 填 content（WordView 走通道 A）
//   PDF  → 同上，拼成 data:application/pdf;base64 填 url（PdfView iframe 直渲）
//   JSON/MD → files?format=text 拿 content
// 这样 4 个预览组件无需改动，也绕开了 iframe/fetch 带不了 Bearer 头的鉴权问题。
//
// 安全提示：这是纯前端直连，apiKey 存在浏览器 localStorage，仅供本地自测，勿部署公网。

import type { Artifact, ArtifactKind } from '@/types';

export interface NoumiConfig {
  /** 如 https://www.langhub.cn/api/external/v1 */
  baseUrl: string;
  /** Bearer API key（nim_...） */
  apiKey: string;
  /** 目标项目 id（如 yh-文件生成） */
  projectId: string;
  /** 话题 id；留空则自动新建一个临时话题 */
  topicId?: string;
}

export interface NoumiResult {
  /** assistant 最终回复正文 */
  text: string;
  /** 本次任务新产生的产出物（已内联，可直接预览） */
  artifacts: Artifact[];
  /** 实际使用的话题 id（自动新建时回传，便于后续复用） */
  topicId: string;
}

const TERMINAL = new Set([
  'completed',
  'complete',
  'succeeded',
  'success',
  'finished',
  'done',
  'failed',
  'error',
  'cancelled',
  'canceled',
  'aborted',
  'stopped',
]);

function authHeaders(cfg: NoumiConfig): HeadersInit {
  return { Authorization: `Bearer ${cfg.apiKey}` };
}

function base(cfg: NoumiConfig): string {
  return cfg.baseUrl.replace(/\/$/, '');
}

function enc(seg: string): string {
  return encodeURIComponent(seg);
}

async function apiJson(
  cfg: NoumiConfig,
  path: string,
  init?: RequestInit,
): Promise<unknown> {
  const resp = await fetch(`${base(cfg)}${path}`, {
    ...init,
    headers: {
      ...authHeaders(cfg),
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!resp.ok) {
    const detail = await resp.text().catch(() => '');
    throw new Error(`Noumi ${resp.status} ${path}: ${detail.slice(0, 300)}`);
  }
  return resp.json();
}

/** 确保有可用话题；topicId 为空则新建。返回真实（服务端分配的）topicId。 */
async function ensureTopic(cfg: NoumiConfig, signal?: AbortSignal): Promise<string> {
  if (cfg.topicId && cfg.topicId.trim()) return cfg.topicId.trim();
  const data = (await apiJson(cfg, `/projects/${enc(cfg.projectId)}/topics`, {
    method: 'POST',
    body: JSON.stringify({ topicId: `web-${Date.now()}`, description: 'web-agent 会话' }),
    signal,
  })) as { topic?: { id?: string } };
  const id = data?.topic?.id;
  if (!id) throw new Error('新建话题失败：未返回 topic.id');
  return String(id);
}

interface TreeItem {
  path: string;
  name: string;
  isDirectory: boolean;
  hasChildren?: boolean;
  contentType?: string;
  size?: number;
}

/** 递归列出项目 workspace 下所有文件路径（跳过目录本身）。 */
async function listAllFiles(
  cfg: NoumiConfig,
  dir: string,
  signal?: AbortSignal,
  depth = 0,
): Promise<TreeItem[]> {
  if (depth > 6) return []; // 防御：限制递归深度
  const q = dir ? `&path=${enc(dir)}` : '';
  const data = (await apiJson(
    cfg,
    `/projects/${enc(cfg.projectId)}/workspace/tree?withSize=true&withHasChildren=true${q}`,
    { signal },
  )) as { items?: TreeItem[] };
  const items = data?.items ?? [];
  const out: TreeItem[] = [];
  for (const it of items) {
    if (it.isDirectory) {
      if (it.hasChildren) out.push(...(await listAllFiles(cfg, it.path, signal, depth + 1)));
    } else {
      out.push(it);
    }
  }
  return out;
}

/** 由文件名/路径推断可预览的产出物类型；不支持的返回 null。 */
function kindOf(path: string): ArtifactKind | null {
  const lower = path.toLowerCase();
  if (lower.endsWith('.docx')) return 'word';
  if (lower.endsWith('.pdf')) return 'pdf';
  if (lower.endsWith('.json')) return 'json';
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'markdown';
  return null;
}

const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** 把一个 workspace 文件读取并内联成 Artifact。 */
async function toArtifact(
  cfg: NoumiConfig,
  item: TreeItem,
  signal?: AbortSignal,
): Promise<Artifact | null> {
  const kind = kindOf(item.path);
  if (!kind) return null;
  const dl = `${base(cfg)}/projects/${enc(cfg.projectId)}/workspace/download?path=${enc(item.path)}`;

  if (kind === 'json' || kind === 'markdown') {
    const data = (await apiJson(
      cfg,
      `/projects/${enc(cfg.projectId)}/workspace/files?path=${enc(item.path)}&format=text`,
      { signal },
    )) as { content?: string };
    return {
      id: item.path,
      kind,
      title: item.name,
      content: data?.content ?? '',
      size: item.size,
      meta: { path: item.path, downloadUrl: dl },
    };
  }

  // word / pdf：读二进制 base64
  const data = (await apiJson(
    cfg,
    `/projects/${enc(cfg.projectId)}/workspace/files?path=${enc(item.path)}&format=binary`,
    { signal },
  )) as { contentBase64?: string; contentType?: string };
  const b64 = data?.contentBase64 ?? '';
  if (kind === 'pdf') {
    return {
      id: item.path,
      kind,
      title: item.name,
      url: `data:application/pdf;base64,${b64}`,
      size: item.size,
      meta: { path: item.path, downloadUrl: dl },
    };
  }
  // word：内联 base64 给 WordView（通道 A）
  return {
    id: item.path,
    kind,
    title: item.name,
    content: b64,
    size: item.size,
    meta: { path: item.path, mime: data?.contentType ?? DOCX_MIME, downloadUrl: dl },
  };
}

/** 从任意解析后的 SSE data 对象里，深度查找最后一条 assistant 文本。 */
function findAssistantText(obj: unknown): string | null {
  let found: string | null = null;
  const visit = (o: unknown): void => {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) {
      for (const v of o) visit(v);
      return;
    }
    const rec = o as Record<string, unknown>;
    if (rec.role === 'assistant') {
      const c = rec.content;
      if (typeof c === 'string' && c) found = c;
      else if (Array.isArray(rec.blocks)) {
        // 回退：从 blocks 里拼 text
        const parts = (rec.blocks as unknown[])
          .map((b) =>
            b && typeof b === 'object' && typeof (b as Record<string, unknown>).text === 'string'
              ? ((b as Record<string, unknown>).text as string)
              : '',
          )
          .filter(Boolean);
        if (parts.length) found = parts.join('');
      }
    }
    for (const v of Object.values(rec)) visit(v);
  };
  visit(obj);
  return found;
}

/** 轮询任务状态直到终态。返回最终 status 字符串。 */
async function pollTaskDone(
  cfg: NoumiConfig,
  taskId: string,
  done: { v: boolean },
  signal?: AbortSignal,
): Promise<void> {
  while (!done.v) {
    if (signal?.aborted) return;
    try {
      const t = (await apiJson(cfg, `/tasks/${enc(taskId)}`, { signal })) as Record<string, unknown>;
      const status = findStatus(t);
      if (status && TERMINAL.has(status.toLowerCase())) {
        done.v = true;
        return;
      }
    } catch {
      /* 轮询失败忽略，下轮再试 */
    }
    await sleep(2500, signal);
  }
}

function findStatus(obj: unknown): string | null {
  if (!obj || typeof obj !== 'object') return null;
  const rec = obj as Record<string, unknown>;
  // 优先 activeRun===null 视为完成
  if ('activeRun' in rec && rec.activeRun === null) return 'completed';
  if (typeof rec.status === 'string') return rec.status;
  const ar = rec.activeRun as Record<string, unknown> | undefined;
  if (ar && typeof ar.status === 'string') return ar.status;
  return null;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      resolve();
    });
  });
}

/** 打开 SSE，边收快照边把 assistant 文本增量吐给 onDelta；任务完成即结束。 */
async function streamText(
  cfg: NoumiConfig,
  topicId: string,
  onDelta: (chunk: string) => void,
  done: { v: boolean },
  signal?: AbortSignal,
): Promise<string> {
  const url = `${base(cfg)}/projects/${enc(cfg.projectId)}/topics/${enc(topicId)}/stream`;
  let emitted = '';
  let seenRunning = false;

  const emit = (full: string) => {
    if (typeof full !== 'string' || full === emitted) return;
    if (full.startsWith(emitted)) {
      // 常规：新快照是旧文本的超集 → 只吐增量
      onDelta(full.slice(emitted.length));
    } else {
      // 罕见：文本被整体改写 → 直接补发新文本
      onDelta(full);
    }
    emitted = full;
  };

  const resp = await fetch(url, { headers: authHeaders(cfg), signal });
  if (!resp.ok || !resp.body) throw new Error(`SSE 连接失败 ${resp.status}`);
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';

  try {
    while (!done.v) {
      const { done: rdDone, value } = await reader.read();
      if (rdDone) break;
      buf += decoder.decode(value, { stream: true });
      const parts = buf.split('\n\n');
      buf = parts.pop() ?? '';
      for (const part of parts) {
        let ev = '';
        const dataLines: string[] = [];
        for (const line of part.split('\n')) {
          if (line.startsWith('event:')) ev = line.slice(6).trim();
          else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
        }
        if (!dataLines.length) continue;
        let data: unknown;
        try {
          data = JSON.parse(dataLines.join('\n'));
        } catch {
          continue;
        }
        const text = findAssistantText(data);
        if (text) emit(text);

        if (ev === 'run_state' || (data as Record<string, unknown>)?.type === 'run_state') {
          const rec = data as Record<string, unknown>;
          const ar = rec.activeRun as Record<string, unknown> | null;
          if (ar && String(ar.status).toLowerCase() === 'running') seenRunning = true;
          if (ar === null && seenRunning) {
            done.v = true;
          }
          if (ar && TERMINAL.has(String(ar.status).toLowerCase())) done.v = true;
        }
      }
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      /* ignore */
    }
  }
  return emitted;
}

/**
 * 跑一次 Noumi 任务：发问 → 流式回显 → 收集本次新产出物（已内联）。
 */
export async function runNoumiTask(
  cfg: NoumiConfig,
  prompt: string,
  onDelta: (chunk: string) => void,
  signal?: AbortSignal,
): Promise<NoumiResult> {
  if (!cfg.apiKey) throw new Error('缺少 API Key');
  if (!cfg.projectId) throw new Error('缺少 projectId');

  const topicId = await ensureTopic(cfg, signal);

  // 记录发问前的文件集合，用于事后 diff 出「本次新产出物」
  const before = new Set((await listAllFiles(cfg, '', signal)).map((f) => f.path));

  const send = (await apiJson(
    cfg,
    `/projects/${enc(cfg.projectId)}/topics/${enc(topicId)}/messages`,
    { method: 'POST', body: JSON.stringify({ prompt }), signal },
  )) as { taskId?: string };
  const taskId = send?.taskId;

  const done = { v: false };
  // 并行：SSE 拿文本增量 + 轮询任务状态作权威完成信号
  const streamP = streamText(cfg, topicId, onDelta, done, signal).catch((e) => {
    // SSE 可能被浏览器 CORS 拦；文本降级，但产出物仍可获取
    return `（实时文本获取失败：${e instanceof Error ? e.message : String(e)}）`;
  });
  const pollP = taskId ? pollTaskDone(cfg, taskId, done, signal) : Promise.resolve();

  await pollP;
  done.v = true;
  const text = await streamP;

  // 完成后 diff 出新文件，读取并内联成 artifacts
  const after = await listAllFiles(cfg, '', signal);
  const fresh = after.filter((f) => !before.has(f.path) && kindOf(f.path));
  const artifacts: Artifact[] = [];
  for (const item of fresh) {
    try {
      const art = await toArtifact(cfg, item, signal);
      if (art) artifacts.push(art);
    } catch {
      /* 单个产出物读取失败不影响其余 */
    }
  }

  return { text, artifacts, topicId };
}

/** 列出可选项目（供设置 UI 用）。 */
export async function listNoumiProjects(
  cfg: Pick<NoumiConfig, 'baseUrl' | 'apiKey'>,
  signal?: AbortSignal,
): Promise<{ id: string; topics: { id: string; name: string }[] }[]> {
  const full: NoumiConfig = { ...cfg, projectId: '' };
  const data = (await apiJson(full, `/projects`, { signal })) as {
    projects?: { id: string; topics?: { id: string; name: string }[] }[];
  };
  return (data?.projects ?? []).map((p) => ({
    id: p.id,
    topics: (p.topics ?? []).map((t) => ({ id: String(t.id), name: t.name })),
  }));
}

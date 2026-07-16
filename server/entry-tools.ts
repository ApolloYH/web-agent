import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { JsonObject, ToolArtifact, ToolDefinition } from '@apolloyh/apollo-agent';

type EntryToolConfig = {
  workspaceRoot: string;
  conversationId: string;
  langcoreApiKey: string;
  langhubApiKey: string;
  langhubBaseUrl: string;
  automationMode: () => 'ask' | 'auto';
  projects: Record<string, string>;
  turnState: { standardsQuery?: Promise<string> };
  assertStorageCapacity: (incomingBytes: number) => Promise<void>;
};

type TreeItem = { path: string; name: string; isDirectory: boolean; hasChildren?: boolean; size?: number; modifiedAt?: string };
const langHubProjectLocks = new Map<string, Promise<void>>();
const MAX_LANGHUB_ARTIFACT_BYTES = 25 * 1024 * 1024;

const TASKS = [
  'risk_card',
  'supervision_notice',
  'supervision_log',
  'supervision_document',
  'hazard_analysis',
  'plan_review',
  'drawing_compare',
] as const;

export function createEntryTools(config: EntryToolConfig): ToolDefinition[] {
  return [
    {
      name: 'query_engineering_standards',
      description: '检索工标库中的国家标准、行业标准、企业标准、工程规范和条款。query 必须结合当前对话补全为可独立理解的完整问题。',
      risk: 'low',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '结合当前对话改写后的完整检索问题，不能只写“查工标库”。' },
        },
        required: ['query'],
      },
      execute: async (input) => {
        if (config.turnState.standardsQuery) {
          console.info('[Apollo] 工标库检索｜本轮复用首次结果');
          return { content: await config.turnState.standardsQuery };
        }
        const request = queryStandards(requiredString(input, 'query'), config.langcoreApiKey);
        config.turnState.standardsQuery = request;
        try {
          return { content: await request };
        } catch (error) {
          config.turnState.standardsQuery = undefined;
          throw error;
        }
      },
    },
    {
      name: 'run_langhub_task',
      description: '调用指定的智监 LangHub 业务智能体。risk_card 和 hazard_analysis 有一张图片即可执行；plan_review 有一个施工方案文件即可执行，不得为这三类任务追问其他信息。其他任务缺少关键输入时再追问。',
      risk: 'high',
      input_schema: {
        type: 'object',
        properties: {
          task: { type: 'string', enum: [...TASKS], description: '业务任务类型。' },
          prompt: { type: 'string', description: '根据完整对话整理的严格业务输入，保留用户事实，不得补造。' },
          files: {
            type: 'array',
            items: { type: 'string' },
            description: '用户工作区中的附件路径，例如 uploads/xxx.docx。只传与本任务相关的文件。',
          },
        },
        required: ['task', 'prompt'],
      },
      execute: async (input) => runLangHubTask(config, requiredTask(input), requiredString(input, 'prompt'), stringArray(input.files)),
    },
  ];
}

async function queryStandards(query: string, apiKey: string): Promise<string> {
  if (!apiKey) throw new Error('未配置 LANGCORE_API_KEY');
  console.info(`[Apollo] 工标库检索｜问题：${preview(query)}`);
  const response = await fetch('https://app.langcore.cn/api/v1/repo/query', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query,
      repoIds: ['cmp11l7q50000phd7pxo9cefe'],
      top_k: 5,
      mode: 'fast',
      rerankScore: 0.3,
    }),
    signal: AbortSignal.timeout(60_000),
  });
  const text = await response.text();
  if (!response.ok) {
    console.error(`[Apollo] 工标库检索失败｜HTTP ${response.status}｜响应：${preview(text)}`);
    throw new Error(`工标库查询失败 ${response.status}: ${text.slice(0, 300)}`);
  }
  let payload: unknown = text;
  try { payload = JSON.parse(text); } catch { /* keep text */ }
  return typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
}

async function runLangHubTask(config: EntryToolConfig, task: typeof TASKS[number], prompt: string, files: string[]): Promise<{ content: string; artifacts: ToolArtifact[] }> {
  const projectId = config.projects[task];
  if (!config.langhubApiKey) throw new Error('未配置 NOUMI_API_KEY');
  if (!projectId) throw new Error(`未配置 ${task} 对应的 LangHub 项目`);
  const release = await acquireProjectLock(projectId);
  try {
  const baseUrl = config.langhubBaseUrl.replace(/\/$/, '');
  const topicId = await topicForConversation(config, task, projectId, baseUrl);
  const safeFiles = await resolveWorkspaceFiles(config.workspaceRoot, files);
  console.info(`[Apollo] LangHub 开始｜任务：${task}｜附件：${safeFiles.length}个｜模式：${config.automationMode() === 'auto' ? '全自动' : '审批'}`);

  const attachedProcessFileIds: string[] = [];
  for (const file of safeFiles) {
    const form = new FormData();
    form.append('file', new Blob([await fs.readFile(file)]), path.basename(file));
    const response = await fetch(`${baseUrl}/projects/${encodeURIComponent(projectId)}/topics/${encodeURIComponent(topicId)}/process-files`, {
      method: 'POST', headers: auth(config.langhubApiKey), body: form, signal: AbortSignal.timeout(120_000),
    });
    const responseText = await response.text();
    if (!response.ok) throw new Error(`LangHub 附件上传失败：${path.basename(file)} (${response.status}) ${responseText.slice(0, 300)}`);
    const processFileId = (JSON.parse(responseText) as { file?: { id?: unknown } }).file?.id;
    if (typeof processFileId !== 'string' || !processFileId) throw new Error(`LangHub 附件上传失败：${path.basename(file)} 未返回 file.id`);
    attachedProcessFileIds.push(processFileId);
    console.info(`[Apollo] LangHub 附件已上传｜文件：${path.basename(file)}`);
  }

  const before = new Map((await listFiles(baseUrl, config.langhubApiKey, projectId)).map((item) => [item.path, fileSignature(item)]));
  const inputCopies = new Set(await Promise.all(safeFiles.map(async (file) => `${path.basename(file)}\0${(await fs.stat(file)).size}`)));
  const sent = await apiJson(baseUrl, config.langhubApiKey, `/projects/${enc(projectId)}/topics/${enc(topicId)}/messages`, {
    method: 'POST',
    body: JSON.stringify({ prompt, automationMode: config.automationMode(), attachedProcessFileIds }),
  }) as { taskId?: string };
  const text = sent.taskId
    ? await waitForTask(baseUrl, config.langhubApiKey, projectId, topicId, sent.taskId)
    : '';
  const fresh = await waitForFreshArtifacts(baseUrl, config.langhubApiKey, projectId, before, inputCopies);
  const saved: string[] = [];
  for (const item of fresh) saved.push(await downloadArtifact(config, baseUrl, projectId, item));
  const artifacts = await Promise.all(saved.map(async (file) => ({
    path: file,
    title: path.basename(file).replace(/^\d+-/, ''),
    size: (await fs.stat(path.join(config.workspaceRoot, file))).size,
  })));
  console.info(`[Apollo] LangHub 完成｜任务：${task}｜产出文件：${saved.length}个`);
  return {
    content: [text || 'LangHub 任务已完成。', saved.length ? `已保存文件：\n${saved.map((file) => `- ${file}`).join('\n')}` : '本次未发现新的产出文件。'].join('\n\n'),
    artifacts,
  };
  } finally {
    release();
  }
}

async function acquireProjectLock(projectId: string): Promise<() => void> {
  const previous = langHubProjectLocks.get(projectId);
  let unlock!: () => void;
  const current = new Promise<void>((resolve) => { unlock = resolve; });
  langHubProjectLocks.set(projectId, current);
  if (previous) {
    console.info(`[Apollo] LangHub 排队｜项目：${projectId}`);
    await previous;
  }
  return () => {
    unlock();
    if (langHubProjectLocks.get(projectId) === current) langHubProjectLocks.delete(projectId);
  };
}

async function waitForFreshArtifacts(
  baseUrl: string,
  apiKey: string,
  projectId: string,
  before: Map<string, string>,
  inputCopies: Set<string>,
): Promise<TreeItem[]> {
  const deadline = Date.now() + 5 * 60_000;
  let previous = '';
  let stableSince = 0;
  console.info('[Apollo] LangHub 等待成果文件写入');
  while (Date.now() < deadline) {
    const files = (await listFiles(baseUrl, apiKey, projectId)).filter((item) =>
      /\.(docx|pdf|jpe?g|png|webp)$/i.test(item.path)
      && (item.size ?? 0) > 0
      && before.get(item.path) !== fileSignature(item)
      && !inputCopies.has(`${item.name}\0${item.size}`));
    const signature = files.map(fileSignature).sort().join('|');
    if (files.length && signature === previous) {
      if (Date.now() - stableSince >= 5_000) return files;
    } else {
      previous = signature;
      stableSince = Date.now();
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  return [];
}

async function topicForConversation(config: EntryToolConfig, task: string, projectId: string, baseUrl: string): Promise<string> {
  const statePath = path.join(config.workspaceRoot, '.apollo', 'entry-langhub-topics', `${config.conversationId}.json`);
  const state: Record<string, string> = await fs.readFile(statePath, 'utf8')
    .then((text) => JSON.parse(text) as Record<string, string>)
    .catch(() => ({}));
  if (state[task]) return state[task];
  const created = await apiJson(baseUrl, config.langhubApiKey, `/projects/${enc(projectId)}/topics`, {
    method: 'POST', body: JSON.stringify({ topicId: `web-${Date.now()}`, description: `web-agent ${config.conversationId}` }),
  }) as { topic?: { id?: string } };
  const topicId = created.topic?.id;
  if (!topicId) throw new Error('LangHub 新建话题失败：未返回 topic.id');
  state[task] = String(topicId);
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  return state[task];
}

async function waitForTask(baseUrl: string, apiKey: string, projectId: string, topicId: string, taskId: string): Promise<string> {
  const deadline = Date.now() + 10 * 60_000;
  let latestText = '';
  while (Date.now() < deadline) {
    const state = await apiJson(baseUrl, apiKey, `/tasks/${enc(taskId)}`) as Record<string, unknown>;
    latestText = findAssistantText(state) || latestText;
    const status = String(state.status ?? state.state ?? '').toLowerCase();
    if (['completed', 'complete', 'succeeded', 'success', 'finished', 'done'].includes(status)) return latestText || await latestTopicText(baseUrl, apiKey, projectId, topicId);
    if (['failed', 'error', 'cancelled', 'canceled', 'aborted', 'stopped'].includes(status)) throw new Error(`LangHub 任务失败：${status}`);
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error('LangHub 任务等待超时');
}

async function latestTopicText(baseUrl: string, apiKey: string, projectId: string, topicId: string): Promise<string> {
  const state = await apiJson(baseUrl, apiKey, `/projects/${enc(projectId)}/topics/${enc(topicId)}/chat-state`).catch(() => null);
  return findAssistantText(state) || '';
}

async function listFiles(baseUrl: string, apiKey: string, projectId: string, dir = '', depth = 0): Promise<TreeItem[]> {
  if (depth > 6) return [];
  const query = dir ? `&path=${enc(dir)}` : '';
  const data = await apiJson(baseUrl, apiKey, `/projects/${enc(projectId)}/workspace/tree?withSize=true&withHasChildren=true${query}`) as { items?: TreeItem[] };
  const output: TreeItem[] = [];
  for (const item of data.items ?? []) {
    if (item.isDirectory) {
      if (item.hasChildren) output.push(...await listFiles(baseUrl, apiKey, projectId, item.path, depth + 1));
    } else output.push(item);
  }
  return output;
}

async function downloadArtifact(config: EntryToolConfig, baseUrl: string, projectId: string, item: TreeItem): Promise<string> {
  if ((item.size ?? 0) > MAX_LANGHUB_ARTIFACT_BYTES) throw new Error(`LangHub 文件超过 25MB：${item.name}`);
  const response = await fetch(`${baseUrl}/projects/${enc(projectId)}/workspace/download?path=${enc(item.path)}`, { headers: auth(config.langhubApiKey), signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`LangHub 文件下载失败：${item.name} (${response.status})`);
  const bytes = await readLimitedResponse(response, MAX_LANGHUB_ARTIFACT_BYTES);
  await config.assertStorageCapacity(bytes.length);
  const artifactRoot = path.join(config.workspaceRoot, 'artifacts', config.conversationId);
  await fs.mkdir(artifactRoot, { recursive: true });
  const target = path.join(artifactRoot, `${Date.now()}-${safeName(item.name)}`);
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, bytes);
    await fs.rename(temporary, target);
  } catch (error) {
    await fs.rm(temporary, { force: true });
    throw error;
  }
  return path.relative(config.workspaceRoot, target);
}

async function readLimitedResponse(response: Response, limit: number): Promise<Buffer> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) throw new Error('LangHub 文件超过 25MB');
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new Error('LangHub 文件超过 25MB');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks, total);
}

async function resolveWorkspaceFiles(workspaceRoot: string, files: string[]): Promise<string[]> {
  // 只允许上传 uploads/ 下的文件，避免模型把 .apollo/memory 等用户私有文件外传给 LangHub。
  const uploadsRoot = path.resolve(workspaceRoot, 'uploads');
  const realUploadsRoot = await fs.realpath(uploadsRoot).catch(() => '');
  const output: string[] = [];
  for (const file of files) {
    const target = path.resolve(uploadsRoot, file.replace(/^uploads[\\/]/, ''));
    if (target !== uploadsRoot && !target.startsWith(`${uploadsRoot}${path.sep}`)) throw new Error(`附件必须位于 uploads/ 目录：${file}`);
    const [realTarget, targetStat] = await Promise.all([fs.realpath(target), fs.lstat(target)]).catch(() => ['', null] as const);
    const realRelative = realUploadsRoot && realTarget ? path.relative(realUploadsRoot, realTarget) : '..';
    if (!targetStat?.isFile() || targetStat.isSymbolicLink() || realRelative.startsWith('..') || path.isAbsolute(realRelative)) throw new Error(`附件不是安全的上传文件：${file}`);
    output.push(realTarget);
  }
  return output;
}

async function apiJson(baseUrl: string, apiKey: string, endpoint: string, init: RequestInit = {}): Promise<unknown> {
  const response = await fetch(`${baseUrl}${endpoint}`, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(60_000),
    headers: { ...auth(apiKey), ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(init.headers ?? {}) },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`LangHub ${response.status} ${endpoint}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

function findAssistantText(value: unknown): string | null {
  let found: string | null = null;
  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return void node.forEach(visit);
    const record = node as Record<string, unknown>;
    if (record.role === 'assistant' && typeof record.content === 'string' && record.content) found = record.content;
    Object.values(record).forEach(visit);
  };
  visit(value);
  return found;
}

function auth(apiKey: string): Record<string, string> { return { Authorization: `Bearer ${apiKey}` }; }
function fileSignature(item: TreeItem): string { return `${item.path}\0${item.size ?? -1}\0${item.modifiedAt ?? ''}`; }
function enc(value: string): string { return encodeURIComponent(value); }
function safeName(value: string): string { return path.basename(value).replace(/[^\p{L}\p{N}._-]+/gu, '_'); }
function preview(value: string): string { return value.replace(/\s+/g, ' ').slice(0, 160); }
function requiredString(input: JsonObject, key: string): string {
  const value = input[key];
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${key} 不能为空`);
  return value.trim();
}
function stringArray(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw new Error('files 必须是字符串数组');
  return value;
}
function requiredTask(input: JsonObject): typeof TASKS[number] {
  const value = requiredString(input, 'task');
  if (!(TASKS as readonly string[]).includes(value)) throw new Error(`不支持的任务类型：${value}`);
  return value as typeof TASKS[number];
}

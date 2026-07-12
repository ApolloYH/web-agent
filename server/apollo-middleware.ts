import fs from 'node:fs/promises';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import {
  PRODUCT,
  createQueryEngine,
  type ApprovalProvider,
  type QueryEngine,
  type TraceEvent,
} from '../agent/dist/sdk.js';
import type { Artifact, RuntimeStatus } from '../src/types';

const ARTIFACT_EXTENSIONS = new Set(['.md', '.json', '.docx', '.pdf']);
const SKIP_DIRECTORIES = new Set(['.git', '.apollo', 'node_modules', 'dist']);
const MAX_ARTIFACT_BYTES = 25 * 1024 * 1024;

type Send = (event: object) => void;
type PendingInteraction = { resolve: (answer: string) => void; fallback: string };

export function createApolloMiddleware({ workspaceRoot, envPath }: { workspaceRoot: string; envPath: string }) {
  const configPath = path.join(workspaceRoot, '.apollo', 'config.json');
  const artifactRoot = path.join(workspaceRoot, 'artifacts');
  const databasePath = path.join(workspaceRoot, '.apollo', 'web-agent.sqlite');
  const assistantSessionPath = path.join(workspaceRoot, '.apollo', 'web-assistant-session');
  let database: DatabaseSync | undefined;
  let engine: QueryEngine | undefined;
  let assistantEngine: QueryEngine | undefined;
  let activeEngine: QueryEngine | undefined;
  let sink: ((event: TraceEvent) => void) | undefined;
  let activeSend: Send | undefined;
  let busy = false;
  let interactionSequence = 0;
  const interactions = new Map<string, PendingInteraction>();

  const requestInteraction = (
    payload: Omit<Extract<WebEvent, { type: 'interaction' }>, 'id'>,
    fallback: string,
  ): Promise<string> => {
    const id = `interaction-${interactionSequence++}`;
    activeSend?.({ ...payload, id });
    return new Promise((resolve) => interactions.set(id, { resolve, fallback }));
  };

  const approvalProvider: ApprovalProvider = async (request) => {
    if (await isUnrestricted(configPath)) return true;
    if (request.risk === 'low') return true;
    sink?.({
      type: 'approval_required',
      tool: request.toolName,
      risk: request.risk,
      reason: request.reason,
    });
    const answer = await requestInteraction(
      {
        type: 'interaction',
        kind: 'approval',
        title: request.toolName,
        detail: `${request.reason}\n${JSON.stringify(compactInput(request.input), null, 2)}`,
        risk: request.risk,
      },
      'deny',
    );
    const approved = answer === 'approve';
    sink?.({ type: 'approval_result', tool: request.toolName, approved });
    return approved;
  };

  const createEngine = async (sessionId?: string) => createQueryEngine({
    envPath,
    sessionId,
    approvalProvider,
    askUser: (question, options) =>
      requestInteraction(
        { type: 'interaction', kind: 'question', title: question, options },
        '(no answer)',
      ),
    onEvent: (event) => sink?.(event),
  });

  const getEngine = async (channel: 'assistant' | 'entry' = 'entry') => {
    if (channel === 'assistant') {
      const sessionId = await fs.readFile(assistantSessionPath, 'utf8').then((value) => value.trim()).catch(() => '');
      assistantEngine ??= await createEngine(sessionId || undefined);
      return assistantEngine;
    }
    engine ??= await createEngine();
    return engine;
  };

  const closeEngines = async () => {
    await Promise.all([engine?.close(), assistantEngine?.close()]);
    engine = undefined;
    assistantEngine = undefined;
  };

  const handle = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (!req.url?.startsWith('/apollo-api/')) return next();
    if (!isLoopback(req.socket.remoteAddress)) {
      return jsonError(res, 403, '智能体 API 仅接受本机请求');
    }

    if (req.url === '/apollo-api/respond') return handleResponse(req, res, interactions);
    if (req.url === '/apollo-api/conversations' && req.method === 'GET') {
      database ??= openConversationDatabase(databasePath);
      return json(res, 200, { conversations: listConversations(database) });
    }
    if (req.url.startsWith('/apollo-api/conversations/')) {
      database ??= openConversationDatabase(databasePath);
      return handleConversation(req, res, database);
    }
    if (req.url === '/apollo-api/artifacts' && req.method === 'GET') {
      return json(res, 200, { artifacts: await listStoredArtifacts(artifactRoot) });
    }
    if (req.url.startsWith('/apollo-api/artifact?') && req.method === 'GET') {
      return sendStoredArtifact(req, res, artifactRoot);
    }
    if (req.url === '/apollo-api/title') {
      if (req.method !== 'POST') return jsonError(res, 405, 'Method not allowed');
      try {
        const { text } = JSON.parse(await readBody(req)) as { text?: unknown };
        if (typeof text !== 'string' || !text.trim()) throw new Error('text 不能为空');
        const titleEngine = await createQueryEngine({
          configPath,
          envPath,
          stream: false,
          approvalProvider: async () => false,
        });
        try {
          const title = await titleEngine.submitMessage(`为下面的用户请求生成一个简洁中文对话标题。只输出标题，不要解释、引号、句号或 Markdown，长度 6 到 16 个汉字。\n\n用户请求：${text.trim().slice(0, 2000)}`);
          return json(res, 200, { title: cleanTitle(title) });
        } finally {
          const sessionId = titleEngine.getSessionId();
          await titleEngine.close();
          if (sessionId) await fs.rm(path.join(workspaceRoot, '.apollo', 'sessions', `${sessionId}.json`), { force: true });
        }
      } catch (error) {
        return jsonError(res, 400, error instanceof Error ? error.message : String(error));
      }
    }
    if (req.url === '/apollo-api/permission') {
      if (req.method === 'GET') return json(res, 200, { mode: await permissionMode(configPath) });
      if (req.method !== 'POST') return jsonError(res, 405, 'Method not allowed');
      if (busy) return jsonError(res, 409, '智能体正在运行，请稍后切换模式');
      try {
        const { mode } = JSON.parse(await readBody(req)) as { mode?: unknown };
        if (mode !== 'ask' && mode !== 'unrestricted') throw new Error('无效的权限模式');
        const config = await readConfig(configPath);
        config.permissions = {
          ...(typeof config.permissions === 'object' && config.permissions ? config.permissions : {}),
          mode,
          autoApproveReadOnly: true,
        };
        await writeConfig(configPath, config);
        await closeEngines();
        return json(res, 200, { mode });
      } catch (error) {
        return jsonError(res, 400, error instanceof Error ? error.message : String(error));
      }
    }
    if (req.url === '/apollo-api/config') {
      if (req.method === 'GET') {
        const config = await fs.readFile(configPath, 'utf8').catch(() => '{}');
        return json(res, 200, { path: '.apollo/config.json', config });
      }
      if (req.method !== 'POST') return jsonError(res, 405, 'Method not allowed');
      if (busy) return jsonError(res, 409, '智能体正在运行，请稍后再保存配置');
      try {
        const { config } = JSON.parse(await readBody(req)) as { config?: unknown };
        if (typeof config !== 'string') throw new Error('config 必须是 JSON 文本');
        const parsed = JSON.parse(config) as unknown;
        if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error('配置必须是 JSON 对象');
        await writeConfig(configPath, parsed as Record<string, unknown>);
        await closeEngines();
        return json(res, 200, { ok: true });
      } catch (error) {
        return jsonError(res, 400, error instanceof Error ? error.message : String(error));
      }
    }
    if (req.url === '/apollo-api/status' && req.method === 'GET') {
      try {
        return json(res, 200, runtimeStatus(await getEngine('assistant')));
      } catch (error) {
        return jsonError(res, 500, error instanceof Error ? error.message : String(error));
      }
    }
    if (req.url !== '/apollo-api/chat') return next();
    if (req.method !== 'POST') return jsonError(res, 405, 'Method not allowed');
    if (busy) return jsonError(res, 409, '智能体正在处理上一条消息');

    let message: unknown;
    let channel: 'assistant' | 'entry' = 'entry';
    try {
      const body = JSON.parse(await readBody(req)) as { message?: unknown; channel?: unknown };
      message = body.message;
      if (body.channel === 'assistant') channel = 'assistant';
      else if (body.channel !== undefined && body.channel !== 'entry') throw new Error('channel 无效');
      if (typeof message !== 'string' || !message.trim()) throw new Error('message 不能为空');
    } catch (error) {
      return jsonError(res, 400, error instanceof Error ? error.message : String(error));
    }

    busy = true;
    const startedAt = Date.now();
    const changedPaths = new Set<string>();
    let closed = false;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    });
    const send: Send = (event) => {
      if (!closed) res.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    activeSend = send;
    sink = (event) => {
      if (event.type === 'tool_result' && event.fileChange?.path) changedPaths.add(event.fileChange.path);
      send({ type: 'trace', event: webTraceEvent(event) });
    };

    res.on('close', () => {
      closed = true;
      if (!res.writableEnded) activeEngine?.cancelCurrentTurn();
      for (const [id, pending] of interactions) {
        interactions.delete(id);
        pending.resolve(pending.fallback);
      }
    });

    try {
      const runtime = await getEngine(channel);
      activeEngine = runtime;
      await runInput(runtime, message.trim(), send);
      if (channel === 'assistant' && runtime.getSessionId()) {
        await fs.mkdir(path.dirname(assistantSessionPath), { recursive: true });
        await fs.writeFile(assistantSessionPath, `${runtime.getSessionId()}\n`, 'utf8');
      }
      const artifacts = await collectArtifacts(workspaceRoot, startedAt, changedPaths);
      send({ type: 'done', artifacts, status: runtimeStatus(runtime) });
    } catch (error) {
      send({ type: 'error', message: error instanceof Error ? error.message : String(error) });
    } finally {
      sink = undefined;
      activeSend = undefined;
      activeEngine = undefined;
      busy = false;
      if (!closed) res.end();
    }
  };

  return {
    handle,
    close: async () => {
      for (const pending of interactions.values()) pending.resolve(pending.fallback);
      interactions.clear();
      await closeEngines();
      database?.close();
    },
  };
}

function openConversationDatabase(databasePath: string): DatabaseSync {
  mkdirSync(path.dirname(databasePath), { recursive: true });
  const database = new DatabaseSync(databasePath);
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      group_name TEXT NOT NULL DEFAULT '最近',
      messages_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);
  migrateApolloSessions(database, path.join(path.dirname(databasePath), 'sessions'));
  return database;
}

function migrateApolloSessions(database: DatabaseSync, sessionsPath: string): void {
  if (database.prepare("SELECT value FROM app_meta WHERE key = 'apollo_sessions_migrated'").get()) return;
  let files: string[];
  try {
    files = readdirSync(sessionsPath).filter((file) => file.endsWith('.json'));
  } catch {
    return;
  }
  const insert = database.prepare(`
    INSERT OR IGNORE INTO conversations (id, title, group_name, messages_json, created_at, updated_at)
    VALUES (?, ?, '最近', ?, ?, ?)
  `);
  for (const file of files) {
    try {
      const session = JSON.parse(readFileSync(path.join(sessionsPath, file), 'utf8')) as {
        meta?: { id?: string; title?: string; createdAt?: string; updatedAt?: string };
        messages?: Array<{ role?: string; content?: unknown }>;
      };
      const id = session.meta?.id;
      if (!id || !Array.isArray(session.messages)) continue;
      const messages = session.messages.flatMap((message, index) => {
        const content = visibleSessionText(message.content);
        if ((message.role !== 'user' && message.role !== 'assistant') || !content) return [];
        return [{ id: `${id}-${index}`, role: message.role, content }];
      });
      if (!messages.length) continue;
      const createdAt = session.meta?.createdAt ?? new Date().toISOString();
      insert.run(id, session.meta?.title?.slice(0, 48) ?? '历史对话', JSON.stringify(messages), createdAt, session.meta?.updatedAt ?? createdAt);
    } catch {
      // 单个损坏会话不影响其余历史记录迁移。
    }
  }
  database.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('apollo_sessions_migrated', ?)").run(new Date().toISOString());
}

function visibleSessionText(content: unknown): string {
  if (typeof content === 'string') return (content.split('# User Request\n').at(-1) ?? content).trim();
  if (!Array.isArray(content)) return '';
  return content.flatMap((block) => {
    if (!block || typeof block !== 'object') return [];
    const item = block as { type?: unknown; text?: unknown };
    return item.type === 'text' && typeof item.text === 'string' ? [item.text] : [];
  }).join('\n\n').trim();
}

function listConversations(database: DatabaseSync) {
  return database.prepare(`
    SELECT id, title, group_name AS "group", updated_at AS "updatedAt"
    FROM conversations ORDER BY updated_at DESC
  `).all();
}

async function handleConversation(req: IncomingMessage, res: ServerResponse, database: DatabaseSync): Promise<void> {
  const id = decodeURIComponent(req.url!.slice('/apollo-api/conversations/'.length).split('?', 1)[0]!);
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) return jsonError(res, 400, '无效的对话 id');
  if (req.method === 'GET') {
    const row = database.prepare(`
      SELECT id, title, group_name AS "group", messages_json AS "messages", updated_at AS "updatedAt"
      FROM conversations WHERE id = ?
    `).get(id) as { id: string; title: string; group: string; messages: string; updatedAt: string } | undefined;
    if (!row) return jsonError(res, 404, '对话不存在');
    return json(res, 200, { ...row, messages: JSON.parse(row.messages) });
  }
  if (req.method === 'DELETE') {
    database.prepare('DELETE FROM conversations WHERE id = ?').run(id);
    return json(res, 200, { ok: true });
  }
  if (req.method === 'PATCH') {
    const body = JSON.parse(await readBody(req)) as { title?: unknown; group?: unknown };
    const current = database.prepare('SELECT title, group_name AS "group" FROM conversations WHERE id = ?').get(id) as { title: string; group: string } | undefined;
    if (!current) return jsonError(res, 404, '对话不存在');
    const title = typeof body.title === 'string' ? body.title.slice(0, 48) : current.title;
    const group = body.group === '已归档' || body.group === '最近' ? body.group : current.group;
    database.prepare('UPDATE conversations SET title = ?, group_name = ?, updated_at = ? WHERE id = ?').run(title, group, new Date().toISOString(), id);
    return json(res, 200, { ok: true });
  }
  if (req.method !== 'PUT') return jsonError(res, 405, 'Method not allowed');
  try {
    const body = JSON.parse(await readBody(req, 10 * 1024 * 1024)) as { title?: unknown; group?: unknown; messages?: unknown };
    if (!Array.isArray(body.messages)) throw new Error('messages 必须是数组');
    const title = typeof body.title === 'string' ? body.title.slice(0, 48) : '';
    const group = body.group === '已归档' ? '已归档' : '最近';
    const now = new Date().toISOString();
    database.prepare(`
      INSERT INTO conversations (id, title, group_name, messages_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        group_name = excluded.group_name,
        messages_json = excluded.messages_json,
        updated_at = excluded.updated_at
    `).run(id, title, group, JSON.stringify(body.messages), now, now);
    return json(res, 200, { id, title, group, updatedAt: now });
  } catch (error) {
    return jsonError(res, 400, error instanceof Error ? error.message : String(error));
  }
}

async function readConfig(configPath: string): Promise<Record<string, unknown>> {
  try {
    const parsed = JSON.parse(await fs.readFile(configPath, 'utf8')) as unknown;
    return parsed && !Array.isArray(parsed) && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

async function writeConfig(configPath: string, config: Record<string, unknown>): Promise<void> {
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

async function permissionMode(configPath: string): Promise<'ask' | 'unrestricted'> {
  const config = await readConfig(configPath);
  const permissions = config.permissions as { mode?: unknown } | undefined;
  return permissions?.mode === 'unrestricted' ? 'unrestricted' : 'ask';
}

async function isUnrestricted(configPath: string): Promise<boolean> {
  return (await permissionMode(configPath)) === 'unrestricted';
}

function cleanTitle(value: string): string {
  return value
    .replace(/[*#`"“”'‘’。]/g, '')
    .split(/\r?\n/, 1)[0]!
    .trim()
    .slice(0, 24) || '新对话';
}

type WebEvent =
  | {
      type: 'interaction';
      id: string;
      kind: 'approval' | 'question';
      title: string;
      detail?: string;
      risk?: 'low' | 'medium' | 'high';
      options?: string[];
    }
  | { type: 'trace'; event: TraceEvent };

async function handleResponse(
  req: IncomingMessage,
  res: ServerResponse,
  interactions: Map<string, PendingInteraction>,
): Promise<void> {
  if (req.method !== 'POST') return jsonError(res, 405, 'Method not allowed');
  try {
    const { id, answer } = JSON.parse(await readBody(req)) as { id?: unknown; answer?: unknown };
    if (typeof id !== 'string' || typeof answer !== 'string') throw new Error('id 和 answer 必填');
    const pending = interactions.get(id);
    if (!pending) return jsonError(res, 404, '交互请求已失效');
    interactions.delete(id);
    pending.resolve(answer);
    json(res, 200, { ok: true });
  } catch (error) {
    jsonError(res, 400, error instanceof Error ? error.message : String(error));
  }
}

async function runInput(runtime: QueryEngine, input: string, send: Send): Promise<void> {
  const [command, ...rest] = input.split(/\s+/);
  const argument = rest.join(' ').trim();
  switch (command) {
    case '/help':
    case '/':
      sendText(send, [
        '/status · /compact · /clear · /save',
        '/plan · /approve · /reject',
        '/goal <goal> · /goal-stop',
        '/workflow <goal> · /wf · /workflow-stop',
        '/sessions · /resume [id] · /skill',
      ].join('\n'));
      return;
    case '/status':
      send({ type: 'status', status: runtimeStatus(runtime) });
      return;
    case '/compact': {
      const result = await runtime.compactConversation(true);
      if (result === 'not_needed') sendText(send, 'Nothing to compact yet.');
      return;
    }
    case '/clear':
      runtime.clearConversation();
      sendText(send, 'Conversation cleared.');
      return;
    case '/plan':
      await runtime.enterPlanMode();
      return;
    case '/approve':
      await runtime.approvePlan();
      return;
    case '/reject':
      await runtime.rejectPlan();
      return;
    case '/goal':
      if (argument) runtime.startGoal(argument);
      else emitGoal(runtime, send);
      return;
    case '/goal-stop':
      runtime.stopGoal();
      emitGoal(runtime, send);
      return;
    case '/workflow':
      if (argument) runtime.startWorkflow(argument);
      else emitWorkflow(runtime, send);
      return;
    case '/wf':
      emitWorkflow(runtime, send);
      return;
    case '/workflow-stop':
      runtime.stopWorkflow();
      sendText(send, 'Workflow stopped.');
      return;
    case '/save':
      sendText(send, `Session saved: ${(await runtime.saveCurrentSession()) ?? '(none)'}`);
      return;
    case '/sessions': {
      const sessions = await runtime.listSessions();
      sendText(send, sessions.length ? sessions.map((s) => `- ${s.id} · ${s.title}`).join('\n') : 'No sessions.');
      return;
    }
    case '/resume': {
      const session = await runtime.resumeSession(argument || undefined);
      sendText(send, session ? `Resumed ${session.meta.id}` : 'Session not found.');
      return;
    }
    case '/skill': {
      const skills = await runtime.listSkills();
      sendText(send, skills.length ? skills.map((s) => `- ${s.name}: ${s.path}`).join('\n') : 'No skills installed.');
      return;
    }
    default:
      await runtime.submitMessage(input);
  }
}

function emitGoal(runtime: QueryEngine, send: Send): void {
  const goal = runtime.getGoal();
  if (!goal) return sendText(send, 'No active goal.');
  send({
    type: 'trace',
    event: {
      type: 'goal_status',
      goal: goal.goal,
      status: goal.status,
      iteration: goal.iteration,
      maxIterations: goal.maxIterations,
      progress: goal.progress,
    },
  });
}

function emitWorkflow(runtime: QueryEngine, send: Send): void {
  const workflow = runtime.getWorkflow();
  if (!workflow) return sendText(send, 'No active workflow.');
  send({
    type: 'trace',
    event: {
      type: 'workflow_status',
      goal: workflow.goal,
      phases: workflow.phases.map(({ name, label, status, summary }) => ({ name, label, status, summary })),
    },
  });
}

function sendText(send: Send, text: string): void {
  send({ type: 'trace', event: { type: 'assistant_delta', text } });
}

function runtimeStatus(runtime: QueryEngine): RuntimeStatus {
  const usage = runtime.getUsageStats();
  const info = runtime.getRuntimeInfo();
  return {
    product: PRODUCT.name,
    version: PRODUCT.version,
    model: info.model,
    baseUrl: info.baseUrl,
    maxTokens: info.maxTokens,
    contextMaxChars: info.contextMaxChars,
    cwd: info.workspaceRoot,
    messages: runtime.conversationSize(),
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheReadTokens: usage.cache_read_input_tokens,
    cacheWriteTokens: usage.cache_creation_input_tokens,
    cacheHitRate: usage.cacheHitRate,
    requestHitRate: usage.requestHitRate,
    latestHitRate: usage.latestByCategory.main?.cacheHitRate ?? null,
    cacheMode: runtime.getCacheMode(),
    cacheKeys: {
      prefix: usage.cacheDiagnostics.prefixFingerprint,
      config: usage.cacheDiagnostics.configFingerprint,
      system: usage.cacheDiagnostics.systemFingerprint,
      tools: usage.cacheDiagnostics.toolsFingerprint,
    },
    categories: Object.fromEntries(
      Object.entries(usage.byCategory).map(([name, value]) => [
        name,
        {
          requests: value.requests,
          requestsWithCacheRead: value.requestsWithCacheRead,
          cacheHitRate: value.cacheHitRate,
        },
      ]),
    ),
    mode: runtime.getMode(),
    goal: runtime.getGoal()?.goal ?? null,
    session: runtime.getSessionId(),
  };
}

function webTraceEvent(event: TraceEvent): TraceEvent {
  if (event.type === 'thinking_delta') return { ...event, text: truncate(event.text, 2000) };
  if (event.type === 'tool_call') return { ...event, input: compactInput(event.input) };
  if (event.type === 'tool_result') {
    return {
      ...event,
      input: event.input ? compactInput(event.input) : undefined,
      content: truncate(event.content, 12000),
    };
  }
  if (event.type === 'task_finish') return { ...event, result: truncate(event.result, 12000) };
  if (event.type === 'task_progress') return { ...event, message: truncate(event.message, 2000) };
  return event;
}

function compactInput(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).map(([key, value]) => [key, typeof value === 'string' ? truncate(value, 4000) : value]),
  );
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}\n… [truncated ${value.length - max} chars]`;
}

async function readBody(req: IncomingMessage, maxBytes = 1024 * 1024): Promise<string> {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > maxBytes) throw new Error('请求体过大');
  }
  return body;
}

function isLoopback(address = ''): boolean {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function json(res: ServerResponse, status: number, body: object): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function jsonError(res: ServerResponse, status: number, message: string): void {
  json(res, status, { error: message });
}

async function collectArtifacts(root: string, startedAt: number, changedPaths: Set<string>): Promise<Artifact[]> {
  const candidates = new Set([...changedPaths].map((file) => path.resolve(root, file)));
  await findRecentArtifacts(root, startedAt, candidates);
  const artifacts = await Promise.all([...candidates].map((file) => artifactFromFile(root, file)));
  return artifacts.filter((artifact): artifact is Artifact => artifact !== null);
}

async function findRecentArtifacts(directory: string, startedAt: number, output: Set<string>): Promise<void> {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRECTORIES.has(entry.name)) {
        await findRecentArtifacts(path.join(directory, entry.name), startedAt, output);
      }
      continue;
    }
    if (!ARTIFACT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
    const file = path.join(directory, entry.name);
    if ((await fs.stat(file)).mtimeMs >= startedAt) output.add(file);
  }
}

async function artifactFromFile(root: string, file: string): Promise<Artifact | null> {
  const relative = path.relative(root, file);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  const ext = path.extname(file).toLowerCase();
  if (!ARTIFACT_EXTENSIONS.has(ext)) return null;
  const stat = await fs.stat(file).catch(() => null);
  if (!stat?.isFile() || stat.size > MAX_ARTIFACT_BYTES) return null;

  const bytes = await fs.readFile(file);
  const common = { id: relative, title: path.basename(file), size: stat.size, meta: { path: relative } };
  if (ext === '.md') return { ...common, kind: 'markdown', content: bytes.toString('utf8') };
  if (ext === '.json') return { ...common, kind: 'json', content: bytes.toString('utf8') };
  if (ext === '.docx') return { ...common, kind: 'word', content: bytes.toString('base64') };
  return { ...common, kind: 'pdf', url: `data:application/pdf;base64,${bytes.toString('base64')}` };
}

async function listStoredArtifacts(root: string) {
  const files = new Set<string>();
  await findRecentArtifacts(root, 0, files).catch(() => undefined);
  const items = await Promise.all([...files].map(async (file) => {
    const stat = await fs.stat(file);
    const relative = path.relative(root, file);
    const ext = path.extname(file).toLowerCase();
    return {
      id: relative,
      title: path.basename(file),
      kind: artifactKind(ext),
      size: stat.size,
      modifiedAt: stat.mtime.toISOString(),
      url: `/apollo-api/artifact?path=${encodeURIComponent(relative)}`,
    };
  }));
  return items.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
}

async function sendStoredArtifact(req: IncomingMessage, res: ServerResponse, root: string): Promise<void> {
  try {
    const relative = new URL(req.url!, 'http://localhost').searchParams.get('path');
    if (!relative) return jsonError(res, 400, 'path 必填');
    const file = path.resolve(root, relative);
    const safeRelative = path.relative(root, file);
    if (safeRelative.startsWith('..') || path.isAbsolute(safeRelative)) return jsonError(res, 403, '无权访问该文件');
    const ext = path.extname(file).toLowerCase();
    if (!ARTIFACT_EXTENSIONS.has(ext)) return jsonError(res, 400, '不支持的文件类型');
    const stat = await fs.stat(file);
    if (!stat.isFile() || stat.size > MAX_ARTIFACT_BYTES) return jsonError(res, 404, '文件不存在或过大');
    res.writeHead(200, {
      'Content-Type': artifactMime(ext),
      'Content-Length': stat.size,
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(path.basename(file))}`,
    });
    res.end(await fs.readFile(file));
  } catch {
    jsonError(res, 404, '文件不存在');
  }
}

function artifactKind(ext: string): Artifact['kind'] {
  if (ext === '.docx') return 'word';
  if (ext === '.pdf') return 'pdf';
  if (ext === '.json') return 'json';
  return 'markdown';
}

function artifactMime(ext: string): string {
  if (ext === '.docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (ext === '.pdf') return 'application/pdf';
  if (ext === '.json') return 'application/json; charset=utf-8';
  return 'text/markdown; charset=utf-8';
}

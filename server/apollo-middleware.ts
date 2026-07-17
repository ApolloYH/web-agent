import fs from 'node:fs/promises';
import { mkdirSync, readdirSync, readFileSync, statfsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes, scrypt, timingSafeEqual, randomUUID } from 'node:crypto';
import {
  PRODUCT,
  createQueryEngine,
  listMemories,
  saveMemory,
  type ApprovalProvider,
  type QueryEngine,
  type TraceEvent,
} from '@apolloyh/apollo-agent';
import type { Artifact, RuntimeStatus } from '../src/types/index.js';
import { createEntryTools } from './entry-tools.js';
import { createDocumentTools } from './document-tools.js';
import { createBrowserTools } from './browser-tools.js';
import { createManagedBrowserTools } from './managed-browser-tools.js';
import { createSiteTools, deletePublishedSite, listPublishedSites, publishSite, servePublishedSite } from './site-tools.js';
import { agentRunKey, capacityReason, consumeFixedWindow, pruneExpiredWindows, type RateLimitWindow } from './concurrency.js';

const ARTIFACT_EXTENSIONS = new Set(['.docx', '.pdf', '.jpg', '.jpeg', '.png', '.webp', '.md', '.markdown', '.json']);
const SKIP_DIRECTORIES = new Set(['.git', '.apollo', 'node_modules', 'dist']);
const MAX_ARTIFACT_BYTES = 25 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const MAX_UPLOAD_REQUEST_BYTES = 64 * 1024 * 1024;
const UPLOAD_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.txt', '.md', '.json']);
const INTERACTION_TIMEOUT_MS = 5 * 60_000;
const AUTH_IP_RATE_LIMIT = 60;
const AUTH_IDENTITY_RATE_LIMIT = 10;
const AUTH_RATE_WINDOW_MS = 60_000;
const MAX_CONCURRENT_FILE_TRANSFERS = 2;
const WEB_BLOCKED_TOOLS = new Set([
  'shell_exec',
  'workspace_boundary',
  'sensitive_file_read',
  'skill_install',
  'mcp_list_tools',
  'mcp_call_tool',
]);

export function isWebToolAllowed(toolName: string): boolean {
  return !WEB_BLOCKED_TOOLS.has(toolName);
}

type Send = (event: object) => void;
type PendingInteraction = { userId: string; resolve: (answer: string) => void; fallback: string; timer: NodeJS.Timeout };
type AuthUser = { id: string; username: string; admin: boolean };
class StorageQuotaError extends Error {}
type RunContext = {
  id: string;
  userId: string;
  channel: 'assistant' | 'entry';
  send: Send;
  sink: (event: TraceEvent) => void;
  permissionMode: 'ask' | 'unrestricted';
  interactionIds: Set<string>;
  runtime?: QueryEngine;
};

type UserRuntimeContext = {
  userId: string;
  workspaceRoot: string;
  assistantConfigPath: string;
  assistantSessionPath: string;
  assistantEngine?: Promise<QueryEngine>;
  entryEngines: Map<string, Promise<QueryEngine>>;
  entryTurnStates: Map<string, { standardsQuery?: Promise<string> }>;
  ready: Promise<void>;
  lastUsedAt: number;
};

type EntryConfig = {
  langcoreApiKey: string;
  langhubApiKey: string;
  langhubBaseUrl: string;
  projects: Record<string, string>;
};

export function createApolloMiddleware({ workspaceRoot, envPath, registrationInvite, adminUsername, allowUnrestricted = false, maxConcurrentRuns = 8, maxRunsPerUser = 3, minFreeDiskBytes = 512 * 1024 * 1024, userStorageQuotaBytes = 2 * 1024 * 1024 * 1024, uploadRetentionDays = 7, trustedProxyAddresses = [], managedBrowser, sitesBaseUrl = '', entry }: { workspaceRoot: string; envPath: string; registrationInvite: string; adminUsername: string; allowUnrestricted?: boolean; maxConcurrentRuns?: number; maxRunsPerUser?: number; minFreeDiskBytes?: number; userStorageQuotaBytes?: number; uploadRetentionDays?: number; trustedProxyAddresses?: string[]; managedBrowser?: { url: string; token: string }; sitesBaseUrl?: string; entry: EntryConfig }) {
  minFreeDiskBytes = Number.isFinite(minFreeDiskBytes) && minFreeDiskBytes >= 0 ? minFreeDiskBytes : 512 * 1024 * 1024;
  userStorageQuotaBytes = Number.isFinite(userStorageQuotaBytes) && userStorageQuotaBytes >= 0 ? userStorageQuotaBytes : 2 * 1024 * 1024 * 1024;
  uploadRetentionDays = Number.isFinite(uploadRetentionDays) && uploadRetentionDays >= 1 ? uploadRetentionDays : 7;
  const entryConfigTemplatePath = path.join(workspaceRoot, 'config', 'web-entry-apollo.json');
  const entryConfigPath = path.join(workspaceRoot, '.apollo', 'web-entry-config.json');
  const assistantConfigTemplatePath = path.join(workspaceRoot, 'config', 'web-assistant-apollo.json');
  const databasePath = path.join(workspaceRoot, '.apollo', 'web-agent.sqlite');
  const publicSitesRoot = path.join(workspaceRoot, '.apollo', 'published-sites');
  const database = openConversationDatabase(databasePath);
  const runs = new Map<string, RunContext>();
  const interactions = new Map<string, PendingInteraction>();
  const userContexts = new Map<string, UserRuntimeContext>();
  const managedBrowserViews = new Map<string, { id: string; updatedAt: number }>();
  const authRateLimits = new Map<string, RateLimitWindow>();
  const trustedProxies = new Set(trustedProxyAddresses.map(normalizeAddress).filter(Boolean));
  const globalRunLimit = positiveInteger(maxConcurrentRuns, 8);
  const perUserRunLimit = Math.min(positiveInteger(maxRunsPerUser, 3), globalRunLimit);
  const maxCachedRuntimeUsers = Math.max(16, globalRunLimit * 2);
  let auxiliaryJobs = 0;
  const auxiliaryJobsByUser = new Map<string, number>();
  let activeFileTransfers = 0;
  const fileTransfersByUser = new Map<string, number>();
  let closing = false;
  let lastMaintenanceAt = 0;
  const entryTemplate = JSON.parse(readFileSync(entryConfigTemplatePath, 'utf8')) as Record<string, unknown>;
  let entryRuntime: Record<string, unknown> = {};
  try { entryRuntime = JSON.parse(readFileSync(entryConfigPath, 'utf8')) as Record<string, unknown>; } catch { /* first start */ }
  mkdirSync(path.dirname(entryConfigPath), { recursive: true });
  writeFileSync(entryConfigPath, `${JSON.stringify({ ...entryTemplate, permissions: entryRuntime.permissions ?? entryTemplate.permissions }, null, 2)}\n`, 'utf8');

  const getUserContext = async (user: AuthUser): Promise<UserRuntimeContext> => {
    const userId = user.id;
    let context = userContexts.get(userId);
    if (!context) {
      const userRoot = path.join(workspaceRoot, '.apollo', 'users', userId, 'workspace');
      context = {
        userId,
        workspaceRoot: userRoot,
        assistantConfigPath: path.join(userRoot, '.apollo', 'assistant-config.json'),
        assistantSessionPath: path.join(userRoot, '.apollo', 'web-assistant-session'),
        entryEngines: new Map(),
        entryTurnStates: new Map(),
        ready: ensureUserWorkspace(userRoot, path.join(workspaceRoot, 'entry-skills'), assistantConfigTemplatePath)
          .then(() => user.admin ? undefined : enforceTenantSafeConfig(path.join(userRoot, '.apollo', 'assistant-config.json'))),
        lastUsedAt: Date.now(),
      };
      userContexts.set(userId, context);
      context.ready.catch(() => {
        if (userContexts.get(userId) === context) userContexts.delete(userId);
      });
    }
    context.lastUsedAt = Date.now();
    await context.ready;
    return context;
  };

  const requestInteraction = (
    runKey: string,
    payload: Omit<Extract<WebEvent, { type: 'interaction' }>, 'id'>,
    fallback: string,
  ): Promise<string> => {
    const run = runs.get(runKey);
    if (!run) return Promise.resolve(fallback);
    const id = `interaction-${randomUUID()}`;
    run.interactionIds.add(id);
    run.send({ ...payload, id });
    return registerInteraction(id, run, fallback);
  };

  const requestClientTool = async (
    runKey: string,
    type: 'editor_request' | 'browser_request',
    action: string,
    input: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    const run = runs.get(runKey);
    if (!run) return { ok: false, error: '当前没有可用的浏览器会话' };
    const id = `${type === 'editor_request' ? 'editor' : 'browser'}-${randomUUID()}`;
    run.interactionIds.add(id);
    run.send({ type, id, action, input });
    const answer = await registerInteraction(id, run, JSON.stringify({ ok: false, error: '浏览器请求已取消' }));
    try {
      const parsed = JSON.parse(answer) as unknown;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : { ok: false, error: '浏览器返回格式无效' };
    } catch {
      return { ok: false, error: answer || '浏览器没有返回结果' };
    }
  };

  const clientTools = (runKey: string) => [
    ...createDocumentTools((action, input) => requestClientTool(runKey, 'editor_request', action, input)),
    ...createBrowserTools((action, input) => requestClientTool(runKey, 'browser_request', action, input)),
    ...createManagedBrowserTools(managedBrowser ? {
      ...managedBrowser,
      onSession: (id) => {
        const run = runs.get(runKey);
        if (run) managedBrowserViews.set(run.userId, { id, updatedAt: Date.now() });
      },
    } : undefined),
    ...createSiteTools(sitesBaseUrl && runs.get(runKey) ? {
      publicRoot: publicSitesRoot,
      baseUrl: sitesBaseUrl,
      ownerId: runs.get(runKey)!.userId,
    } : { publicRoot: publicSitesRoot, baseUrl: '', ownerId: '' }),
  ];

  const handleManagedBrowserView = async (req: IncomingMessage, res: ServerResponse, userId: string) => {
    if (req.method !== 'GET') return jsonError(res, 405, 'Method not allowed');
    if (!managedBrowser) return json(res, 200, { available: false, session: null });
    const view = managedBrowserViews.get(userId);
    if (!view) return json(res, 200, { available: true, session: null });
    const pathname = new URL(req.url!, 'http://localhost').pathname;
    const frame = pathname === '/apollo-api/browser-view/frame';
    try {
      const response = await fetch(new URL(`/sessions/${view.id}${frame ? '/frame' : ''}`, managedBrowser.url), {
        headers: managedBrowser.token ? { Authorization: `Bearer ${managedBrowser.token}` } : {},
      });
      if (response.status === 404 && !frame) return json(res, 200, { available: true, session: null });
      if (!response.ok) return jsonError(res, 502, '浏览器画面暂时不可用');
      if (!frame) return json(res, 200, { available: true, session: { ...(await response.json() as object), id: view.id } });
      const bytes = Buffer.from(await response.arrayBuffer());
      res.writeHead(200, {
        'Content-Type': response.headers.get('content-type') || 'image/jpeg',
        'Content-Length': bytes.length,
        'Cache-Control': 'private, max-age=10, immutable',
      });
      res.end(bytes);
    } catch {
      return jsonError(res, 502, '浏览器画面暂时不可用');
    }
  };

  function registerInteraction(id: string, run: RunContext, fallback: string): Promise<string> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (interactions.get(id)?.timer !== timer) return;
        interactions.delete(id);
        run.interactionIds.delete(id);
        resolve(fallback);
      }, INTERACTION_TIMEOUT_MS);
      timer.unref();
      interactions.set(id, { userId: run.userId, resolve, fallback, timer });
    });
  }

  const settleInteraction = (id: string, answer?: string): void => {
    const pending = interactions.get(id);
    if (!pending) return;
    interactions.delete(id);
    clearTimeout(pending.timer);
    pending.resolve(answer ?? pending.fallback);
  };

  const approvalProvider = (runKey: string): ApprovalProvider => async (request) => {
    const run = runs.get(runKey);
    if (!isWebToolAllowed(request.toolName)) {
      run?.sink({
        type: 'approval_required',
        tool: request.toolName,
        risk: request.risk,
        reason: 'Web 多租户部署禁止系统命令、工作区越界和外部工具调用',
      });
      run?.sink({ type: 'approval_result', tool: request.toolName, approved: false });
      return false;
    }
    if (allowUnrestricted && run?.permissionMode === 'unrestricted') return true;
    if (request.risk === 'low') return true;
    run?.sink({
      type: 'approval_required',
      tool: request.toolName,
      risk: request.risk,
      reason: request.reason,
    });
    const answer = await requestInteraction(
      runKey,
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
    run?.sink({ type: 'approval_result', tool: request.toolName, approved });
    return approved;
  };

  const createAssistantEngine = async (context: UserRuntimeContext, runKey: string, sessionId?: string) => createQueryEngine({
    configPath: context.assistantConfigPath,
    configMode: 'isolated',
    workspaceRoot: context.workspaceRoot,
    envPath,
    sessionId,
    approvalProvider: approvalProvider(runKey),
    askUser: (question, options) =>
      requestInteraction(
        runKey,
        { type: 'interaction', kind: 'question', title: question, options },
        '(no answer)',
      ),
    onEvent: (event) => runs.get(runKey)?.sink(event),
    extraTools: clientTools(runKey),
  });

  const getEngine = async (context: UserRuntimeContext, channel: 'assistant' | 'entry' = 'entry', conversationId = '') => {
    const runKey = agentRunKey(context.userId, channel, conversationId);
    if (channel === 'assistant') {
      if (!context.assistantEngine) {
        const runtimePromise = fs.readFile(context.assistantSessionPath, 'utf8')
          .then((value) => value.trim())
          .catch(() => '')
          .then((sessionId) => createAssistantEngine(context, runKey, sessionId || undefined));
        context.assistantEngine = runtimePromise;
        runtimePromise.catch(() => {
          if (context.assistantEngine === runtimePromise) context.assistantEngine = undefined;
        });
      }
      return context.assistantEngine;
    }
    const existing = context.entryEngines.get(conversationId);
    if (existing) {
      context.entryEngines.delete(conversationId);
      context.entryEngines.set(conversationId, existing);
      return existing;
    }
    const turnState = context.entryTurnStates.get(conversationId) ?? {};
    context.entryTurnStates.set(conversationId, turnState);
    const runtimePromise = fs.readFile(entrySessionPath(context.workspaceRoot, conversationId), 'utf8')
      .then((value) => value.trim())
      .catch(() => '')
      .then((sessionId) => createQueryEngine({
      configPath: entryConfigPath,
      configMode: 'isolated',
      workspaceRoot: context.workspaceRoot,
      envPath,
      sessionId: sessionId || undefined,
      approvalProvider: approvalProvider(runKey),
      askUser: (question, options) => requestInteraction(runKey, { type: 'interaction', kind: 'question', title: question, options }, '(no answer)'),
      onEvent: (event) => runs.get(runKey)?.sink(event),
      memoryEnabled: false,
      extraTools: [
        ...createEntryTools({
          workspaceRoot: context.workspaceRoot,
          conversationId,
          langcoreApiKey: entry.langcoreApiKey,
          langhubApiKey: entry.langhubApiKey,
          langhubBaseUrl: entry.langhubBaseUrl,
          automationMode: () => runs.get(runKey)?.permissionMode === 'unrestricted' ? 'auto' : 'ask',
          projects: entry.projects,
          turnState,
          assertStorageCapacity: (incomingBytes) => assertWorkspaceCapacity(context.workspaceRoot, userStorageQuotaBytes, incomingBytes),
        }),
        ...clientTools(runKey),
      ],
    }));
    context.entryEngines.set(conversationId, runtimePromise);
    runtimePromise.catch(() => {
      if (context.entryEngines.get(conversationId) === runtimePromise) context.entryEngines.delete(conversationId);
    });
    return runtimePromise;
  };

  const closeAssistantEngine = async (context: UserRuntimeContext) => {
    const runtime = context.assistantEngine;
    context.assistantEngine = undefined;
    if (runtime) await runtime.then((engine) => engine.close()).catch(() => undefined);
  };

  const closeEntryEngines = async (context: UserRuntimeContext) => {
    const runtimes = [...context.entryEngines.values()];
    context.entryEngines.clear();
    context.entryTurnStates.clear();
    await Promise.all(runtimes.map((runtime) => runtime.then((engine) => engine.close()).catch(() => undefined)));
  };

  const closeUserEngines = async (context: UserRuntimeContext) => {
    await Promise.all([closeAssistantEngine(context), closeEntryEngines(context)]);
  };

  const pruneEntryEngines = async (context: UserRuntimeContext) => {
    for (const [conversationId, runtime] of context.entryEngines) {
      if (context.entryEngines.size <= perUserRunLimit) break;
      if (runs.has(agentRunKey(context.userId, 'entry', conversationId))) continue;
      context.entryEngines.delete(conversationId);
      context.entryTurnStates.delete(conversationId);
      await runtime.then((engine) => engine.close()).catch(() => undefined);
    }
  };

  const handleRequest = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (sitesBaseUrl && await servePublishedSite(req, res, publicSitesRoot, sitesBaseUrl)) return;
    if (!req.url?.startsWith('/apollo-api/')) return next();
    if (closing) return jsonError(res, 503, '服务正在重启，请稍后重试');
    if (isHttps(req)) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    if (!isSameOriginMutation(req)) return jsonError(res, 403, '跨站请求已拒绝');
    if (req.url.startsWith('/apollo-api/auth/')) {
      const authRoute = req.url.split('?', 1)[0];
      if (req.method === 'POST' && (authRoute === '/apollo-api/auth/login' || authRoute === '/apollo-api/auth/register')) {
        const retryAfter = consumeFixedWindow(authRateLimits, `ip:${clientAddress(req, trustedProxies)}`, AUTH_IP_RATE_LIMIT, AUTH_RATE_WINDOW_MS);
        if (retryAfter) {
          res.setHeader('Retry-After', String(retryAfter));
          return jsonError(res, 429, '登录尝试过于频繁，请稍后重试');
        }
      }
      return handleAuth(req, res, database, workspaceRoot, registrationInvite, adminUsername, authRateLimits);
    }
    const user = authenticatedUser(req, database);
    if (!user) return jsonError(res, 401, '请先登录');
    const context = await getUserContext(user);
    const userWorkspaceRoot = context.workspaceRoot;
    const userArtifactRoot = path.join(userWorkspaceRoot, 'artifacts');

    if (req.url === '/apollo-api/respond') return handleResponse(req, res, user.id, interactions);
    if (req.url.startsWith('/apollo-api/browser-view')) return handleManagedBrowserView(req, res, user.id);
    if (req.url === '/apollo-api/sites' && req.method === 'GET') {
      return json(res, 200, { available: Boolean(sitesBaseUrl), sites: await listPublishedSites(publicSitesRoot, user.id) });
    }
    if (req.url === '/apollo-api/sites/publish' && req.method === 'POST') {
      if (!sitesBaseUrl) return jsonError(res, 503, '站点发布尚未配置');
      try {
        const body = JSON.parse(await readBody(req)) as { sourceDir?: unknown; name?: unknown; slug?: unknown };
        if (typeof body.sourceDir !== 'string' || typeof body.name !== 'string') throw new Error('站点参数无效');
        const site = await publishSite({ workspaceRoot: userWorkspaceRoot, publicRoot: publicSitesRoot, baseUrl: sitesBaseUrl, ownerId: user.id, sourceDir: body.sourceDir, name: body.name, slug: typeof body.slug === 'string' ? body.slug : undefined });
        return json(res, 200, { site });
      } catch (error) {
        return jsonError(res, 400, error instanceof Error ? error.message : String(error));
      }
    }
    if (req.url.startsWith('/apollo-api/sites/') && req.method === 'DELETE') {
      try {
        await deletePublishedSite(publicSitesRoot, user.id, decodeURIComponent(req.url.slice('/apollo-api/sites/'.length).split('?', 1)[0]!));
        return json(res, 200, { ok: true });
      } catch (error) {
        return jsonError(res, 404, error instanceof Error ? error.message : String(error));
      }
    }
    if (req.url === '/apollo-api/uploads' || req.url === '/apollo-api/artifacts/import') {
      const expectedBytes = req.url === '/apollo-api/uploads' ? MAX_UPLOAD_REQUEST_BYTES : 40 * 1024 * 1024;
      if (!hasDiskCapacity(workspaceRoot, minFreeDiskBytes + expectedBytes)) return jsonError(res, 507, '服务器存储空间不足，请联系管理员清理后重试');
      const userTransfers = fileTransfersByUser.get(user.id) ?? 0;
      if (activeFileTransfers >= MAX_CONCURRENT_FILE_TRANSFERS || userTransfers >= 1) {
        res.setHeader('Retry-After', '3');
        return jsonError(res, 429, '文件正在处理中，请稍后重试');
      }
      activeFileTransfers += 1;
      fileTransfersByUser.set(user.id, userTransfers + 1);
      try {
        return req.url === '/apollo-api/uploads'
          ? await handleUploads(req, res, userWorkspaceRoot, userStorageQuotaBytes)
          : await importArtifacts(req, res, userArtifactRoot, userStorageQuotaBytes);
      } finally {
        activeFileTransfers -= 1;
        const remaining = (fileTransfersByUser.get(user.id) ?? 1) - 1;
        if (remaining > 0) fileTransfersByUser.set(user.id, remaining);
        else fileTransfersByUser.delete(user.id);
      }
    }
    if (req.url === '/apollo-api/memories' && req.method === 'GET') {
      return json(res, 200, { memories: await listMemories(userWorkspaceRoot) });
    }
    if (req.url === '/apollo-api/memories' && req.method === 'PUT') {
      try {
        const body = JSON.parse(await readBody(req)) as { id?: unknown; title?: unknown; content?: unknown; tags?: unknown };
        if (body.id !== undefined && typeof body.id !== 'string') throw new Error('id 无效');
        if (typeof body.title !== 'string' || typeof body.content !== 'string') throw new Error('标题和内容必填');
        const tags = Array.isArray(body.tags) ? body.tags.filter((tag): tag is string => typeof tag === 'string') : [];
        return json(res, 200, { memory: await saveMemory(userWorkspaceRoot, { id: body.id, title: body.title, content: body.content, tags }) });
      } catch (error) {
        return jsonError(res, 400, error instanceof Error ? error.message : String(error));
      }
    }
    if (req.url.startsWith('/apollo-api/memories/') && req.method === 'DELETE') {
      const id = decodeURIComponent(req.url.slice('/apollo-api/memories/'.length));
      if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id)) return jsonError(res, 400, '记忆 id 无效');
      await fs.rm(path.join(userWorkspaceRoot, '.apollo', 'memory', `${id}.json`), { force: true });
      return json(res, 200, { ok: true });
    }
    if (req.url === '/apollo-api/conversations' && req.method === 'GET') {
      return json(res, 200, { conversations: listConversations(database, user.id) });
    }
    if (req.url.startsWith('/apollo-api/conversations/')) {
      const conversationId = decodeURIComponent(req.url.slice('/apollo-api/conversations/'.length).split('?', 1)[0]!);
      if (req.method === 'DELETE' && runs.has(agentRunKey(user.id, 'entry', conversationId))) return jsonError(res, 409, '请先停止正在运行的对话');
      await handleConversation(req, res, database, user.id);
      if (req.method === 'DELETE' && /^chat-[A-Za-z0-9-]{1,80}$/.test(conversationId)) {
        const runtime = context.entryEngines.get(conversationId);
        context.entryEngines.delete(conversationId);
        context.entryTurnStates.delete(conversationId);
        if (runtime) await runtime.then((engine) => engine.close()).catch(() => undefined);
        const sessionPath = entrySessionPath(userWorkspaceRoot, conversationId);
        const sessionId = await fs.readFile(sessionPath, 'utf8').then((value) => value.trim()).catch(() => '');
        await Promise.all([
          fs.rm(sessionPath, { force: true }),
          fs.rm(path.join(userWorkspaceRoot, '.apollo', 'entry-langhub-topics', `${conversationId}.json`), { force: true }),
          sessionId ? fs.rm(path.join(userWorkspaceRoot, '.apollo', 'sessions', `${sessionId}.json`), { force: true }) : Promise.resolve(),
        ]);
      }
      return;
    }
    if (req.url === '/apollo-api/artifacts' && req.method === 'GET') {
      const filesystemArtifacts = await listStoredArtifacts(userArtifactRoot);
      const conversationArtifacts = listConversationArtifacts(database, user.id);
      const artifacts = [...filesystemArtifacts, ...conversationArtifacts]
        .filter((artifact, index, items) => items.findIndex((item) => (item.url ?? item.id) === (artifact.url ?? artifact.id)) === index)
        .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
      return json(res, 200, { artifacts });
    }
    if (req.url.startsWith('/apollo-api/artifact?') && (req.method === 'GET' || req.method === 'PUT')) {
      return handleStoredArtifact(req, res, userArtifactRoot);
    }
    if (req.url === '/apollo-api/title') {
      if (req.method !== 'POST') return jsonError(res, 405, 'Method not allowed');
      try {
        const { text } = JSON.parse(await readBody(req)) as { text?: unknown };
        if (typeof text !== 'string' || !text.trim()) throw new Error('text 不能为空');
        const userAuxiliaryJobs = auxiliaryJobsByUser.get(user.id) ?? 0;
        const capacity = capacityReason(runs.values(), user.id, globalRunLimit, perUserRunLimit, auxiliaryJobs, userAuxiliaryJobs);
        if (capacity) {
          res.setHeader('Retry-After', '3');
          return jsonError(res, 429, capacity === 'user' ? '当前账号并发任务过多，请稍后重试' : '服务繁忙，请稍后重试');
        }
        auxiliaryJobs += 1;
        auxiliaryJobsByUser.set(user.id, userAuxiliaryJobs + 1);
        let titleEngine: QueryEngine | undefined;
        try {
          titleEngine = await createQueryEngine({
            configPath: entryConfigPath,
            configMode: 'isolated',
            workspaceRoot: userWorkspaceRoot,
            envPath,
            stream: false,
            memoryEnabled: false,
            approvalProvider: async () => false,
          });
          const title = await titleEngine.submitMessage(`为下面的用户请求生成一个简洁中文对话标题。只输出标题，不要解释、引号、句号或 Markdown，长度 6 到 16 个汉字。\n\n用户请求：${text.trim().slice(0, 2000)}`);
          return json(res, 200, { title: cleanTitle(title) });
        } finally {
          auxiliaryJobs -= 1;
          const remaining = (auxiliaryJobsByUser.get(user.id) ?? 1) - 1;
          if (remaining > 0) auxiliaryJobsByUser.set(user.id, remaining);
          else auxiliaryJobsByUser.delete(user.id);
          if (titleEngine) {
            const sessionId = titleEngine.getSessionId();
            await titleEngine.close();
            if (sessionId) await fs.rm(path.join(userWorkspaceRoot, '.apollo', 'sessions', `${sessionId}.json`), { force: true });
          }
        }
      } catch (error) {
        return jsonError(res, 400, error instanceof Error ? error.message : String(error));
      }
    }
    if (req.url.startsWith('/apollo-api/permission')) {
      const requestedChannel = new URL(req.url, 'http://localhost').searchParams.get('channel') === 'entry' ? 'entry' : 'assistant';
      const permissionConfigPath = requestedChannel === 'entry' ? entryConfigPath : context.assistantConfigPath;
      if (req.method === 'GET') return json(res, 200, { mode: allowUnrestricted ? await permissionMode(permissionConfigPath) : 'ask' });
      if (req.method !== 'POST') return jsonError(res, 405, 'Method not allowed');
      try {
        const { mode, channel } = JSON.parse(await readBody(req)) as { mode?: unknown; channel?: unknown };
        if (mode !== 'ask' && mode !== 'unrestricted') throw new Error('无效的权限模式');
        if (channel !== 'entry' && channel !== 'assistant') throw new Error('无效的智能体通道');
        if (channel === 'entry' && !user.admin) throw new Error('只有管理员可以修改统一入口权限');
        const busy = [...runs.values()].some((run) => channel === 'entry'
          ? run.channel === 'entry'
          : run.channel === 'assistant' && run.userId === user.id);
        if (busy) return jsonError(res, 409, '相关智能体正在运行，请稍后切换模式');
        const targetConfigPath = channel === 'entry' ? entryConfigPath : context.assistantConfigPath;
        if (mode === 'unrestricted' && !allowUnrestricted) throw new Error('当前部署未启用全自动权限；请先使用沙箱并设置 WEB_ALLOW_UNRESTRICTED=true');
        const config = await readConfig(targetConfigPath);
        config.permissions = {
          ...(typeof config.permissions === 'object' && config.permissions ? config.permissions : {}),
          mode,
          autoApproveReadOnly: true,
        };
        await writeConfig(targetConfigPath, config);
        if (channel === 'entry') await Promise.all([...userContexts.values()].map(closeEntryEngines));
        else await closeAssistantEngine(context);
        return json(res, 200, { mode });
      } catch (error) {
        return jsonError(res, 400, error instanceof Error ? error.message : String(error));
      }
    }
    if (req.url === '/apollo-api/config') {
      if (!user.admin) return jsonError(res, 403, '只有管理员可以管理智能体运行配置');
      if (req.method === 'GET') {
        const config = await fs.readFile(context.assistantConfigPath, 'utf8').catch(() => '{}');
        return json(res, 200, { path: '当前用户/.apollo/assistant-config.json', config });
      }
      if (req.method !== 'POST') return jsonError(res, 405, 'Method not allowed');
      if ([...runs.values()].some((run) => run.channel === 'assistant' && run.userId === user.id)) {
        return jsonError(res, 409, '当前助理正在运行，请稍后再保存配置');
      }
      try {
        const { config } = JSON.parse(await readBody(req)) as { config?: unknown };
        if (typeof config !== 'string') throw new Error('config 必须是 JSON 文本');
        const parsed = JSON.parse(config) as unknown;
        if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error('配置必须是 JSON 对象');
        const permissions = (parsed as { permissions?: { mode?: unknown } }).permissions;
        if (permissions?.mode === 'unrestricted' && !allowUnrestricted) throw new Error('当前部署禁止保存 unrestricted 权限');
        await writeConfig(context.assistantConfigPath, parsed as Record<string, unknown>);
        await closeAssistantEngine(context);
        return json(res, 200, { ok: true });
      } catch (error) {
        return jsonError(res, 400, error instanceof Error ? error.message : String(error));
      }
    }
    if (req.url === '/apollo-api/status' && req.method === 'GET') {
      try {
        return json(res, 200, runtimeStatus(await getEngine(context, 'assistant')));
      } catch (error) {
        return jsonError(res, 500, error instanceof Error ? error.message : String(error));
      }
    }
    if (req.url !== '/apollo-api/chat') return next();
    if (req.method !== 'POST') return jsonError(res, 405, 'Method not allowed');

    let message: unknown;
    let channel: 'assistant' | 'entry' = 'entry';
    let conversationId = '';
    try {
      const body = JSON.parse(await readBody(req)) as { message?: unknown; channel?: unknown; conversationId?: unknown };
      message = body.message;
      if (body.channel === 'assistant') channel = 'assistant';
      else if (body.channel !== undefined && body.channel !== 'entry') throw new Error('channel 无效');
      if (typeof message !== 'string' || !message.trim()) throw new Error('message 不能为空');
      if (channel === 'entry') {
        if (typeof body.conversationId !== 'string' || !/^(?:chat|document)-[A-Za-z0-9-]{1,80}$/.test(body.conversationId)) throw new Error('conversationId 无效');
        conversationId = body.conversationId;
      }
    } catch (error) {
      return jsonError(res, 400, error instanceof Error ? error.message : String(error));
    }

    const runKey = agentRunKey(user.id, channel, conversationId);
    if (runs.has(runKey)) return jsonError(res, 409, '当前对话正在处理上一条消息');
    const capacity = capacityReason(runs.values(), user.id, globalRunLimit, perUserRunLimit, auxiliaryJobs, auxiliaryJobsByUser.get(user.id) ?? 0);
    if (capacity) {
      res.setHeader('Retry-After', '3');
      return jsonError(res, 429, capacity === 'user' ? '当前账号并发任务过多，请稍后重试' : '服务繁忙，请稍后重试');
    }

    console.info(`[Apollo] 开始调用：Apollo Agent｜通道：${channel === 'assistant' ? '助理' : '统一入口'}｜输入：${logPreview(message as string)}`);

    const startedAt = Date.now();
    const runId = randomUUID();
    database.prepare(`
      INSERT INTO agent_runs (id, user_id, channel, conversation_id, status, started_at)
      VALUES (?, ?, ?, ?, 'running', ?)
    `).run(runId, user.id, channel, conversationId, new Date(startedAt).toISOString());
    const changedPaths = new Set<string>();
    const reportedArtifacts = new Map<string, NonNullable<Extract<TraceEvent, { type: 'tool_result' }>['artifacts']>[number]>();
    let closed = false;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'X-Apollo-Run-ID': runId,
    });
    res.flushHeaders();
    const send: Send = (event) => {
      if (!closed) res.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    const heartbeat = setInterval(() => {
      if (!closed) res.write(': heartbeat\n\n');
    }, 15_000);
    const sink = (event: TraceEvent) => {
      if (event.type === 'tool_result' && event.fileChange?.path) changedPaths.add(event.fileChange.path);
      if (event.type === 'tool_result') event.artifacts?.forEach((artifact) => reportedArtifacts.set(artifact.path, artifact));
      send({ type: 'trace', event: webTraceEvent(event) });
    };
    const configPath = channel === 'assistant' ? context.assistantConfigPath : entryConfigPath;
    const run: RunContext = {
      id: runId,
      userId: user.id,
      channel,
      send,
      sink,
      permissionMode: 'ask',
      interactionIds: new Set(),
    };
    runs.set(runKey, run);

    res.on('close', () => {
      closed = true;
      const run = runs.get(runKey);
      if (!res.writableEnded) run?.runtime?.cancelCurrentTurn();
      for (const id of run?.interactionIds ?? []) settleInteraction(id);
    });

    let runStatus: 'succeeded' | 'failed' | 'cancelled' = 'failed';
    let runError = '';
    try {
      if (allowUnrestricted) run.permissionMode = await permissionMode(configPath);
      if (channel === 'entry') {
        const turnState = context.entryTurnStates.get(conversationId) ?? {};
        turnState.standardsQuery = undefined;
        context.entryTurnStates.set(conversationId, turnState);
      }
      const runtime = await getEngine(context, channel, conversationId);
      runs.get(runKey)!.runtime = runtime;
      await runInput(runtime, message.trim(), send);
      if (channel === 'assistant' && runtime.getSessionId()) {
        await fs.mkdir(path.dirname(context.assistantSessionPath), { recursive: true });
        await fs.writeFile(context.assistantSessionPath, `${runtime.getSessionId()}\n`, 'utf8');
      }
      if (channel === 'entry' && runtime.getSessionId()) {
        const sessionPath = entrySessionPath(context.workspaceRoot, conversationId);
        await fs.mkdir(path.dirname(sessionPath), { recursive: true });
        await fs.writeFile(sessionPath, `${runtime.getSessionId()}\n`, 'utf8');
      }
      const artifactScope = channel === 'entry' ? path.join('artifacts', conversationId) : undefined;
      const artifacts = await collectArtifacts(context.workspaceRoot, startedAt, changedPaths, artifactScope, reportedArtifacts);
      console.info(`[Apollo] 调用完成：Apollo Agent｜耗时：${Date.now() - startedAt}ms｜产出文件：${artifacts.length}个`);
      send({ type: 'done', artifacts, status: runtimeStatus(runtime) });
      runStatus = 'succeeded';
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      runError = message.slice(0, 2_000);
      runStatus = closed ? 'cancelled' : 'failed';
      const artifactScope = channel === 'entry' ? path.join('artifacts', conversationId) : undefined;
      const artifacts = await collectArtifacts(context.workspaceRoot, startedAt, changedPaths, artifactScope, reportedArtifacts);
      console.error(`[Apollo] 调用失败：Apollo Agent｜错误：${logPreview(message)}｜已恢复文件：${artifacts.length}个`);
      const runtime = runs.get(runKey)?.runtime;
      if (runtime && artifacts.length) send({ type: 'done', artifacts, status: runtimeStatus(runtime) });
      else send({ type: 'error', message });
    } finally {
      clearInterval(heartbeat);
      const run = runs.get(runKey);
      for (const id of run?.interactionIds ?? []) settleInteraction(id);
      runs.delete(runKey);
      database.prepare('UPDATE agent_runs SET status = ?, finished_at = ?, error = ? WHERE id = ?')
        .run(runStatus, new Date().toISOString(), runError, runId);
      if (channel === 'entry') void pruneEntryEngines(context);
      if (!closed) res.end();
    }
  };

  const idleContextSweep = setInterval(() => {
    const now = Date.now();
    const activeUsers = new Set([...runs.values()].map((run) => run.userId));
    const contexts = [...userContexts.entries()].sort((left, right) => left[1].lastUsedAt - right[1].lastUsedAt);
    for (const [userId, context] of contexts) {
      if (activeUsers.has(userId)) continue;
      const expired = context.lastUsedAt < now - 30 * 60_000;
      const overLimit = userContexts.size > maxCachedRuntimeUsers && context.lastUsedAt < now - 60_000;
      if (!expired && !overLimit) continue;
      userContexts.delete(userId);
      void closeUserEngines(context);
    }
    pruneExpiredWindows(authRateLimits, now);
    for (const [userId, view] of managedBrowserViews) {
      if (view.updatedAt < now - 60 * 60_000) managedBrowserViews.delete(userId);
    }
    if (now - lastMaintenanceAt >= 60 * 60_000) {
      lastMaintenanceAt = now;
      database.prepare('DELETE FROM auth_sessions WHERE expires_at <= ?').run(new Date(now).toISOString());
      database.prepare('DELETE FROM agent_runs WHERE finished_at IS NOT NULL AND finished_at < ?').run(new Date(now - 90 * 24 * 60 * 60_000).toISOString());
      const retentionMs = Math.max(1, uploadRetentionDays) * 24 * 60 * 60_000;
      void cleanupExpiredUploads(path.join(workspaceRoot, '.apollo', 'users'), now - retentionMs);
    }
  }, 60_000);
  idleContextSweep.unref();

  const handle = (req: IncomingMessage, res: ServerResponse, next: () => void): void => {
    const requestId = randomUUID();
    res.setHeader('X-Request-ID', requestId);
    void handleRequest(req, res, next).catch((error) => {
      console.error(`[Apollo] 请求处理失败｜requestId=${requestId}：${error instanceof Error ? error.stack ?? error.message : String(error)}`);
      if (!res.headersSent) jsonError(res, 500, '服务暂时不可用，请稍后重试');
      else if (!res.writableEnded) res.end();
    });
  };

  return {
    handle,
    health: () => {
      let databaseReady = false;
      try {
        database.prepare('SELECT 1').get();
        databaseReady = true;
      } catch { /* reported below */ }
      const diskFreeBytes = freeDiskBytes(workspaceRoot);
      return {
        ready: !closing && databaseReady && diskFreeBytes >= minFreeDiskBytes,
        databaseReady,
        diskFreeBytes,
        minFreeDiskBytes,
        userStorageQuotaBytes,
        activeRuns: runs.size,
        activeJobs: runs.size + auxiliaryJobs,
        activeFileTransfers,
        runtimeUsers: userContexts.size,
        limits: { global: globalRunLimit, perUser: perUserRunLimit, fileTransfers: MAX_CONCURRENT_FILE_TRANSFERS },
      };
    },
    close: async () => {
      if (closing) return;
      closing = true;
      clearInterval(idleContextSweep);
      for (const run of runs.values()) run.runtime?.cancelCurrentTurn();
      for (const id of [...interactions.keys()]) settleInteraction(id);
      await Promise.all([...userContexts.values()].map(closeUserEngines));
      userContexts.clear();
      managedBrowserViews.clear();
      database.close();
    },
  };
}

function positiveInteger(value: number, fallback: number): number {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function formatBytes(value: number): string {
  if (value < 1024 * 1024) return `${Math.ceil(value / 1024)}KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)}MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(1)}GB`;
}

function freeDiskBytes(root: string): number {
  try {
    const stat = statfsSync(root);
    return Number(stat.bavail) * Number(stat.bsize);
  } catch {
    return 0;
  }
}

function hasDiskCapacity(root: string, requiredBytes: number): boolean {
  return freeDiskBytes(root) >= requiredBytes;
}

async function cleanupExpiredUploads(usersRoot: string, cutoff: number): Promise<void> {
  const users = await fs.readdir(usersRoot, { withFileTypes: true }).catch(() => []);
  await Promise.all(users.filter((entry) => entry.isDirectory()).map(async (entry) => {
    const uploads = path.join(usersRoot, entry.name, 'workspace', 'uploads');
    const files = await fs.readdir(uploads, { withFileTypes: true }).catch(() => []);
    await Promise.all(files.filter((file) => file.isFile()).map(async (file) => {
      const target = path.join(uploads, file.name);
      const stat = await fs.stat(target).catch(() => null);
      if (stat && stat.mtimeMs < cutoff) await fs.rm(target, { force: true });
    }));
  }));
}

async function workspaceUsageBytes(root: string): Promise<number> {
  const pending = [root];
  let total = 0;
  while (pending.length) {
    const current = pending.pop()!;
    const entries = await fs.readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(target);
      else if (entry.isFile()) total += (await fs.stat(target).catch(() => null))?.size ?? 0;
    }
  }
  return total;
}

async function assertWorkspaceCapacity(root: string, quotaBytes: number, incomingBytes: number): Promise<void> {
  if (!quotaBytes) return;
  const usedBytes = await workspaceUsageBytes(root);
  if (usedBytes + incomingBytes > quotaBytes) {
    throw new StorageQuotaError(`用户存储配额不足（已使用 ${formatBytes(usedBytes)}，上限 ${formatBytes(quotaBytes)}）`);
  }
}

async function handleUploads(req: IncomingMessage, res: ServerResponse, userWorkspaceRoot: string, quotaBytes: number): Promise<void> {
  if (req.method !== 'POST') return jsonError(res, 405, 'Method not allowed');
  try {
    const requestLimit = MAX_UPLOAD_REQUEST_BYTES;
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > requestLimit) throw new Error('上传内容过大');
    const body = await readBytes(req, requestLimit);
    const request = new Request('http://localhost/upload', {
      method: 'POST',
      headers: req.headers as HeadersInit,
      body: new Uint8Array(body).buffer,
    });
    const entries = (await request.formData()).getAll('files');
    if (!entries.length || entries.length > 8) throw new Error('每次请选择 1–8 个文件');
    const incomingBytes = entries.reduce((total, entry) => total + (typeof entry === 'string' ? 0 : entry.size), 0);
    await assertWorkspaceCapacity(userWorkspaceRoot, quotaBytes, incomingBytes);
    const directory = path.join(userWorkspaceRoot, 'uploads');
    await fs.mkdir(directory, { recursive: true });
    const files = [];
    for (const entry of entries) {
      if (typeof entry === 'string') throw new Error('无效的文件');
      const name = entry.name.replace(/[\\/\0]/g, '_').slice(-120) || 'file';
      const ext = path.extname(name).toLowerCase();
      if (!UPLOAD_EXTENSIONS.has(ext)) throw new Error(`不支持的文件类型：${ext || name}`);
      if (entry.size <= 0 || entry.size > MAX_UPLOAD_BYTES) throw new Error(`${name} 必须小于 20MB`);
      const storedName = `${randomUUID()}-${name}`;
      const relative = path.join('uploads', storedName);
      await fs.writeFile(path.join(userWorkspaceRoot, relative), Buffer.from(await entry.arrayBuffer()));
      files.push({ id: storedName, name, size: entry.size, type: entry.type, path: relative });
    }
    return json(res, 200, { files });
  } catch (error) {
    return jsonError(res, error instanceof StorageQuotaError ? 507 : 400, error instanceof Error ? error.message : String(error));
  }
}

async function importArtifacts(req: IncomingMessage, res: ServerResponse, root: string, quotaBytes: number): Promise<void> {
  if (req.method !== 'POST') return jsonError(res, 405, 'Method not allowed');
  try {
    const body = JSON.parse(await readBody(req, 40 * 1024 * 1024)) as { artifacts?: unknown };
    if (!Array.isArray(body.artifacts) || !body.artifacts.length || body.artifacts.length > 20) throw new Error('artifacts 无效');
    await fs.mkdir(root, { recursive: true });
    const artifacts: Artifact[] = [];
    for (const value of body.artifacts) {
      if (!value || typeof value !== 'object') continue;
      const artifact = value as Partial<Artifact>;
      if (!artifact.title || !isArtifactKind(artifact.kind)) continue;
      const expectedExt = artifact.kind === 'word' ? '.docx' : artifact.kind === 'pdf' ? '.pdf' : path.extname(artifact.title).toLowerCase();
      if (artifact.kind === 'image' && !ARTIFACT_EXTENSIONS.has(expectedExt)) throw new Error(`${artifact.title} 不是支持的图片格式`);
      const baseName = artifact.title.replace(/[\\/\0]/g, '_').slice(-160);
      const name = path.extname(baseName).toLowerCase() === expectedExt ? baseName : `${baseName}${expectedExt}`;
      let bytes: Buffer;
      if (artifact.kind === 'pdf' || artifact.kind === 'image') {
        const match = typeof artifact.url === 'string' ? artifact.url.match(/^data:[^;]+;base64,(.+)$/s) : null;
        if (!match) throw new Error(`${name} 缺少文件内容`);
        bytes = Buffer.from(match[1]!, 'base64');
      } else {
        if (typeof artifact.content !== 'string') throw new Error(`${name} 缺少 Word 内容`);
        bytes = Buffer.from(artifact.content, 'base64');
      }
      if (!bytes.length || bytes.length > MAX_ARTIFACT_BYTES) throw new Error(`${name} 文件为空或超过 25MB`);
      await assertWorkspaceCapacity(path.dirname(root), quotaBytes, bytes.length);
      const file = await availableArtifactPath(root, name);
      await fs.writeFile(file, bytes);
      console.info(`[Apollo] 文件已保存：LangHub → 用户文件库｜文件：${path.basename(file)}｜大小：${bytes.length}字节`);
      const relative = path.relative(root, file);
      artifacts.push({
        id: relative,
        title: path.basename(file),
        kind: artifact.kind,
        size: bytes.length,
        url: `/apollo-api/artifact?path=${encodeURIComponent(relative)}`,
        meta: { ...(artifact.meta ?? {}), path: relative, source: 'langhub' },
      });
    }
    return json(res, 200, { artifacts });
  } catch (error) {
    return jsonError(res, error instanceof StorageQuotaError ? 507 : 400, error instanceof Error ? error.message : String(error));
  }
}

async function availableArtifactPath(root: string, name: string): Promise<string> {
  const ext = path.extname(name);
  const stem = path.basename(name, ext);
  for (let index = 0; ; index += 1) {
    const file = path.join(root, index ? `${stem}-${index}${ext}` : name);
    try { await fs.access(file); } catch { return file; }
  }
}

async function ensureUserWorkspace(userRoot: string, sharedEntrySkillsPath: string, assistantConfigTemplatePath: string): Promise<void> {
  await fs.mkdir(path.join(userRoot, '.apollo'), { recursive: true });
  await fs.mkdir(path.join(userRoot, 'artifacts'), { recursive: true });
  await fs.mkdir(path.join(userRoot, 'assistant-skills'), { recursive: true });
  const entrySkillsLink = path.join(userRoot, 'entry-skills');
  const currentTarget = await fs.readlink(entrySkillsLink).catch(() => '');
  if (path.resolve(path.dirname(entrySkillsLink), currentTarget) !== path.resolve(sharedEntrySkillsPath)) {
    if (currentTarget) await fs.rm(entrySkillsLink, { force: true });
    await fs.symlink(sharedEntrySkillsPath, entrySkillsLink, 'dir').catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'EEXIST') throw error;
    });
  }
  const assistantConfigPath = path.join(userRoot, '.apollo', 'assistant-config.json');
  try { await fs.access(assistantConfigPath); } catch { await fs.copyFile(assistantConfigTemplatePath, assistantConfigPath); }
  const migrationMarker = path.join(userRoot, '.apollo', 'assistant-brand-v2');
  try { await fs.access(migrationMarker); } catch {
    const [current, template] = await Promise.all([readConfig(assistantConfigPath), readConfig(assistantConfigTemplatePath)]);
    await writeConfig(assistantConfigPath, { ...current, systemPrompt: template.systemPrompt });
    await fs.writeFile(migrationMarker, '2\n', 'utf8');
  }
}

async function enforceTenantSafeConfig(configPath: string): Promise<void> {
  const config = await readConfig(configPath);
  const skills = config.skills && typeof config.skills === 'object' && !Array.isArray(config.skills)
    ? config.skills as Record<string, unknown>
    : {};
  const directories = Array.isArray(skills.directories) ? skills.directories : [];
  const safeDirectories = directories.length === 1 && directories[0] === './assistant-skills';
  const hasMcpServers = config.mcpServers && typeof config.mcpServers === 'object'
    && Object.keys(config.mcpServers as Record<string, unknown>).length > 0;
  if (safeDirectories && !hasMcpServers) return;
  await writeConfig(configPath, {
    ...config,
    skills: { ...skills, directories: ['./assistant-skills'] },
    mcpServers: {},
  });
}

async function handleAuth(req: IncomingMessage, res: ServerResponse, database: DatabaseSync, workspaceRoot: string, registrationInvite: string, adminUsername: string, rateLimits: Map<string, RateLimitWindow>): Promise<void> {
  const route = req.url!.split('?', 1)[0];
  if (route === '/apollo-api/auth/me' && req.method === 'GET') {
    return json(res, 200, { user: authenticatedUser(req, database), hasUsers: Boolean(database.prepare('SELECT 1 FROM users LIMIT 1').get()), registrationEnabled: Boolean(registrationInvite) });
  }
  if (route === '/apollo-api/auth/logout' && req.method === 'POST') {
    const token = cookieValue(req, 'apollo_session');
    if (token) database.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').run(hashToken(token));
    setSessionCookie(req, res, '', 0);
    return json(res, 200, { ok: true });
  }
  if ((route !== '/apollo-api/auth/login' && route !== '/apollo-api/auth/register') || req.method !== 'POST') return jsonError(res, 405, 'Method not allowed');
  try {
    const body = JSON.parse(await readBody(req)) as { username?: unknown; password?: unknown; inviteCode?: unknown };
    if (typeof body.username !== 'string' || typeof body.password !== 'string') throw new Error('用户名和密码必填');
    const username = body.username.trim();
    if (!/^[\p{L}\p{N}_-]{2,32}$/u.test(username)) throw new Error('用户名需为 2–32 个字母、数字、中文、下划线或短横线');
    if (body.password.length < 8 || body.password.length > 128) throw new Error('密码长度需为 8–128 位');
    const retryAfter = consumeFixedWindow(rateLimits, `identity:${username.toLowerCase()}`, AUTH_IDENTITY_RATE_LIMIT, AUTH_RATE_WINDOW_MS);
    if (retryAfter) {
      res.setHeader('Retry-After', String(retryAfter));
      return jsonError(res, 429, '该账号登录尝试过于频繁，请稍后重试');
    }
    let user: AuthUser;
    if (route.endsWith('/register')) {
      if (!registrationInvite) return jsonError(res, 403, '当前部署已关闭注册');
      if (typeof body.inviteCode !== 'string' || !secureTextEqual(body.inviteCode, registrationInvite)) return jsonError(res, 403, '邀请码无效');
      const firstUser = !database.prepare('SELECT 1 FROM users LIMIT 1').get();
      if (firstUser && (!adminUsername || username.toLowerCase() !== adminUsername.toLowerCase())) return jsonError(res, 403, '首个账号必须使用 WEB_ADMIN_USERNAME 指定的管理员用户名');
      const admin = Boolean(adminUsername) && username.toLowerCase() === adminUsername.toLowerCase();
      const id = randomUUID();
      database.prepare('INSERT INTO users (id, username, password_hash, is_admin, created_at) VALUES (?, ?, ?, ?, ?)').run(id, username, await passwordHash(body.password), admin ? 1 : 0, new Date().toISOString());
      user = { id, username, admin };
      if (firstUser) {
        const rows = database.prepare("SELECT id FROM conversations WHERE instr(id, ':') = 0").all() as Array<{ id: string }>;
        const rename = database.prepare('UPDATE conversations SET id = ? WHERE id = ?');
        for (const row of rows) rename.run(`${id}:${row.id}`, row.id);
        const userRoot = path.join(workspaceRoot, '.apollo', 'users', id, 'workspace');
        await ensureUserWorkspace(userRoot, path.join(workspaceRoot, 'entry-skills'), path.join(workspaceRoot, 'config', 'web-assistant-apollo.json'));
        await fs.cp(path.join(workspaceRoot, '.apollo', 'memory'), path.join(userRoot, '.apollo', 'memory'), { recursive: true, force: false }).catch(() => undefined);
        await fs.cp(path.join(workspaceRoot, 'artifacts'), path.join(userRoot, 'artifacts'), { recursive: true, force: false }).catch(() => undefined);
      }
    } else {
      const row = database.prepare('SELECT id, username, password_hash AS "passwordHash" FROM users WHERE username = ?').get(username) as { id: string; username: string; passwordHash: string } | undefined;
      if (!row) {
        await derivePassword(body.password, Buffer.alloc(16), 64);
        throw new Error('用户名或密码错误');
      }
      if (!await verifyPassword(body.password, row.passwordHash)) throw new Error('用户名或密码错误');
      user = { id: row.id, username: row.username, admin: isAdmin(database, row.id) };
    }
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    database.prepare('DELETE FROM auth_sessions WHERE expires_at <= ?').run(new Date().toISOString());
    database.prepare('INSERT INTO auth_sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(hashToken(token), user.id, expiresAt.toISOString());
    setSessionCookie(req, res, token, 30 * 24 * 60 * 60);
    return json(res, 200, { user });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonError(res, message.includes('UNIQUE') ? 409 : 400, message.includes('UNIQUE') ? '用户名已存在' : message);
  }
}

function authenticatedUser(req: IncomingMessage, database: DatabaseSync): AuthUser | null {
  const token = cookieValue(req, 'apollo_session');
  if (!token) return null;
  const user = database.prepare(`SELECT users.id, users.username, users.is_admin AS "isAdmin" FROM auth_sessions JOIN users ON users.id = auth_sessions.user_id WHERE auth_sessions.token_hash = ? AND auth_sessions.expires_at > ?`).get(hashToken(token), new Date().toISOString()) as { id: string; username: string; isAdmin: number } | undefined;
  return user ? { id: user.id, username: user.username, admin: user.isAdmin === 1 } : null;
}

function isAdmin(database: DatabaseSync, userId: string): boolean {
  return (database.prepare('SELECT is_admin AS "isAdmin" FROM users WHERE id = ?').get(userId) as { isAdmin?: number } | undefined)?.isAdmin === 1;
}

function secureTextEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function cookieValue(req: IncomingMessage, name: string): string | undefined {
  return req.headers.cookie?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1);
}

function isHttps(req: IncomingMessage): boolean {
  return req.headers['x-forwarded-proto'] === 'https' || Boolean((req.socket as { encrypted?: boolean }).encrypted);
}

export function clientAddress(req: IncomingMessage, trustedProxies = new Set<string>()): string {
  const peer = normalizeAddress(req.socket.remoteAddress) || 'unknown';
  if (!trustedProxies.has(peer)) return peer;
  const real = req.headers['x-real-ip'];
  const trusted = Array.isArray(real) ? real[0] : real;
  if (trusted?.trim()) return normalizeAddress(trusted) || peer;
  const forwarded = req.headers['x-forwarded-for'];
  const chain = (Array.isArray(forwarded) ? forwarded.join(',') : forwarded || '').split(',').map(normalizeAddress).filter(Boolean);
  for (let index = chain.length - 1; index >= 0; index -= 1) {
    if (!trustedProxies.has(chain[index]!)) return chain[index]!;
  }
  return peer;
}

function normalizeAddress(value?: string): string {
  const address = value?.trim() || '';
  return address.startsWith('::ffff:') ? address.slice(7) : address;
}

export function isSameOriginMutation(req: IncomingMessage): boolean {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return true;
  const origin = req.headers.origin;
  if (!origin || !req.headers.host) return false;
  try {
    const expected = new URL(`${isHttps(req) ? 'https' : 'http'}://${req.headers.host}`).origin;
    return new URL(origin).origin === expected;
  } catch { return false; }
}

function setSessionCookie(req: IncomingMessage, res: ServerResponse, token: string, maxAge: number): void {
  const secure = isHttps(req);
  res.setHeader('Set-Cookie', `apollo_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`);
}

async function passwordHash(password: string): Promise<string> {
  const salt = randomBytes(16);
  return `${salt.toString('base64')}:${(await derivePassword(password, salt, 64)).toString('base64')}`;
}

async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [saltText, hashText] = encoded.split(':');
  if (!saltText || !hashText) return false;
  const expected = Buffer.from(hashText, 'base64');
  const actual = await derivePassword(password, Buffer.from(saltText, 'base64'), expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function derivePassword(password: string, salt: Buffer, length: number): Promise<Buffer> {
  return new Promise((resolve, reject) => scrypt(password, salt, length, (error, key) => error ? reject(error) : resolve(key)));
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
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
    );
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      is_admin INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS auth_sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS agent_runs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      channel TEXT NOT NULL,
      conversation_id TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      error TEXT NOT NULL DEFAULT '',
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS agent_runs_user_started ON agent_runs(user_id, started_at DESC);
  `);
  database.prepare(`
    UPDATE agent_runs
    SET status = 'interrupted', finished_at = ?, error = '服务重启导致任务中断，请重新提交'
    WHERE status = 'running'
  `).run(new Date().toISOString());
  migrateExplicitAdmin(database);
  migrateApolloSessions(database, path.join(path.dirname(databasePath), 'sessions'));
  return database;
}

function migrateExplicitAdmin(database: DatabaseSync): void {
  const columns = database.prepare('PRAGMA table_info(users)').all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === 'is_admin')) database.exec('ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0');
  if (database.prepare("SELECT value FROM app_meta WHERE key = 'explicit_admin_migrated'").get()) return;
  const existing = database.prepare('SELECT id FROM users ORDER BY created_at').all() as Array<{ id: string }>;
  if (existing.length === 1) database.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(existing[0]!.id);
  database.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('explicit_admin_migrated', ?)").run(new Date().toISOString());
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

function listConversations(database: DatabaseSync, userId: string) {
  const prefix = `${userId}:`;
  return database.prepare(`
    SELECT substr(id, ?) AS id, title, group_name AS "group", updated_at AS "updatedAt"
    FROM conversations WHERE id LIKE ? ORDER BY updated_at DESC
  `).all(prefix.length + 1, `${prefix}%`);
}

function listConversationArtifacts(database: DatabaseSync, userId: string) {
  const rows = database.prepare('SELECT id, messages_json AS messages, updated_at AS "updatedAt" FROM conversations WHERE id LIKE ?').all(`${userId}:%`) as Array<{ id: string; messages: string; updatedAt: string }>;
  return rows.flatMap((row) => {
    try {
      const messages = JSON.parse(row.messages) as Array<{ artifacts?: unknown }>;
      if (!Array.isArray(messages)) return [];
      return messages.flatMap((message) => {
        if (!Array.isArray(message?.artifacts)) return [];
        return message.artifacts.flatMap((value) => {
          if (!value || typeof value !== 'object') return [];
          const artifact = value as Partial<Artifact>;
          if (!artifact.id || !artifact.title || !isArtifactKind(artifact.kind)) return [];
          const content = typeof artifact.content === 'string' ? artifact.content : undefined;
          const url = typeof artifact.url === 'string' ? artifact.url : undefined;
          if (!content && !url) return [];
          return [{
            id: `conversation:${row.id}:${artifact.id}`,
            title: artifact.title,
            kind: artifact.kind,
            size: typeof artifact.size === 'number' ? artifact.size : content ? Buffer.byteLength(content) : 0,
            modifiedAt: row.updatedAt,
            ...(url ? { url } : {}),
            ...(content ? { content } : {}),
          }];
        });
      });
    } catch {
      return [];
    }
  });
}

function isArtifactKind(value: unknown): value is Artifact['kind'] {
  return value === 'word' || value === 'pdf' || value === 'image' || value === 'markdown' || value === 'json';
}

async function handleConversation(req: IncomingMessage, res: ServerResponse, database: DatabaseSync, userId: string): Promise<void> {
  const publicId = decodeURIComponent(req.url!.slice('/apollo-api/conversations/'.length).split('?', 1)[0]!);
  const id = `${userId}:${publicId}`;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(publicId)) return jsonError(res, 400, '无效的对话 id');
  if (req.method === 'GET') {
    const row = database.prepare(`
      SELECT id, title, group_name AS "group", messages_json AS "messages", updated_at AS "updatedAt"
      FROM conversations WHERE id = ?
    `).get(id) as { id: string; title: string; group: string; messages: string; updatedAt: string } | undefined;
    if (!row) return jsonError(res, 404, '对话不存在');
    return json(res, 200, { ...row, id: publicId, messages: JSON.parse(row.messages) });
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
    return json(res, 200, { id: publicId, title, group, updatedAt: now });
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
  const temporaryPath = `${configPath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    await fs.rename(temporaryPath, configPath);
  } finally {
    await fs.rm(temporaryPath, { force: true });
  }
}

async function permissionMode(configPath: string): Promise<'ask' | 'unrestricted'> {
  const config = await readConfig(configPath);
  const permissions = config.permissions as { mode?: unknown } | undefined;
  return permissions?.mode === 'unrestricted' ? 'unrestricted' : 'ask';
}

function entrySessionPath(workspaceRoot: string, conversationId: string): string {
  return path.join(workspaceRoot, '.apollo', 'entry-sessions', `${conversationId}.session`);
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
  userId: string,
  interactions: Map<string, PendingInteraction>,
): Promise<void> {
  if (req.method !== 'POST') return jsonError(res, 405, 'Method not allowed');
  try {
    const { id, answer } = JSON.parse(await readBody(req)) as { id?: unknown; answer?: unknown };
    if (typeof id !== 'string' || typeof answer !== 'string') throw new Error('id 和 answer 必填');
    const pending = interactions.get(id);
    if (!pending) return jsonError(res, 404, '交互请求已失效');
    if (pending.userId !== userId) return jsonError(res, 403, '无权响应此交互请求');
    interactions.delete(id);
    clearTimeout(pending.timer);
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


function logPreview(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 80);
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}\n… [truncated ${value.length - max} chars]`;
}

async function readBody(req: IncomingMessage, maxBytes = 1024 * 1024): Promise<string> {
  return (await readBytes(req, maxBytes)).toString('utf8');
}

async function readBytes(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += bytes.length;
    if (total > maxBytes) throw new Error('请求体过大');
    chunks.push(bytes);
  }
  return Buffer.concat(chunks, total);
}

function json(res: ServerResponse, status: number, body: object): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function jsonError(res: ServerResponse, status: number, message: string): void {
  json(res, status, { error: message });
}

async function collectArtifacts(
  root: string,
  startedAt: number,
  changedPaths: Set<string>,
  recentDirectory?: string,
  reported = new Map<string, { title?: string }>(),
): Promise<Artifact[]> {
  const candidates = new Set([...reported.keys(), ...changedPaths].map((file) => path.resolve(root, file)));
  if (!reported.size) await findRecentArtifacts(recentDirectory ? path.join(root, recentDirectory) : root, startedAt, candidates).catch(() => undefined);
  const artifacts = await Promise.all([...candidates].map(async (file) => {
    const artifact = await artifactFromFile(root, file);
    const metadata = reported.get(path.relative(root, file));
    return artifact && metadata?.title ? { ...artifact, title: path.basename(metadata.title) } : artifact;
  }));
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
  const safeFile = await confinedRealFile(root, file);
  if (!safeFile) return null;
  const stat = await fs.stat(safeFile).catch(() => null);
  if (!stat?.isFile() || stat.size > MAX_ARTIFACT_BYTES) return null;

  const storedRelative = path.relative(path.join(root, 'artifacts'), file);
  const url = !storedRelative.startsWith('..') && !path.isAbsolute(storedRelative)
    ? `/apollo-api/artifact?path=${encodeURIComponent(storedRelative)}`
    : undefined;
  const common = {
    id: relative,
    title: path.basename(file),
    size: stat.size,
    ...(url ? { url } : {}),
    meta: { path: relative },
  };
  if (ext === '.docx') return { ...common, kind: 'word' };
  if (ext === '.pdf') return { ...common, kind: 'pdf' };
  return { ...common, kind: 'image' };
}

async function listStoredArtifacts(root: string) {
  const files = new Set<string>();
  await findRecentArtifacts(root, 0, files).catch(() => undefined);
  const items = await Promise.all([...files].map(async (file) => {
    const safeFile = await confinedRealFile(root, file);
    if (!safeFile) return null;
    const stat = await fs.stat(safeFile);
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
  return items.filter((item): item is NonNullable<typeof item> => item !== null).sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
}

async function handleStoredArtifact(req: IncomingMessage, res: ServerResponse, root: string): Promise<void> {
  try {
    const relative = new URL(req.url!, 'http://localhost').searchParams.get('path');
    if (!relative) return jsonError(res, 400, 'path 必填');
    const file = path.resolve(root, relative);
    const safeRelative = path.relative(root, file);
    if (safeRelative.startsWith('..') || path.isAbsolute(safeRelative)) return jsonError(res, 403, '无权访问该文件');
    const ext = path.extname(file).toLowerCase();
    if (!ARTIFACT_EXTENSIONS.has(ext)) return jsonError(res, 400, '不支持的文件类型');
    const safeFile = await confinedRealFile(root, file);
    if (!safeFile) return jsonError(res, 403, '无权访问该文件');
    const stat = await fs.stat(safeFile);
    if (!stat.isFile() || stat.size > MAX_ARTIFACT_BYTES) return jsonError(res, 404, '文件不存在或过大');
    const current = await fs.readFile(safeFile);
    const currentTag = fileEtag(current);
    if (req.method === 'PUT') {
      const expected = req.headers['if-match'];
      if (typeof expected === 'string' && expected !== currentTag) {
        res.writeHead(412, { 'Content-Type': 'application/json; charset=utf-8', ETag: currentTag });
        res.end(JSON.stringify({ error: '文件已被其他位置修改' }));
        return;
      }
      const bytes = await readBytes(req, MAX_ARTIFACT_BYTES);
      if (!bytes.length) return jsonError(res, 400, '文件内容不能为空');
      if ((ext === '.json') && !isJson(bytes)) return jsonError(res, 400, 'JSON 格式无效');
      const temporary = path.join(path.dirname(safeFile), `.${path.basename(safeFile)}.${randomUUID()}.tmp`);
      try {
        await fs.writeFile(temporary, bytes);
        await fs.rename(temporary, safeFile);
      } finally {
        await fs.rm(temporary, { force: true }).catch(() => undefined);
      }
      const tag = fileEtag(bytes);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', ETag: tag });
      res.end(JSON.stringify({ ok: true, size: bytes.length, modifiedAt: new Date().toISOString() }));
      return;
    }
    res.writeHead(200, {
      'Content-Type': artifactMime(ext),
      'Content-Length': stat.size,
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(path.basename(file))}`,
      ETag: currentTag,
    });
    res.end(current);
  } catch {
    jsonError(res, 404, '文件不存在');
  }
}

async function confinedRealFile(root: string, file: string): Promise<string | null> {
  try {
    const [realRoot, realFile, fileStat] = await Promise.all([fs.realpath(root), fs.realpath(file), fs.lstat(file)]);
    if (fileStat.isSymbolicLink()) return null;
    const relative = path.relative(realRoot, realFile);
    return relative.startsWith('..') || path.isAbsolute(relative) ? null : realFile;
  } catch {
    return null;
  }
}

function artifactKind(ext: string): Artifact['kind'] {
  if (ext === '.docx') return 'word';
  if (ext === '.pdf') return 'pdf';
  if (ext === '.md' || ext === '.markdown') return 'markdown';
  if (ext === '.json') return 'json';
  return 'image';
}

function artifactMime(ext: string): string {
  if (ext === '.docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (ext === '.pdf') return 'application/pdf';
  if (ext === '.md' || ext === '.markdown') return 'text/markdown; charset=utf-8';
  if (ext === '.json') return 'application/json; charset=utf-8';
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  return 'image/jpeg';
}

function fileEtag(bytes: Uint8Array): string {
  return `"${createHash('sha256').update(bytes).digest('hex')}"`;
}

function isJson(bytes: Uint8Array): boolean {
  try {
    JSON.parse(Buffer.from(bytes).toString('utf8'));
    return true;
  } catch {
    return false;
  }
}

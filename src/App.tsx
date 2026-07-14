import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatMessage, RuntimeStatus } from '@/types';
import { extractArtifacts } from '@/lib/agent';
import {
  getApolloPermission,
  getStoredArtifacts,
  getApolloStatus,
  respondApollo,
  saveApolloPermission,
  streamApollo,
  summarizeConversationTitle,
  uploadInputFiles,
  type ApolloPermissionMode,
  type StoredArtifact,
} from '@/lib/apolloAgent';
import { applyApolloEvent } from '@/lib/apolloTimeline';
import {
  deleteConversation,
  getConversation,
  getConversationIfExists,
  listConversations,
  newConversationId,
  saveConversation,
  updateConversation,
  ASSISTANT_CONVERSATION_ID,
  ASSISTANT_CONVERSATION_TITLE,
  type ConversationSummary,
} from '@/lib/chatHistory';
import ChatPanel from '@/components/ChatPanel';
import AppSidebar from '@/components/AppSidebar';
import FileLibrary from '@/components/FileLibrary';
import SettingsBar from '@/components/SettingsBar';
import RuntimeStatusBar from '@/components/RuntimeStatusBar';
import { MenuIcon } from '@/components/Icons';
import LoginScreen from '@/components/LoginScreen';
import { getCurrentUser, logout, type AuthUser } from '@/lib/auth';
import DocumentWorkspace, { type DocumentWorkspaceHandle } from '@/components/DocumentWorkspace';
import { openArtifact, openLibraryFile, type LibraryFile, type OpenDocument } from '@/lib/documentFiles';
import { chooseLocalFolder, ensureFolderPermission, listLocalFiles, restoreLocalFolder, type DirectoryHandle } from '@/lib/localFolder';

let idSeq = 0;
const nextId = (p: string) => `${p}-${Date.now()}-${idSeq++}`;
const documentConversationId = (value: string) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  return `document-${(hash >>> 0).toString(36)}`;
};

export default function App() {
  const [auth, setAuth] = useState<{ loading: boolean; user: AuthUser | null; hasUsers: boolean; registrationEnabled: boolean }>({ loading: true, user: null, hasUsers: false, registrationEnabled: false });
  useEffect(() => { getCurrentUser().then(({ user, hasUsers, registrationEnabled }) => setAuth({ loading: false, user, hasUsers, registrationEnabled })).catch(() => setAuth({ loading: false, user: null, hasUsers: false, registrationEnabled: false })); }, []);
  if (auth.loading) return <div className="flex min-h-dvh items-center justify-center text-[12px] text-[#888]">正在加载…</div>;
  if (!auth.user) return <LoginScreen hasUsers={auth.hasUsers} registrationEnabled={auth.registrationEnabled} onAuthenticated={(user) => setAuth({ ...auth, loading: false, user, hasUsers: true })} />;
  return <WorkspaceApp user={auth.user} onLogout={async () => { await logout(); setAuth({ ...auth, loading: false, user: null, hasUsers: true }); }} />;
}

function WorkspaceApp({ user, onLogout }: { user: AuthUser; onLogout: () => void }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [runningConversationIds, setRunningConversationIds] = useState<Set<string>>(() => new Set());
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus | null>(null);
  const [permissionMode, setPermissionMode] = useState<ApolloPermissionMode>('ask');
  const [entryPermissionMode, setEntryPermissionMode] = useState<ApolloPermissionMode>('ask');
  const [conversationId, setConversationId] = useState(ASSISTANT_CONVERSATION_ID);
  const [conversationTitle, setConversationTitle] = useState(ASSISTANT_CONVERSATION_TITLE);
  const [conversationGroup, setConversationGroup] = useState<'最近' | '已归档'>('最近');
  const [conversationList, setConversationList] = useState<ConversationSummary[]>([]);
  const [historyReady, setHistoryReady] = useState(false);
  const [activeView, setActiveView] = useState<'assistant' | 'chat' | 'library' | 'document'>('assistant');
  const [storedArtifacts, setStoredArtifacts] = useState<StoredArtifact[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [localFolder, setLocalFolder] = useState<DirectoryHandle | null>(null);
  const [localFiles, setLocalFiles] = useState<LibraryFile[]>([]);
  const [librarySource, setLibrarySource] = useState<'server' | 'local'>('server');
  const [activeDocument, setActiveDocument] = useState<OpenDocument | null>(null);
  const [documentApolloOpen, setDocumentApolloOpen] = useState(false);
  const documentOriginViewRef = useRef<'assistant' | 'chat' | 'library'>('library');
  const documentChannelRef = useRef<'assistant' | 'entry'>('entry');
  const documentPreviousConversationRef = useRef<{
    id: string;
    title: string;
    group: '最近' | '已归档';
    messages: ChatMessage[];
  } | null>(null);
  const documentWorkspaceRef = useRef<DocumentWorkspaceHandle>(null);
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth >= 1024);
  const abortRefs = useRef(new Map<string, AbortController>());
  const messageCache = useRef(new Map<string, ChatMessage[]>());
  const activeConversationIdRef = useRef(conversationId);
  const skipNextAutoSaveRef = useRef(false);
  const titleGeneratedRef = useRef(false);
  const streaming = runningConversationIds.has(conversationId);

  useEffect(() => {
    void restoreLocalFolder().then(async (folder) => {
      if (!folder) return;
      setLocalFolder(folder);
      setLocalFiles(await listLocalFiles(folder));
      setLibrarySource('local');
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    activeConversationIdRef.current = conversationId;
    messageCache.current.set(conversationId, messages);
  }, [conversationId, messages]);

  const updateRunMessages = useCallback((id: string, update: (current: ChatMessage[]) => ChatMessage[]) => {
    const next = update(messageCache.current.get(id) ?? []);
    messageCache.current.set(id, next);
    if (activeConversationIdRef.current === id) setMessages(next);
    return next;
  }, []);

  const finishRun = useCallback((id: string) => {
    abortRefs.current.delete(id);
    setRunningConversationIds((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
  }, []);

  useEffect(() => {
    const channel = activeView === 'assistant' || (activeView === 'document' && documentChannelRef.current === 'assistant') ? 'assistant' : 'entry';
    getApolloPermission(channel)
      .then(channel === 'assistant' ? setPermissionMode : setEntryPermissionMode)
      .catch(() => channel === 'assistant' ? setPermissionMode('ask') : setEntryPermissionMode('ask'));
    if (channel === 'assistant') getApolloStatus().then(setRuntimeStatus).catch(() => setRuntimeStatus(null));
  }, [activeView]);

  const rememberConversation = useCallback((conversation: ConversationSummary) => {
    if (conversation.id === ASSISTANT_CONVERSATION_ID) return;
    setConversationList((current) => [conversation, ...current.filter((item) => item.id !== conversation.id)]);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void listConversations()
      .then(async (items) => {
        if (cancelled) return;
        setConversationList(items.filter((item) => item.id !== ASSISTANT_CONVERSATION_ID));
        const conversation = await getConversationIfExists(ASSISTANT_CONVERSATION_ID);
        if (cancelled) return;
        setConversationId(ASSISTANT_CONVERSATION_ID);
        setConversationTitle(ASSISTANT_CONVERSATION_TITLE);
        setConversationGroup('最近');
        setMessages(conversation?.messages ?? []);
        titleGeneratedRef.current = true;
      })
      .catch((error) => window.alert(error instanceof Error ? error.message : String(error)))
      .finally(() => !cancelled && setHistoryReady(true));
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!historyReady) return;
    if (skipNextAutoSaveRef.current) {
      skipNextAutoSaveRef.current = false;
      return;
    }
    if (!messages.length) return;
    const timer = window.setTimeout(() => {
      void saveConversation({ id: conversationId, title: conversationTitle, group: conversationGroup, messages })
        .then(rememberConversation)
        .catch((error) => window.alert(error instanceof Error ? error.message : String(error)));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [conversationGroup, conversationId, conversationTitle, historyReady, messages, rememberConversation]);

  const handleRespond = useCallback(async (messageId: string, stepId: string, answer: string) => {
    await respondApollo(stepId, answer);
    setMessages((prev) =>
      prev.map((message) =>
        message.id === messageId
          ? {
              ...message,
              steps: (message.steps ?? []).map((step) =>
                step.id === stepId
                  ? {
                      ...step,
                      pending: false,
                      answer: answer === 'approve' ? '已批准' : answer === 'deny' ? '已拒绝' : answer,
                    }
                  : step,
              ),
            }
          : message,
      ),
    );
  }, []);

  const handleSend = useCallback(
    async (text: string, inputFiles: File[] = []) => {
      const assistantSurface = activeView === 'assistant' || (activeView === 'document' && documentChannelRef.current === 'assistant');
      const targetConversationId = conversationId;
      if (abortRefs.current.has(targetConversationId)) return;
      const generateTitle = !assistantSurface && !titleGeneratedRef.current;
      if (generateTitle) titleGeneratedRef.current = true;
      const userMsg: ChatMessage = { id: nextId('u'), role: 'user', content: text };
      const assistantId = nextId('a');
      const thoughtId = nextId('th');
      const thoughtStart = Date.now();
      const assistantMsg: ChatMessage = {
        id: assistantId,
        role: 'assistant',
        content: '',
        streaming: true,
        // 所有后端：先放一个可折叠 Thought（默认折叠）
        steps: [
          {
            id: thoughtId,
            kind: 'thought',
            title: 'Thought',
            pending: true,
          },
        ],
      };
      const initialMessages = updateRunMessages(targetConversationId, (current) => [...current, userMsg, assistantMsg]);
      const initialSave = saveConversation({ id: targetConversationId, title: conversationTitle, group: conversationGroup, messages: initialMessages })
        .then(rememberConversation)
        .catch(() => undefined);
      if (generateTitle) {
        void initialSave.then(() => summarizeConversationTitle(text))
          .catch(() => text.slice(0, 18))
          .then((title) => {
            setConversationList((items) => items.map((item) => item.id === targetConversationId ? { ...item, title } : item));
            if (activeConversationIdRef.current === targetConversationId) setConversationTitle(title);
            void updateConversation(targetConversationId, { title }).catch(() => undefined);
          });
      }

      const controller = new AbortController();
      abortRefs.current.set(targetConversationId, controller);
      setRunningConversationIds((current) => new Set(current).add(targetConversationId));

      let raw = '';
      const onDelta = (chunk: string) => {
        raw += chunk;
        const { cleanText } = extractArtifacts(raw);
        updateRunMessages(targetConversationId, (prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, content: cleanText } : m)),
        );
      };

      const finishThought = (detail?: string) => {
        const durationSec = (Date.now() - thoughtStart) / 1000;
        updateRunMessages(targetConversationId, (prev) =>
          prev.map((m) => {
            if (m.id !== assistantId) return m;
            const sourceSteps = m.steps ?? [];
            let pendingThought = -1;
            for (let index = sourceSteps.length - 1; index >= 0; index -= 1) {
              if (sourceSteps[index]?.kind === 'thought' && sourceSteps[index]?.pending) {
                pendingThought = index;
                break;
              }
            }
            const steps = sourceSteps.map((s, index) =>
              index === pendingThought
                ? {
                    ...s,
                    pending: false,
                    durationSec: s.startedAtMs ? (Date.now() - s.startedAtMs) / 1000 : durationSec,
                    startedAtMs: undefined,
                    detail: s.detail ?? detail,
                    tone: detail?.startsWith('出错') ? 'error' as const : 'success' as const,
                  }
                : s,
            );
            return { ...m, steps };
          }),
        );
      };

      try {
        const attachments = await uploadInputFiles(inputFiles);
        if (attachments.length) {
          updateRunMessages(targetConversationId, (current) => current.map((message) => message.id === userMsg.id ? { ...message, attachments } : message));
        }
        let executionText = attachments.length
          ? `${text}\n\n已上传文件：\n${attachments.map((file) => `- ${file.path}`).join('\n')}`
          : text;
        if (activeDocument) {
          executionText += `\n\n当前 Web 编辑工作台已打开文档：${activeDocument.name}（${activeDocument.kind}，${activeDocument.source}）。如果用户要求读取或修改“当前文档”，请使用 document_get_context、document_replace_text、document_append_text 或 document_set_content 工具，不要使用服务器文件工具绕过当前编辑器。`;
        }
        const artifacts = await streamApollo(
          executionText,
          (event) => {
            if (event.type === 'trace' && event.event.type === 'assistant_delta') onDelta(event.event.text);
            if (event.type === 'editor_request') {
              void (async () => {
                const result = documentWorkspaceRef.current
                  ? await documentWorkspaceRef.current.execute(event.action, event.input)
                  : { ok: false, error: '当前页面没有打开可编辑文档' };
                await respondApollo(event.id, JSON.stringify(result));
              })().catch((error) => respondApollo(event.id, JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })));
            }
            if (assistantSurface && (event.type === 'status' || event.type === 'done')) setRuntimeStatus(event.status);
            if (event.type === 'trace' || event.type === 'interaction') {
              updateRunMessages(targetConversationId, (prev) =>
                prev.map((message) =>
                  message.id === assistantId
                    ? { ...message, steps: applyApolloEvent(message.steps ?? [], event) }
                    : message,
                ),
              );
            }
          },
          controller.signal,
          assistantSurface ? 'assistant' : 'entry',
          assistantSurface ? undefined : targetConversationId,
        );
        finishThought();
        const { cleanText } = extractArtifacts(raw);
        updateRunMessages(targetConversationId, (prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  content: cleanText || (artifacts.length ? '已生成成果文件。' : ''),
                  artifacts,
                  streaming: false,
                  steps: (m.steps ?? []).map((step) =>
                    step.pending && step.kind !== 'approval' && step.kind !== 'question'
                      ? { ...step, pending: false }
                      : step,
                  ),
                }
              : m,
          ),
        );
      } catch (e) {
        const msg = controller.signal.aborted ? '已中断。' : e instanceof Error ? e.message : String(e);
        console.error(`[Apollo Web] 调用失败：${msg}`);
        finishThought(`出错：${msg}`);
        updateRunMessages(targetConversationId, (prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  content: controller.signal.aborted ? msg : `请求出错：${msg}`,
                  streaming: false,
                  steps: (m.steps ?? []).map((s) => ({ ...s, pending: false })),
                }
              : m,
          ),
        );
      } finally {
        finishRun(targetConversationId);
        await initialSave;
        const current = await getConversationIfExists(targetConversationId).catch(() => null);
        if (current) {
          await saveConversation({ ...current, messages: messageCache.current.get(targetConversationId) ?? current.messages })
            .then(rememberConversation)
            .catch(() => undefined);
        }
      }
    },
    [activeDocument, activeView, conversationGroup, conversationId, conversationTitle, finishRun, rememberConversation, updateRunMessages],
  );

  const handleStop = useCallback(() => {
    abortRefs.current.get(conversationId)?.abort();
  }, [conversationId]);

  const handleNewChat = useCallback(() => {
    if (messages.length || conversationTitle) {
      void saveConversation({ id: conversationId, title: conversationTitle, group: conversationGroup, messages })
        .then(rememberConversation)
        .catch(() => undefined);
    }
    const id = newConversationId();
    activeConversationIdRef.current = id;
    messageCache.current.set(id, []);
    setConversationId(id);
    setMessages([]);
    setConversationTitle('');
    setConversationGroup('最近');
    titleGeneratedRef.current = false;
    setActiveView('chat');
  }, [conversationGroup, conversationId, conversationTitle, messages, rememberConversation]);

  const openAssistant = useCallback(async () => {
    if (activeView === 'assistant') return;
    setHistoryReady(false);
    try {
      const conversation = await getConversationIfExists(ASSISTANT_CONVERSATION_ID);
      skipNextAutoSaveRef.current = true;
      activeConversationIdRef.current = ASSISTANT_CONVERSATION_ID;
      setConversationId(ASSISTANT_CONVERSATION_ID);
      setConversationTitle(ASSISTANT_CONVERSATION_TITLE);
      setConversationGroup('最近');
      setMessages(messageCache.current.get(ASSISTANT_CONVERSATION_ID) ?? conversation?.messages ?? []);
      setActiveView('assistant');
      titleGeneratedRef.current = true;
    } catch (error) {
      window.alert(error instanceof Error ? error.message : String(error));
    } finally {
      setHistoryReady(true);
    }
  }, [activeView]);

  const openConversation = useCallback(async (id: string) => {
    if (id === conversationId) {
      setActiveView('chat');
      return;
    }
    setHistoryReady(false);
    try {
      const conversation = await getConversation(id);
      skipNextAutoSaveRef.current = true;
      activeConversationIdRef.current = conversation.id;
      setConversationId(conversation.id);
      setConversationTitle(conversation.title);
      setConversationGroup(conversation.group);
      setMessages(messageCache.current.get(conversation.id) ?? conversation.messages);
      setActiveView('chat');
      titleGeneratedRef.current = Boolean(conversation.title || conversation.messages.length);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : String(error));
    } finally {
      setHistoryReady(true);
    }
  }, [conversationId]);

  const renameConversation = useCallback((id: string, title: string) => {
    const next = title.slice(0, 48);
    setConversationList((items) => items.map((item) => item.id === id ? { ...item, title: next } : item));
    if (id === conversationId) {
      titleGeneratedRef.current = true;
      setConversationTitle(next);
    } else {
      void updateConversation(id, { title: next }).catch((error) => window.alert(error instanceof Error ? error.message : String(error)));
    }
  }, [conversationId]);

  const moveConversation = useCallback((id: string) => {
    const current = conversationList.find((item) => item.id === id);
    if (!current) return;
    const group = current.group === '最近' ? '已归档' : '最近';
    setConversationList((items) => items.map((item) => item.id === id ? { ...item, group } : item));
    if (id === conversationId) setConversationGroup(group);
    else void updateConversation(id, { group }).catch((error) => window.alert(error instanceof Error ? error.message : String(error)));
  }, [conversationId, conversationList]);

  const removeConversation = useCallback(async (id: string) => {
    if (abortRefs.current.has(id)) throw new Error('请先停止正在运行的对话');
    await deleteConversation(id);
    setConversationList((items) => items.filter((item) => item.id !== id));
    if (id !== conversationId) return;
    const nextId = newConversationId();
    activeConversationIdRef.current = nextId;
    messageCache.current.set(nextId, []);
    setConversationId(nextId);
    setConversationTitle('');
    setConversationGroup('最近');
    setMessages([]);
    titleGeneratedRef.current = false;
  }, [conversationId]);

  const activateDocumentConversation = useCallback(async (key: string, name: string) => {
    if (activeView !== 'document') {
      documentPreviousConversationRef.current = {
        id: conversationId,
        title: conversationTitle,
        group: conversationGroup,
        messages,
      };
    }
    const id = documentConversationId(key);
    const stored = messageCache.current.get(id) ? null : await getConversationIfExists(id);
    const nextMessages = messageCache.current.get(id) ?? stored?.messages ?? [];
    skipNextAutoSaveRef.current = true;
    messageCache.current.set(id, nextMessages);
    activeConversationIdRef.current = id;
    setConversationId(id);
    setConversationTitle(stored?.title || `关于 ${name}`);
    setConversationGroup(stored?.group ?? '最近');
    setMessages(nextMessages);
    titleGeneratedRef.current = true;
    documentChannelRef.current = 'entry';
  }, [activeView, conversationGroup, conversationId, conversationTitle, messages]);

  const closeDocument = useCallback(() => {
    const previous = documentPreviousConversationRef.current;
    setActiveView(documentOriginViewRef.current);
    setActiveDocument(null);
    setDocumentApolloOpen(false);
    if (previous) {
      const previousMessages = messageCache.current.get(previous.id) ?? previous.messages;
      skipNextAutoSaveRef.current = true;
      activeConversationIdRef.current = previous.id;
      messageCache.current.set(previous.id, previousMessages);
      setConversationId(previous.id);
      setConversationTitle(previous.title);
      setConversationGroup(previous.group);
      setMessages(previousMessages);
      titleGeneratedRef.current = Boolean(previous.title || previousMessages.length);
    }
    documentPreviousConversationRef.current = null;
  }, []);

  const openLibrary = useCallback(async () => {
    if (activeView === 'assistant') documentChannelRef.current = 'assistant';
    else if (activeView === 'chat') documentChannelRef.current = 'entry';
    setActiveView('library');
    setLibraryLoading(true);
    try {
      setStoredArtifacts(await getStoredArtifacts());
    } catch (error) {
      window.alert(error instanceof Error ? error.message : String(error));
    } finally {
      setLibraryLoading(false);
    }
  }, [activeView]);

  const openDocument = useCallback(async (file: LibraryFile) => {
    try {
      documentOriginViewRef.current = activeView === 'document' ? documentOriginViewRef.current : activeView;
      const opened = await openLibraryFile(file);
      await activateDocumentConversation(file.id, file.title);
      setLibrarySource(file.source);
      setActiveDocument(opened);
      setDocumentApolloOpen(false);
      setActiveView('document');
    } catch (error) {
      window.alert(error instanceof Error ? error.message : String(error));
    }
  }, [activateDocumentConversation, activeView]);

  const openArtifactDocument = useCallback(async (artifact: import('@/types').Artifact) => {
    try {
      if (activeView !== 'document') {
        documentOriginViewRef.current = activeView === 'assistant' ? 'assistant' : 'chat';
      }
      const opened = await openArtifact(artifact);
      await activateDocumentConversation(artifact.id, artifact.title);
      setActiveDocument(opened);
      setDocumentApolloOpen(false);
      setActiveView('document');
    } catch (error) {
      window.alert(error instanceof Error ? error.message : String(error));
    }
  }, [activateDocumentConversation, activeView]);

  const connectLocalFolder = useCallback(async () => {
    try {
      const folder = await chooseLocalFolder();
      setLocalFolder(folder);
      setLocalFiles(await listLocalFiles(folder));
      setLibrarySource('local');
    } catch (error) {
      if ((error as { name?: string })?.name !== 'AbortError') window.alert(error instanceof Error ? error.message : String(error));
    }
  }, []);

  const workspaceLabel = librarySource === 'local' ? localFolder?.name || '本地' : '远端';

  const toggleWorkspace = useCallback(() => {
    if (librarySource === 'local') return setLibrarySource('server');
    if (localFolder) return setLibrarySource('local');
    void connectLocalFolder();
  }, [connectLocalFolder, librarySource, localFolder]);

  const refreshLocalFolder = useCallback(async () => {
    if (!localFolder) return;
    if (!await ensureFolderPermission(localFolder)) return window.alert('需要重新授予本地文件夹读写权限');
    setLocalFiles(await listLocalFiles(localFolder));
  }, [localFolder]);

  const handleCommand = useCallback(async (command: string) => {
    const assistantSurface = activeView === 'assistant' || (activeView === 'document' && documentChannelRef.current === 'assistant');
    if (streaming) return;
    const targetConversationId = conversationId;
    const controller = new AbortController();
    abortRefs.current.set(targetConversationId, controller);
    setRunningConversationIds((current) => new Set(current).add(targetConversationId));
    if (command === '/clear') {
      try {
        await streamApollo(command, (event) => {
          if (event.type === 'status' || event.type === 'done') setRuntimeStatus(event.status);
        }, controller.signal, assistantSurface ? 'assistant' : 'entry', assistantSurface ? undefined : targetConversationId);
        await deleteConversation(targetConversationId).catch(() => undefined);
        setConversationList((items) => items.filter((item) => item.id !== targetConversationId));
        const nextId = assistantSurface ? ASSISTANT_CONVERSATION_ID : newConversationId();
        activeConversationIdRef.current = nextId;
        messageCache.current.set(nextId, []);
        setConversationId(nextId);
        setMessages([]);
        setConversationTitle(assistantSurface ? ASSISTANT_CONVERSATION_TITLE : '');
        setConversationGroup('最近');
        titleGeneratedRef.current = false;
      } catch (error) {
        window.alert(error instanceof Error ? error.message : String(error));
      } finally {
        finishRun(targetConversationId);
      }
      return;
    }
    if (!assistantSurface) {
      finishRun(targetConversationId);
      return;
    }
    try {
      await streamApollo(command, (event) => {
        if (event.type === 'status' || event.type === 'done') setRuntimeStatus(event.status);
      }, controller.signal, 'assistant');
    } catch (error) {
      window.alert(error instanceof Error ? error.message : String(error));
    } finally {
      finishRun(targetConversationId);
    }
  }, [activeView, conversationId, finishRun, streaming]);

  const changePermissionMode = useCallback(async (mode: ApolloPermissionMode) => {
    setPermissionMode(mode);
    try {
      await saveApolloPermission(mode, 'assistant');
      setRuntimeStatus(await getApolloStatus());
    } catch (error) {
      setPermissionMode(mode === 'ask' ? 'unrestricted' : 'ask');
      window.alert(error instanceof Error ? error.message : String(error));
    }
  }, []);

  const changeEntryPermissionMode = useCallback(async (mode: ApolloPermissionMode) => {
    setEntryPermissionMode(mode);
    try {
      await saveApolloPermission(mode, 'entry');
    } catch (error) {
      setEntryPermissionMode(mode === 'ask' ? 'unrestricted' : 'ask');
      window.alert(error instanceof Error ? error.message : String(error));
    }
  }, []);

  return (
    <div className="flex h-dvh overflow-hidden bg-white">
      <AppSidebar
        open={sidebarOpen}
        onToggle={() => setSidebarOpen((open) => !open)}
        onNewChat={() => {
          handleNewChat();
          if (window.innerWidth < 1024) setSidebarOpen(false);
        }}
        onOpenAssistant={() => {
          void openAssistant();
          if (window.innerWidth < 1024) setSidebarOpen(false);
        }}
        conversations={conversationList}
        runningConversationIds={runningConversationIds}
        activeConversationId={conversationId}
        activeView={activeView === 'document' ? documentOriginViewRef.current : activeView}
        onOpenChat={(id) => {
          void openConversation(id);
          if (window.innerWidth < 1024) setSidebarOpen(false);
        }}
        onOpenLibrary={() => {
          void openLibrary();
          if (window.innerWidth < 1024) setSidebarOpen(false);
        }}
        onRenameChat={renameConversation}
        onMoveChat={moveConversation}
        onDeleteChat={(id) => {
          if (window.confirm('删除这个对话？已生成的文件不会被删除。')) {
            void removeConversation(id).catch((error) => window.alert(error instanceof Error ? error.message : String(error)));
          }
        }}
        username={user.username}
        onLogout={onLogout}
      />

      <main className="relative flex min-w-0 flex-1">
        <section className="relative flex min-w-0 flex-1 flex-col">
          {activeView !== 'document' && <button
            type="button"
            aria-label="打开侧栏"
            onClick={() => setSidebarOpen(true)}
            className="icon-button absolute left-2.5 top-2.5 z-20 inline-flex lg:hidden"
          >
            <MenuIcon />
          </button>}
          {activeView === 'assistant' ? <SettingsBar
              apolloPermissionMode={permissionMode}
              canManageConfig={user.admin}
              workspaceLabel={workspaceLabel}
              onWorkspaceToggle={toggleWorkspace}
            /> : activeView !== 'document' && <WorkspaceBar label={workspaceLabel} onToggle={toggleWorkspace} />}
          {activeView === 'assistant' && <RuntimeStatusBar status={runtimeStatus} />}
          {activeView === 'library' ? (
            <FileLibrary
              files={storedArtifacts.map((file) => ({ ...file, source: 'server' as const }))}
              localFiles={localFiles}
              loading={libraryLoading}
              localFolderName={localFolder?.name ?? ''}
              source={librarySource}
              onSourceChange={setLibrarySource}
              onOpen={(file) => { void openDocument(file); }}
              onConnectFolder={() => { void connectLocalFolder(); }}
              onRefreshFolder={() => { void refreshLocalFolder(); }}
            />
          ) : activeView === 'document' && activeDocument ? (
            <div className="relative flex min-h-0 flex-1">
              <DocumentWorkspace
                ref={documentWorkspaceRef}
                document={activeDocument}
                workspaceLabel={workspaceLabel}
                onWorkspaceToggle={toggleWorkspace}
                onOpenChat={() => setDocumentApolloOpen(true)}
                onChange={setActiveDocument}
                onBack={closeDocument}
              />
              {documentApolloOpen && (
                <aside className="relative z-30 flex w-[360px] shrink-0 flex-col border-l border-black/[0.07] bg-white max-lg:absolute max-lg:inset-y-0 max-lg:right-0 max-lg:w-[min(360px,100%)] max-lg:shadow-[-12px_0_40px_rgba(0,0,0,0.12)]" aria-label="Apollo 对话">
                  <header className="flex h-12 shrink-0 items-center justify-between border-b border-black/[0.06] px-4">
                    <span className="text-[12px] font-medium text-[#303030]">关于此文件</span>
                    <button type="button" onClick={() => setDocumentApolloOpen(false)} className="icon-button inline-flex" aria-label="关闭 Apollo"><ClosePanelIcon /></button>
                  </header>
                  <div className="min-h-0 flex-1">
                    <ChatPanel
                      messages={messages}
                      streaming={streaming}
                      onSend={handleSend}
                      onStop={handleStop}
                      onCommand={handleCommand}
                      onRespond={handleRespond}
                      onOpenArtifact={(artifact) => { void openArtifactDocument(artifact); }}
                      runtimeMode={runtimeStatus?.mode ?? 'normal'}
                      permissionMode={documentChannelRef.current === 'assistant' ? permissionMode : entryPermissionMode}
                      onPermissionChange={documentChannelRef.current === 'assistant' ? changePermissionMode : changeEntryPermissionMode}
                      canManagePermission={documentChannelRef.current === 'assistant' ? true : user.admin}
                      surface={documentChannelRef.current}
                      embedded
                    />
                  </div>
                </aside>
              )}
            </div>
          ) : (
            <ChatPanel
              messages={messages}
              streaming={streaming}
              onSend={handleSend}
              onStop={handleStop}
              onCommand={handleCommand}
              onRespond={handleRespond}
              onOpenArtifact={(artifact) => { void openArtifactDocument(artifact); }}
              runtimeMode={runtimeStatus?.mode ?? 'normal'}
              permissionMode={activeView === 'assistant' ? permissionMode : entryPermissionMode}
              onPermissionChange={activeView === 'assistant' ? changePermissionMode : changeEntryPermissionMode}
              canManagePermission={activeView === 'assistant' ? true : user.admin}
              surface={activeView === 'assistant' ? 'assistant' : 'entry'}
            />
          )}
        </section>
      </main>
    </div>
  );
}

function WorkspaceBar({ label, onToggle }: { label: string; onToggle: () => void }) {
  return (
    <header className="flex h-12 shrink-0 items-center border-b border-black/[0.04] bg-white pl-12 pr-3 lg:px-3">
      <div className="flex min-w-0 items-center gap-2 text-[#555]" title={`Agent 工作目录：${label}`}>
        <button type="button" onClick={onToggle} className="icon-button inline-flex size-7" aria-label={`切换工作目录，当前：${label}`} title="切换远端/本地目录"><WorkspaceFolderIcon /></button>
        <span className="max-w-48 truncate text-[12px] font-medium text-[#303030]">{label}</span>
      </div>
    </header>
  );
}

function WorkspaceFolderIcon() { return <svg viewBox="0 0 24 24" width="16" height="16" fill="none" className="shrink-0" aria-hidden="true"><path d="M3.5 6.5h6l2 2h9v9.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2V6.5Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /></svg>; }
function ClosePanelIcon() { return <svg viewBox="0 0 24 24" width="17" height="17" fill="none" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>; }

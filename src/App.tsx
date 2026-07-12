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

let idSeq = 0;
const nextId = (p: string) => `${p}-${Date.now()}-${idSeq++}`;

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
  const [activeView, setActiveView] = useState<'assistant' | 'chat' | 'library'>('assistant');
  const [storedArtifacts, setStoredArtifacts] = useState<StoredArtifact[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth >= 1024);
  const abortRefs = useRef(new Map<string, AbortController>());
  const messageCache = useRef(new Map<string, ChatMessage[]>());
  const activeConversationIdRef = useRef(conversationId);
  const titleGeneratedRef = useRef(false);
  const streaming = runningConversationIds.has(conversationId);

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
    const channel = activeView === 'assistant' ? 'assistant' : 'entry';
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
    if (!historyReady || (!messages.length && !conversationTitle)) return;
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
      const assistantSurface = activeView === 'assistant';
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
        const executionText = attachments.length
          ? `${text}\n\n已上传文件：\n${attachments.map((file) => `- ${file.path}`).join('\n')}`
          : text;
        const artifacts = await streamApollo(
          executionText,
          (event) => {
            if (event.type === 'trace' && event.event.type === 'assistant_delta') onDelta(event.event.text);
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
    [activeView, conversationGroup, conversationId, conversationTitle, finishRun, rememberConversation, updateRunMessages],
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

  const openLibrary = useCallback(async () => {
    setActiveView('library');
    setLibraryLoading(true);
    try {
      setStoredArtifacts(await getStoredArtifacts());
    } catch (error) {
      window.alert(error instanceof Error ? error.message : String(error));
    } finally {
      setLibraryLoading(false);
    }
  }, []);

  const handleCommand = useCallback(async (command: string) => {
    const assistantSurface = activeView === 'assistant';
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
        activeView={activeView}
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
          <button
            type="button"
            aria-label="打开侧栏"
            onClick={() => setSidebarOpen(true)}
            className="icon-button absolute left-2.5 top-2.5 z-20 inline-flex lg:hidden"
          >
            <MenuIcon />
          </button>
          {activeView === 'assistant' && <SettingsBar
              apolloPermissionMode={permissionMode}
              canManageConfig={user.admin}
            />}
          {activeView === 'assistant' && <RuntimeStatusBar status={runtimeStatus} />}
          {activeView === 'library' ? (
            <FileLibrary files={storedArtifacts} loading={libraryLoading} />
          ) : (
            <ChatPanel
              messages={messages}
              streaming={streaming}
              onSend={handleSend}
              onStop={handleStop}
              onCommand={handleCommand}
              onRespond={handleRespond}
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

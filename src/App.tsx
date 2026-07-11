import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatMessage, ProcessStep, RuntimeStatus } from '@/types';
import { extractArtifacts } from '@/lib/agent';
import { mockStream } from '@/lib/mockAgent';
import { runNoumiTask } from '@/lib/noumiAgent';
import {
  getApolloPermission,
  getStoredArtifacts,
  getApolloStatus,
  respondApollo,
  saveApolloPermission,
  streamApollo,
  summarizeConversationTitle,
  type ApolloPermissionMode,
  type StoredArtifact,
} from '@/lib/apolloAgent';
import { applyApolloEvent } from '@/lib/apolloTimeline';
import {
  loadBackend,
  saveBackend,
  loadNoumi,
  saveNoumi,
  type BackendMode,
  type NoumiSettings,
} from '@/lib/settings';
import {
  deleteConversation,
  getConversation,
  listConversations,
  newConversationId,
  saveConversation,
  updateConversation,
  type ConversationSummary,
} from '@/lib/chatHistory';
import ChatPanel from '@/components/ChatPanel';
import AppSidebar from '@/components/AppSidebar';
import FileLibrary from '@/components/FileLibrary';
import SettingsBar from '@/components/SettingsBar';
import RuntimeStatusBar from '@/components/RuntimeStatusBar';
import { MenuIcon } from '@/components/Icons';

let idSeq = 0;
const nextId = (p: string) => `${p}-${Date.now()}-${idSeq++}`;

export default function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [backend, setBackend] = useState<BackendMode>(() => loadBackend());
  const [noumi, setNoumi] = useState<NoumiSettings>(() => loadNoumi());
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus | null>(null);
  const [permissionMode, setPermissionMode] = useState<ApolloPermissionMode>('ask');
  const [conversationId, setConversationId] = useState(newConversationId);
  const [conversationTitle, setConversationTitle] = useState('');
  const [conversationGroup, setConversationGroup] = useState<'最近' | '已归档'>('最近');
  const [conversationList, setConversationList] = useState<ConversationSummary[]>([]);
  const [historyReady, setHistoryReady] = useState(false);
  const [activeView, setActiveView] = useState<'chat' | 'library'>('chat');
  const [storedArtifacts, setStoredArtifacts] = useState<StoredArtifact[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth >= 1024);
  const abortRef = useRef<AbortController | null>(null);
  const noumiTopicRef = useRef<string>('');
  const titleGeneratedRef = useRef(false);

  const toggleMock = useCallback((v: BackendMode) => {
    setBackend(v);
    saveBackend(v);
  }, []);

  const updateNoumi = useCallback((n: NoumiSettings) => {
    setNoumi(n);
    saveNoumi(n);
  }, []);

  const patchAssistant = useCallback((assistantId: string, patch: Partial<ChatMessage>) => {
    setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, ...patch } : m)));
  }, []);

  useEffect(() => {
    if (backend !== 'apollo') return;
    getApolloStatus().then(setRuntimeStatus).catch(() => setRuntimeStatus(null));
    getApolloPermission().then(setPermissionMode).catch(() => setPermissionMode('ask'));
  }, [backend]);

  const rememberConversation = useCallback((conversation: ConversationSummary) => {
    setConversationList((current) => [conversation, ...current.filter((item) => item.id !== conversation.id)]);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void listConversations()
      .then(async (items) => {
        if (cancelled) return;
        setConversationList(items);
        if (items[0]) {
          const conversation = await getConversation(items[0].id);
          if (cancelled) return;
          setConversationId(conversation.id);
          setConversationTitle(conversation.title);
          setConversationGroup(conversation.group);
          setMessages(conversation.messages);
          titleGeneratedRef.current = Boolean(conversation.title || conversation.messages.length);
        }
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
    async (text: string) => {
      if (!titleGeneratedRef.current) {
        titleGeneratedRef.current = true;
        void summarizeConversationTitle(text)
          .then(setConversationTitle)
          .catch(() => setConversationTitle(text.slice(0, 18)));
      }
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
      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setStreaming(true);

      const controller = new AbortController();
      abortRef.current = controller;

      let raw = '';
      const onDelta = (chunk: string) => {
        raw += chunk;
        const { cleanText } = extractArtifacts(raw);
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, content: cleanText } : m)),
        );
      };

      const finishThought = (detail?: string) => {
        const durationSec = (Date.now() - thoughtStart) / 1000;
        setMessages((prev) =>
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
        if (backend === 'apollo') {
          const artifacts = await streamApollo(
            text,
            (event) => {
              if (event.type === 'trace' && event.event.type === 'assistant_delta') onDelta(event.event.text);
              if (event.type === 'status' || event.type === 'done') setRuntimeStatus(event.status);
              if (event.type === 'trace' || event.type === 'interaction') {
                setMessages((prev) =>
                  prev.map((message) =>
                    message.id === assistantId
                      ? { ...message, steps: applyApolloEvent(message.steps ?? [], event) }
                      : message,
                  ),
                );
              }
            },
            controller.signal,
          );
          finishThought();
          const { cleanText } = extractArtifacts(raw);
          patchAssistant(assistantId, {
            content: cleanText,
            artifacts,
            streaming: false,
          });
          setMessages((prev) =>
            prev.map((message) =>
              message.id === assistantId
                ? {
                    ...message,
                    steps: (message.steps ?? []).map((step) =>
                      step.pending && step.kind !== 'approval' && step.kind !== 'question'
                        ? { ...step, pending: false }
                        : step,
                    ),
                  }
                : message,
            ),
          );
          return;
        }

        if (backend === 'noumi') {
          const result = await runNoumiTask(
            {
              baseUrl: noumi.baseUrl,
              apiKey: noumi.apiKey,
              projectId: noumi.projectId,
              topicId: noumi.topicId || noumiTopicRef.current || undefined,
            },
            text,
            onDelta,
            controller.signal,
          );
          noumiTopicRef.current = result.topicId;
          finishThought();
          // 若有产出物，附加可折叠 Run 块
          const runSteps: ProcessStep[] =
            result.artifacts.length > 0
              ? [
                  {
                    id: nextId('run'),
                    kind: 'tool_run',
                    title: 'Collect workspace artifacts',
                    command: 'workspace tree · files · download',
                    detail: result.artifacts.map((a) => `· ${a.title} (${a.kind})`).join('\n'),
                    durationSec: 0.1,
                  },
                ]
              : [];
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    content: result.text || raw,
                    artifacts: result.artifacts,
                    steps: [...(m.steps ?? []).map((s) => ({ ...s, pending: false })), ...runSteps],
                    streaming: false,
                  }
                : m,
            ),
          );
          return;
        }

        if (backend === 'mock') {
          await mockStream(
            text,
            {
              onDelta,
              onSteps: (steps) => patchAssistant(assistantId, { steps }),
            },
            controller.signal,
          );
        }

        const { cleanText, artifacts } = extractArtifacts(raw);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  content: cleanText,
                  artifacts,
                  streaming: false,
                  steps: (m.steps ?? []).map((s) => ({ ...s, pending: false })),
                }
              : m,
          ),
        );
      } catch (e) {
        const msg = controller.signal.aborted ? '已中断。' : e instanceof Error ? e.message : String(e);
        finishThought(`出错：${msg}`);
        setMessages((prev) =>
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
        setStreaming(false);
        abortRef.current = null;
      }
    },
    [messages, backend, noumi, patchAssistant],
  );

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
    setStreaming(false);
  }, []);

  const handleNewChat = useCallback(() => {
    abortRef.current?.abort();
    if (messages.length || conversationTitle) {
      void saveConversation({ id: conversationId, title: conversationTitle, group: conversationGroup, messages })
        .then(rememberConversation)
        .catch(() => undefined);
    }
    setConversationId(newConversationId());
    setMessages([]);
    setConversationTitle('');
    setConversationGroup('最近');
    titleGeneratedRef.current = false;
    setStreaming(false);
    noumiTopicRef.current = '';
    setActiveView('chat');
    if (backend === 'apollo') {
      void streamApollo('/clear', (event) => {
        if (event.type === 'status' || event.type === 'done') setRuntimeStatus(event.status);
      }).catch(() => undefined);
    }
  }, [backend, conversationGroup, conversationId, conversationTitle, messages, rememberConversation]);

  const openConversation = useCallback(async (id: string) => {
    if (id === conversationId) {
      setActiveView('chat');
      return;
    }
    abortRef.current?.abort();
    setHistoryReady(false);
    try {
      const conversation = await getConversation(id);
      setConversationId(conversation.id);
      setConversationTitle(conversation.title);
      setConversationGroup(conversation.group);
      setMessages(conversation.messages);
      setStreaming(false);
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
    await deleteConversation(id);
    setConversationList((items) => items.filter((item) => item.id !== id));
    if (id !== conversationId) return;
    setConversationId(newConversationId());
    setConversationTitle('');
    setConversationGroup('最近');
    setMessages([]);
    setStreaming(false);
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
    if (backend !== 'apollo' || streaming) return;
    setStreaming(true);
    try {
      await streamApollo(command, (event) => {
        if (event.type === 'status' || event.type === 'done') setRuntimeStatus(event.status);
      });
      if (command === '/clear') {
        void deleteConversation(conversationId).catch(() => undefined);
        setConversationList((items) => items.filter((item) => item.id !== conversationId));
        setConversationId(newConversationId());
        setMessages([]);
        setConversationTitle('');
        setConversationGroup('最近');
        titleGeneratedRef.current = false;
      }
    } catch (error) {
      window.alert(error instanceof Error ? error.message : String(error));
    } finally {
      setStreaming(false);
    }
  }, [backend, conversationId, streaming]);

  const changePermissionMode = useCallback(async (mode: ApolloPermissionMode) => {
    setPermissionMode(mode);
    try {
      await saveApolloPermission(mode);
      setRuntimeStatus(await getApolloStatus());
    } catch (error) {
      setPermissionMode(mode === 'ask' ? 'unrestricted' : 'ask');
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
        conversations={conversationList}
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
          <SettingsBar
            backend={backend}
            noumi={noumi}
            onChangeBackend={toggleMock}
            onChangeNoumi={updateNoumi}
            apolloPermissionMode={permissionMode}
          />
          {backend === 'apollo' && <RuntimeStatusBar status={runtimeStatus} />}
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
              permissionMode={permissionMode}
              onPermissionChange={changePermissionMode}
            />
          )}
        </section>
      </main>
    </div>
  );
}

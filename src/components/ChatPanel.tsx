import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Artifact, ChatMessage } from '@/types';
import MarkdownView from './MarkdownView';
import ProcessTimeline, { hasProcessActivity, ProcessSummary } from './ProcessTimeline';
import { ArtifactBody } from './ArtifactPanel';
import type { ApolloPermissionMode } from '@/lib/apolloAgent';

const suggestions = [
  { title: '整理今日待办', prompt: '帮我整理今天的工作待办' },
  { title: '总结项目资料', prompt: '帮我总结一份项目资料' },
  { title: '起草正式邮件', prompt: '帮我起草一封正式工作邮件' },
  { title: '制定本周计划', prompt: '帮我制定本周工作计划' },
  { title: '优化文字表达', prompt: '帮我优化一段文字的表达' },
  { title: '整理会议纪要', prompt: '帮我整理一份会议纪要' },
  { title: '分析表格数据', prompt: '帮我分析一份表格数据' },
  { title: '搜索行业动态', prompt: '帮我搜索最新行业动态' },
];
const suggestionRows = [suggestions.slice(0, 3), suggestions.slice(3, 6), suggestions.slice(6)];
const assistantSuggestions = [
  { title: '你能做什么', prompt: '你能做什么？请简洁介绍。' },
  { title: '整理工作思路', prompt: '帮我整理一下接下来的工作思路' },
  { title: '记住工作偏好', prompt: '我想告诉你一些工作偏好，请帮我记住' },
];

const slashCommands = [
  { command: '/plan', description: '进入计划模式', control: true },
  { command: '/approve', description: '批准当前计划并执行', control: true },
  { command: '/reject', description: '拒绝当前计划', control: true },
  { command: '/goal', description: '启动目标模式', argument: '描述目标', control: true },
  { command: '/goal-stop', description: '停止目标模式', control: true },
  { command: '/workflow', description: '启动工作流', argument: '描述目标', control: true },
  { command: '/workflow-stop', description: '停止工作流', control: true },
  { command: '/status', description: '刷新运行状态', control: true },
  { command: '/clear', description: '清空当前对话', control: true },
] as const;

export default function ChatPanel({
  messages,
  streaming,
  onSend,
  onStop,
  onCommand,
  onRespond,
  onOpenArtifact,
  runtimeMode,
  permissionMode,
  onPermissionChange,
  surface,
  canManagePermission,
  embedded = false,
  emptyTitle,
  emptyDescription,
  placeholder = '给 Apollo 发消息',
  streamingStatus,
}: {
  messages: ChatMessage[];
  streaming: boolean;
  onSend: (text: string, files?: File[]) => void;
  onStop: () => void;
  onCommand: (command: string) => void;
  onRespond: (messageId: string, stepId: string, answer: string) => Promise<void>;
  onOpenArtifact: (artifact: Artifact) => void;
  runtimeMode: string;
  permissionMode: ApolloPermissionMode;
  onPermissionChange: (mode: ApolloPermissionMode) => void;
  surface: 'assistant' | 'entry';
  canManagePermission: boolean;
  embedded?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  placeholder?: string;
  streamingStatus?: string;
}) {
  const [input, setInput] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [selectedCommand, setSelectedCommand] = useState(0);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [activityMessageId, setActivityMessageId] = useState<string | null>(null);
  const [activityOpen, setActivityOpen] = useState(false);
  const autoOpenedActivityRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const commandMenuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useLayoutEffect(() => {
    const container = scrollRef.current;
    if (container) container.scrollTop = container.scrollHeight;
  }, [messages, streaming]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
  }, [input]);

  const latestActivityMessage = [...messages].reverse().find((message) =>
    message.role === 'assistant' && message.steps && hasProcessActivity(message.steps),
  );
  const activityMessage = messages.find((message) => message.id === activityMessageId) ?? latestActivityMessage;

  useEffect(() => {
    if (!latestActivityMessage?.streaming || autoOpenedActivityRef.current === latestActivityMessage.id) return;
    autoOpenedActivityRef.current = latestActivityMessage.id;
    setActivityMessageId(latestActivityMessage.id);
    setActivityOpen(true);
  }, [latestActivityMessage?.id, latestActivityMessage?.streaming]);

  const availableCommands = surface === 'assistant' ? slashCommands : slashCommands.filter((item) => item.command === '/clear' || !('control' in item && item.control));
  const commandToken = input.trimStart().split(/\s/, 1)[0];
  const commandMenuOpen = input.startsWith('/') && !input.includes(' ');
  const matchingCommands = commandMenuOpen
    ? availableCommands.filter((item) => item.command.toLowerCase().includes(commandToken.toLowerCase()))
    : [];

  useEffect(() => setSelectedCommand(0), [commandToken]);

  useEffect(() => {
    commandMenuRef.current
      ?.querySelector<HTMLElement>(`[data-command-index="${selectedCommand}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [selectedCommand, matchingCommands.length]);

  const send = (text: string) => {
    const trimmed = text.trim();
    if ((!trimmed && !files.length) || streaming) return;
    const prompt = trimmed || '请处理我上传的文件';
    const definition = availableCommands.find((item) => item.command === prompt.split(/\s+/, 1)[0]);
    if (definition && 'control' in definition && definition.control) onCommand(prompt);
    else onSend(prompt, files);
    setInput('');
    setFiles([]);
  };

  const chooseCommand = (index: number) => {
    const item = matchingCommands[index];
    if (!item) return;
    setInput(`${item.command} `);
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const copyMessage = async (id: string, content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedMessageId(id);
      window.setTimeout(() => setCopiedMessageId((current) => current === id ? null : current), 1500);
    } catch {
      window.alert('复制失败，请检查浏览器剪贴板权限');
    }
  };

  return (
    <div className="relative flex h-full min-h-0 min-w-0 flex-1 bg-white text-[#0d0d0d]">
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        <div
        ref={scrollRef}
        className={`flex-1 overflow-y-auto px-4 pt-6 md:px-6 ${embedded ? 'pb-8' : 'pb-40 md:pb-44'}`}
        aria-live="polite"
        aria-relevant="additions text"
      >
        {messages.length === 0 ? (
          <div className="mx-auto flex min-h-full max-w-3xl flex-col items-center justify-center pb-16 text-center">
            <h1 className="text-[24px] font-semibold leading-[30px] tracking-[-0.035em] text-[#0d0d0d]">
              {emptyTitle ?? (surface === 'assistant' ? '你好，我是 Apollo' : '需要完成什么任务？')}
            </h1>
            <p className="mt-2 text-[11px] leading-[17px] text-[#777]">
              {emptyDescription ?? (surface === 'assistant' ? '我会持续了解你的工作习惯，协助处理日常事务。' : '描述你的需求，我会匹配合适的智能体。')}
            </p>
            {!embedded && <div className="mt-7 flex w-full max-w-3xl flex-col items-center gap-1.5">
              {(surface === 'assistant' ? [assistantSuggestions] : suggestionRows).map((row, rowIndex) => (
                <div key={rowIndex} className="flex flex-wrap justify-center gap-2 sm:flex-nowrap">
                  {row.map((suggestion) => (
                    <button
                      key={suggestion.title}
                      type="button"
                      onClick={() => send(suggestion.prompt)}
                      className="whitespace-nowrap rounded-[16px] bg-[#f4f4f4] px-3.5 py-2 text-[11px] leading-[17px] text-[#303030] transition-colors hover:bg-[#e9e9e9] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0d0d0d]"
                    >
                      {suggestion.title}
                    </button>
                  ))}
                </div>
              ))}
            </div>}
          </div>
        ) : (
          <div className="mx-auto w-full max-w-3xl space-y-5">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`app-state-motion ${message.role === 'user' ? 'flex justify-end' : 'w-full'}`}
              >
                {message.role === 'assistant' ? (
                  <div className="min-w-0 text-[13px] leading-5 text-[#0d0d0d]">
                    {message.steps && message.steps.length > 0 && (
                      <ProcessSummary
                        steps={message.steps}
                        streaming={Boolean(message.streaming)}
                        onOpen={() => {
                          setActivityMessageId(message.id);
                          setActivityOpen(true);
                        }}
                      />
                    )}

                    {message.content ? (
                      <div className="chat-message [&_.prose-chat]:h-auto [&_.prose-chat]:overflow-visible [&_.prose-chat]:p-0">
                        <MarkdownView content={message.content} />
                      </div>
                    ) : message.streaming && (!message.steps || message.steps.every((step) => !step.pending)) ? (
                      <span className="text-[#8f8f8f]">思考中…</span>
                    ) : null}

                    {message.artifacts && message.artifacts.length > 0 && (
                      <div className="mt-4 space-y-3">
                        {message.artifacts.map((artifact) => (
                          <InlineArtifact key={artifact.id} artifact={artifact} onOpen={() => onOpenArtifact(artifact)} />
                        ))}
                      </div>
                    )}
                    {message.content && (
                      <MessageCopyButton copied={copiedMessageId === message.id} onClick={() => void copyMessage(message.id, message.content)} />
                    )}
                  </div>
                ) : (
                  <div className="flex max-w-[80%] flex-col items-end">
                    <div className="rounded-[16px] bg-[#f4f4f4] px-3.5 py-2 text-[13px] leading-5 text-[#0d0d0d]">
                      {message.attachments?.map((file) => (
                        <div key={file.id} className="mb-1 flex items-center gap-1.5 truncate text-[11px] text-[#666]">
                          <FileIcon /> <span className="truncate">{file.name}</span>
                        </div>
                      ))}
                      <div className="whitespace-pre-wrap">{message.content}</div>
                    </div>
                    {message.content && (
                      <MessageCopyButton copied={copiedMessageId === message.id} onClick={() => void copyMessage(message.id, message.content)} />
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className={embedded ? 'shrink-0 bg-white px-4 pb-4 pt-3' : 'pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-white via-white to-transparent px-[10px] pb-5 pt-8 md:px-6 md:pb-10'}>
        {streaming && streamingStatus && (
          <div
            role="status"
            aria-live="polite"
            aria-atomic="true"
            className="app-state-motion mx-auto mb-2 flex max-w-3xl items-center gap-2 px-1 py-1 text-[11px] font-medium text-[#555]"
          >
            <span className="size-1.5 shrink-0 rounded-full bg-[#777] motion-safe:animate-pulse" aria-hidden="true" />
            <span>{streamingStatus}</span>
          </div>
        )}
        <div className={`${embedded ? '' : 'pointer-events-auto'} relative mx-auto max-w-3xl rounded-[19px] border border-[#e5e5e5] bg-white p-2.5 shadow-[0_2px_12px_rgba(0,0,0,0.07)] transition-colors focus-within:border-[#b8b8b8]`}>
          {files.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5 px-1">
              {files.map((file, index) => (
                <span key={`${file.name}-${file.lastModified}`} className="app-state-motion inline-flex max-w-[220px] items-center gap-1 rounded-lg bg-[#f2f2f2] px-2 py-1 text-[10px] text-[#555]">
                  <span className="truncate">{file.name}</span>
                  <button type="button" aria-label={`移除 ${file.name}`} onClick={() => setFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))} className="text-[#888] hover:text-[#222]">×</button>
                </span>
              ))}
            </div>
          )}
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (matchingCommands.length > 0 && event.key === 'ArrowDown') {
                event.preventDefault();
                setSelectedCommand((value) => (value + 1) % matchingCommands.length);
                return;
              }
              if (matchingCommands.length > 0 && event.key === 'ArrowUp') {
                event.preventDefault();
                setSelectedCommand((value) => (value - 1 + matchingCommands.length) % matchingCommands.length);
                return;
              }
              if (matchingCommands.length > 0 && (event.key === 'Tab' || event.key === 'Enter')) {
                event.preventDefault();
                chooseCommand(selectedCommand);
                return;
              }
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                send(input);
              }
            }}
            rows={1}
            placeholder={placeholder}
            aria-label="消息内容"
            className="block max-h-[200px] min-h-11 w-full resize-none overflow-y-auto border-0 bg-transparent px-1 text-[12px] leading-[18px] text-[#0d0d0d] outline-none placeholder:text-[#8f8f8f] focus-visible:outline-none"
          />
          {matchingCommands.length > 0 && (
            <div ref={commandMenuRef} role="listbox" className="app-state-motion absolute inset-x-0 bottom-full mb-2 max-h-[min(360px,calc(100dvh-180px))] touch-pan-y overflow-y-scroll overscroll-contain rounded-2xl border border-black/10 bg-white p-1.5 [scrollbar-gutter:stable] shadow-[0_12px_36px_rgba(0,0,0,0.14)]">
              {matchingCommands.map((item, index) => (
                <button
                  key={item.command}
                  data-command-index={index}
                  role="option"
                  aria-selected={index === selectedCommand}
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => chooseCommand(index)}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors ${index === selectedCommand ? 'bg-[#f2f2f2]' : 'hover:bg-[#f7f7f7]'}`}
                >
                  <code className="w-28 shrink-0 text-[11px] font-medium text-[#202020]">{item.command}</code>
                  <span className="truncate text-[10px] text-[#777]">{item.description}</span>
                </button>
              ))}
            </div>
          )}
          <div className="mt-2 flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".jpg,.jpeg,.png,.webp,.pdf,.doc,.docx,.xls,.xlsx,.txt,.md,.json"
                className="hidden"
                onChange={(event) => {
                  const selected = Array.from(event.target.files ?? []);
                  setFiles((current) => [...current, ...selected].slice(0, 8));
                  event.currentTarget.value = '';
                }}
              />
              <button type="button" aria-label="上传文件" onClick={() => fileInputRef.current?.click()} className="flex size-7 items-center justify-center rounded-full text-[#666] hover:bg-[#f2f2f2] hover:text-[#222]">
                <PaperclipIcon />
              </button>
              {canManagePermission && <label className="flex items-center gap-1.5 text-[10px] text-[#666]">
                  <ShieldIcon />
                  <select
                    aria-label="权限模式"
                    value={permissionMode}
                    onChange={(event) => onPermissionChange(event.target.value as ApolloPermissionMode)}
                    className="border-0 bg-transparent py-1 pr-1 text-[10px] text-[#555] outline-none"
                  >
                    <option value="ask">审批模式</option>
                    <option value="unrestricted">全自动模式</option>
                  </select>
                </label>}
              {surface === 'assistant' && runtimeMode !== 'normal' && (
                <span className="app-state-motion rounded-md bg-blue-50 px-1.5 py-1 text-[10px] text-blue-700">{modeLabel(runtimeMode)}</span>
              )}
            </div>
            {streaming ? (
              <button
                key="stop"
                type="button"
                onClick={onStop}
                aria-label="停止生成"
                className="app-state-motion flex size-7 items-center justify-center rounded-full bg-[#0d0d0d] text-white transition-colors hover:bg-[#303030] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0d0d0d]"
              >
                <StopIcon />
              </button>
            ) : (
              <button
                key="send"
                type="button"
                onClick={() => send(input)}
                aria-label="发送消息"
                disabled={!input.trim() && !files.length}
                className="app-state-motion flex size-7 items-center justify-center rounded-full bg-[#0d0d0d] text-white transition-colors hover:bg-[#303030] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0d0d0d] disabled:cursor-default disabled:bg-[#d7d7d7]"
              >
                <SendIcon />
              </button>
            )}
          </div>
        </div>
      </div>
      </div>

      {activityOpen && activityMessage?.steps && (
        <>
          <button
            type="button"
            aria-label="关闭活动面板"
            onClick={() => setActivityOpen(false)}
            className={`absolute inset-0 z-20 cursor-default bg-black/[0.06] ${embedded ? '' : 'xl:hidden'}`}
          />
          <aside
            className={`app-panel-motion z-30 flex min-h-0 w-[min(370px,100%)] shrink-0 flex-col border-l border-black/[0.07] bg-white ${embedded ? 'absolute inset-y-0 right-0 shadow-[-16px_0_40px_rgba(0,0,0,0.10)]' : 'absolute inset-y-0 right-0 shadow-[-16px_0_40px_rgba(0,0,0,0.10)] xl:static xl:shadow-none'}`}
            aria-label="活动"
          >
            <header className="flex h-12 shrink-0 items-center justify-between border-b border-black/[0.07] px-5">
              <h2 className="text-[13px] font-semibold text-[#262626]">活动</h2>
              <button
                type="button"
                onClick={() => setActivityOpen(false)}
                className="flex size-8 cursor-pointer items-center justify-center rounded-md text-[#777] transition-colors hover:bg-black/[0.04] hover:text-[#222] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#171717]"
                aria-label="关闭活动面板"
              >
                <CloseIcon />
              </button>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <ProcessTimeline
                steps={activityMessage.steps}
                streaming={Boolean(activityMessage.streaming)}
                onRespond={(stepId, answer) => onRespond(activityMessage.id, stepId, answer)}
              />
            </div>
          </aside>
        </>
      )}
    </div>
  );
}

function MessageCopyButton({ copied, onClick }: { copied: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="mt-1.5 inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[10px] text-[#888] hover:bg-[#f4f4f4] hover:text-[#303030]" aria-label="复制消息" title="复制消息">
      <CopyIcon /> {copied ? '已复制' : '复制'}
    </button>
  );
}

function CloseIcon() {
  return <svg viewBox="0 0 24 24" width="17" height="17" fill="none" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>;
}

function CopyIcon() {
  return <svg viewBox="0 0 24 24" width="13" height="13" fill="none" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="1.7" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" stroke="currentColor" strokeWidth="1.7" /></svg>;
}

function InlineArtifact({ artifact, onOpen }: { artifact: Artifact; onOpen: () => void }) {
  const isDocument = artifact.kind === 'pdf' || artifact.kind === 'word';
  const downloadUrl = artifactDownloadUrl(artifact);
  const editable = artifact.kind === 'word' || artifact.kind === 'markdown' || artifact.kind === 'json';
  return (
    <section data-artifact-id={artifact.id} className="relative overflow-hidden rounded-[26px] border border-[#e5e5e5] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.02)]" aria-label={`产出物：${artifact.title}`}>
      <div className="pointer-events-none absolute inset-x-3 top-3 z-10 flex h-9 items-center gap-1.5 text-[11px] sm:inset-x-4">
        {editable && <button type="button" onClick={onOpen} className="pointer-events-auto inline-flex h-9 items-center gap-2 rounded-full border border-[#e5e5e5] bg-white/95 px-3 font-medium text-[#202020] shadow-sm backdrop-blur transition-colors hover:bg-[#f7f7f7] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#171717]"><EditIcon />编辑</button>}
        {Boolean(artifact.meta?.path) && <span className="sr-only">已保存</span>}
        <div className="pointer-events-auto ml-auto flex items-center gap-1">
          {downloadUrl && (
            <a href={downloadUrl} download={artifact.title} className="icon-button inline-flex bg-white/80 backdrop-blur" aria-label={`下载 ${artifact.title}`} title="下载"><DownloadArtifactIcon /></a>
          )}
          {editable && <button type="button" onClick={onOpen} className="icon-button inline-flex bg-white/80 backdrop-blur" aria-label={`全屏打开 ${artifact.title}`} title="全屏打开"><ExpandIcon /></button>}
        </div>
      </div>
      <div className={`h-[min(520px,42vh)] overflow-auto pt-14 ${isDocument ? 'bg-[#f5f5f5]' : 'bg-white'}`}>
        <ArtifactBody artifact={artifact} />
      </div>
    </section>
  );
}

function EditIcon() { return <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true"><path d="m4 20 4.2-1 10-10a2.1 2.1 0 0 0-3-3l-10 10L4 20Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /><path d="m13.8 7.4 2.8 2.8" stroke="currentColor" strokeWidth="1.8" /></svg>; }
function DownloadArtifactIcon() { return <svg viewBox="0 0 24 24" width="17" height="17" fill="none" aria-hidden="true"><path d="M12 3v12m0 0 4-4m-4 4-4-4M5 20h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>; }
function ExpandIcon() { return <svg viewBox="0 0 24 24" width="17" height="17" fill="none" aria-hidden="true"><path d="M8 3H3v5m13-5h5v5M8 21H3v-5m13 5h5v-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>; }

function artifactDownloadUrl(artifact: Artifact): string | undefined {
  if (artifact.url) return artifact.url;
  if (artifact.kind === 'word' && artifact.content) {
    return `data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,${artifact.content}`;
  }
  return undefined;
}

function modeLabel(mode: string): string {
  if (mode === 'plan') return '计划模式';
  if (mode === 'goal') return '目标模式';
  if (mode === 'workflow') return '工作流';
  return mode;
}

function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true">
      <path d="M12 3 5.5 5.5v5.8c0 4.2 2.5 7.8 6.5 9.7 4-1.9 6.5-5.5 6.5-9.7V5.5L12 3Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="m9.5 12 1.7 1.7 3.5-3.7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
      <path d="M12 19V5m0 0-6 6m6-6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
      <rect x="5" y="5" width="14" height="14" rx="2" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
      <path d="M7 3h7l4 4v14H7V3Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M14 3v5h4M10 12h5m-5 4h5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PaperclipIcon() {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" aria-hidden="true">
      <path d="m20.5 11.5-8.3 8.3a6 6 0 0 1-8.5-8.5l9-9a4 4 0 0 1 5.7 5.7l-9 9a2 2 0 0 1-2.9-2.8l8.4-8.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

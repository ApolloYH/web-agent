import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Artifact, ChatMessage } from '@/types';
import MarkdownView from './MarkdownView';
import ProcessTimeline from './ProcessTimeline';
import { ArtifactBody } from './ArtifactPanel';
import type { ApolloPermissionMode } from '@/lib/apolloAgent';

const suggestions = [
  { title: '查询电力工程标准', prompt: '查询一条电力工程标准' },
  { title: '识别施工现场隐患', prompt: '识别施工现场安全隐患' },
  { title: '生成管控一张卡', prompt: '生成一份管控一张卡' },
  { title: '审查施工方案', prompt: '审查一份施工方案' },
  { title: '生成监理通知单', prompt: '生成一份监理通知单' },
  { title: '整理今日监理日志', prompt: '生成今天的监理日志' },
  { title: '编制监理文书', prompt: '生成一份监理文书' },
  { title: '对比改造前后单线图', prompt: '对比改造前后单线图' },
];
const suggestionRows = [suggestions.slice(0, 3), suggestions.slice(3, 6), suggestions.slice(6)];
const assistantSuggestions = [
  { title: '你能做什么', prompt: '你能做什么？请简洁介绍。' },
  { title: '整理工作思路', prompt: '帮我整理一下接下来的工作思路' },
  { title: '记住工作偏好', prompt: '我想告诉你一些工作偏好，请帮我记住' },
];

const slashCommands = [
  { command: '/工标库', description: '检索工标库并回答', argument: '输入问题' },
  { command: '/隐患识别', description: '识别主网/配网现场隐患', argument: '描述现场或上传资料' },
  { command: '/方案审查', description: '审查施工方案', argument: '说明审查重点' },
  { command: '/通知单', description: '生成监理通知单', argument: '输入已确认隐患和发单信息' },
  { command: '/监理日志', description: '生成监理日志', argument: '输入当日施工与监理信息' },
  { command: '/监理文书', description: '生成规划、细则或总结', argument: '输入文书类型和工程信息' },
  { command: '/管控一张卡', description: '生成现场风险管控卡', argument: '描述作业并提供现场资料' },
  { command: '/单线图对比', description: '对比改造前后单线图', argument: '说明对比方式' },
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
  runtimeMode,
  permissionMode,
  onPermissionChange,
  surface,
  canManagePermission,
}: {
  messages: ChatMessage[];
  streaming: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
  onCommand: (command: string) => void;
  onRespond: (messageId: string, stepId: string, answer: string) => Promise<void>;
  runtimeMode: string;
  permissionMode: ApolloPermissionMode;
  onPermissionChange: (mode: ApolloPermissionMode) => void;
  surface: 'assistant' | 'entry';
  canManagePermission: boolean;
}) {
  const [input, setInput] = useState('');
  const [selectedCommand, setSelectedCommand] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const commandMenuRef = useRef<HTMLDivElement>(null);

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
    if (!trimmed || streaming) return;
    const definition = availableCommands.find((item) => item.command === trimmed.split(/\s+/, 1)[0]);
    if (definition && 'control' in definition && definition.control) onCommand(trimmed);
    else onSend(trimmed);
    setInput('');
  };

  const chooseCommand = (index: number) => {
    const item = matchingCommands[index];
    if (!item) return;
    setInput(`${item.command} `);
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-white text-[#0d0d0d]">
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 pb-40 pt-6 md:px-6 md:pb-44"
        aria-live="polite"
        aria-relevant="additions text"
      >
        {messages.length === 0 ? (
          <div className="mx-auto flex min-h-full max-w-3xl flex-col items-center justify-center pb-16 text-center">
            <h1 className="text-[24px] font-semibold leading-[30px] tracking-[-0.035em] text-[#0d0d0d]">
              {surface === 'assistant' ? '你好，我是威彦达助理' : '需要完成什么任务？'}
            </h1>
            <p className="mt-2 text-[11px] leading-[17px] text-[#777]">
              {surface === 'assistant' ? '我会持续了解你的工作习惯，协助处理日常事务。' : '描述你的需求，我会匹配合适的智能体。'}
            </p>
            <div className="mt-7 flex w-full max-w-3xl flex-col items-center gap-1.5">
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
            </div>
          </div>
        ) : (
          <div className="mx-auto w-full max-w-3xl space-y-5">
            {messages.map((message) => (
              <div
                key={message.id}
                className={message.role === 'user' ? 'flex justify-end' : 'w-full'}
              >
                {message.role === 'assistant' ? (
                  <div className="min-w-0 text-[13px] leading-5 text-[#0d0d0d]">
                    {message.steps && message.steps.length > 0 && (
                      <ProcessTimeline
                        steps={message.steps}
                        streaming={Boolean(message.streaming)}
                        onRespond={(stepId, answer) => onRespond(message.id, stepId, answer)}
                      />
                    )}

                    {message.content ? (
                      <div className="[&_.prose-chat]:h-auto [&_.prose-chat]:overflow-visible [&_.prose-chat]:p-0 [&_.prose-chat]:text-[13px] [&_.prose-chat]:leading-5">
                        <MarkdownView content={message.content} />
                      </div>
                    ) : message.streaming && (!message.steps || message.steps.every((step) => !step.pending)) ? (
                      <span className="text-[#8f8f8f]">思考中…</span>
                    ) : null}

                    {message.artifacts && message.artifacts.length > 0 && (
                      <div className="mt-4 space-y-3">
                        {message.artifacts.map((artifact) => (
                          <InlineArtifact key={artifact.id} artifact={artifact} />
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="max-w-[80%] whitespace-pre-wrap rounded-[16px] bg-[#f4f4f4] px-3.5 py-2 text-[13px] leading-5 text-[#0d0d0d]">
                    {message.content}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-white via-white to-transparent px-[10px] pb-5 pt-8 md:px-6 md:pb-10">
        <div className="pointer-events-auto relative mx-auto max-w-3xl rounded-[19px] border border-[#e5e5e5] bg-white p-2.5 shadow-[0_2px_12px_rgba(0,0,0,0.07)] transition-colors focus-within:border-[#b8b8b8]">
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
            placeholder="给威彦达发消息"
            aria-label="消息内容"
            className="block max-h-[200px] min-h-5 w-full resize-none overflow-y-auto border-0 bg-transparent px-1 text-[12px] leading-[18px] text-[#0d0d0d] outline-none placeholder:text-[#8f8f8f] focus-visible:outline-none"
          />
          {matchingCommands.length > 0 && (
            <div ref={commandMenuRef} role="listbox" className="absolute inset-x-0 bottom-full mb-2 max-h-[min(360px,calc(100dvh-180px))] touch-pan-y overflow-y-scroll overscroll-contain rounded-2xl border border-black/10 bg-white p-1.5 [scrollbar-gutter:stable] shadow-[0_12px_36px_rgba(0,0,0,0.14)]">
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
              {surface === 'assistant' && canManagePermission && <label className="flex items-center gap-1.5 text-[10px] text-[#666]">
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
                <span className="rounded-md bg-blue-50 px-1.5 py-1 text-[10px] text-blue-700">{modeLabel(runtimeMode)}</span>
              )}
            </div>
            {streaming ? (
              <button
                type="button"
                onClick={onStop}
                aria-label="停止生成"
                className="flex size-7 items-center justify-center rounded-full bg-[#0d0d0d] text-white transition-colors hover:bg-[#303030] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0d0d0d]"
              >
                <StopIcon />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => send(input)}
                aria-label="发送消息"
                disabled={!input.trim()}
                className="flex size-7 items-center justify-center rounded-full bg-[#0d0d0d] text-white transition-colors hover:bg-[#303030] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0d0d0d] disabled:cursor-default disabled:bg-[#d7d7d7]"
              >
                <SendIcon />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function InlineArtifact({ artifact }: { artifact: Artifact }) {
  const isDocument = artifact.kind === 'pdf' || artifact.kind === 'word';
  const downloadUrl = artifactDownloadUrl(artifact);
  return (
    <section data-artifact-id={artifact.id} className="overflow-hidden rounded-xl border border-[#e5e5e5] bg-white" aria-label={`产出物：${artifact.title}`}>
      <div className="flex items-center gap-2 border-b border-[#ececec] bg-[#fafafa] px-3 py-2 text-[11px]">
        <span className="text-[#666]"><FileIcon /></span>
        <span className="min-w-0 flex-1 truncate font-medium text-[#303030]">{artifact.title}</span>
        {Boolean(artifact.meta?.path) && <span className="text-[10px] text-emerald-600" title={String(artifact.meta?.path)}>已保存</span>}
        <span className="uppercase text-[#8f8f8f]">{artifact.kind}</span>
        {downloadUrl && (
          <a href={downloadUrl} download={artifact.title} className="text-[#555] underline-offset-2 hover:underline">下载</a>
        )}
      </div>
      <div className={isDocument ? 'h-[520px] max-h-[65vh]' : 'max-h-[520px] overflow-auto'}>
        <ArtifactBody artifact={artifact} />
      </div>
    </section>
  );
}

function artifactDownloadUrl(artifact: Artifact): string | undefined {
  if (artifact.url) return artifact.url;
  if (!artifact.content) return undefined;
  if (artifact.kind === 'word') {
    return `data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,${artifact.content}`;
  }
  const mime = artifact.kind === 'json' ? 'application/json' : 'text/markdown';
  return `data:${mime};charset=utf-8,${encodeURIComponent(artifact.content)}`;
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

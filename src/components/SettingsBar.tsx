import { useEffect, useState } from 'react';
import {
  deleteApolloMemory,
  getApolloConfig,
  listApolloMemories,
  saveApolloConfig,
  saveApolloMemory,
} from '@/lib/apolloAgent';
import type { ApolloMemory, ApolloPermissionMode } from '@/lib/apolloAgent';
import { useDismissDetails } from '@/lib/useDismissDetails';
import type { BrowserConnectionStatus } from '@/lib/browserExtension';

export default function SettingsBar({
  apolloPermissionMode,
  canManageConfig = true,
  workspaceLabel,
  onWorkspaceToggle,
  browserStatus,
  onRefreshBrowser,
}: {
  apolloPermissionMode: ApolloPermissionMode;
  canManageConfig?: boolean;
  workspaceLabel: string;
  onWorkspaceToggle: () => void;
  browserStatus: BrowserConnectionStatus;
  onRefreshBrowser: () => void;
}) {
  const detailsRef = useDismissDetails();

  return (
    <header className="relative flex h-12 shrink-0 items-center justify-between bg-white pl-12 pr-3 lg:px-3">
      <WorkspaceLocation label={workspaceLabel} onToggle={onWorkspaceToggle} />

      <details ref={detailsRef} className="group relative z-30">
        <summary
          aria-label="打开设置"
          className="flex h-8 w-8 cursor-pointer list-none items-center justify-center rounded-lg text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2 [&::-webkit-details-marker]:hidden"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-[18px] w-[18px]">
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.3 2.9h3.4l.5 2a7.5 7.5 0 0 1 1.5.9l2-.6 1.7 3-1.5 1.4a7.4 7.4 0 0 1 0 1.8l1.5 1.4-1.7 3-2-.6a7.5 7.5 0 0 1-1.5.9l-.5 2h-3.4l-.5-2a7.5 7.5 0 0 1-1.5-.9l-2 .6-1.7-3 1.5-1.4a7.4 7.4 0 0 1 0-1.8L4.6 8.2l1.7-3 2 .6a7.5 7.5 0 0 1 1.5-.9l.5-2Z" />
            <circle cx="12" cy="10.5" r="2.5" />
          </svg>
        </summary>
          <div className="absolute right-0 z-30 mt-2 max-h-[calc(100dvh-5rem)] w-[min(24rem,calc(100vw-1.5rem))] overflow-y-auto rounded-2xl border border-black/[0.08] bg-white p-4 shadow-[0_18px_48px_rgba(0,0,0,0.12)]">
            <h2 className="mb-3 text-[13px] font-semibold text-gray-900">设置</h2>
            <BrowserConnection status={browserStatus} onRefresh={onRefreshBrowser} />
            <ApolloPanel permissionMode={apolloPermissionMode} canManageConfig={canManageConfig} />
          </div>
      </details>
    </header>
  );
}

function BrowserConnection({ status, onRefresh }: { status: BrowserConnectionStatus; onRefresh: () => void }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3 rounded-xl bg-gray-50 px-3 py-2 text-[11px]">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 font-medium text-gray-700">
          <span className={`h-1.5 w-1.5 rounded-full ${status.connected ? 'bg-emerald-500' : 'bg-gray-300'}`} />
          浏览器扩展{status.connected ? '已连接' : '未连接'}
        </div>
        <p className="mt-0.5 truncate text-[10px] text-gray-400" title={status.tab?.url ?? status.error}>
          {status.tab?.title || status.error || (status.connected ? '点击扩展图标选择目标标签页' : '安装扩展后可操作当前 Chrome')}
        </p>
      </div>
      <button type="button" onClick={onRefresh} className="shrink-0 rounded-lg px-2 py-1 text-gray-500 hover:bg-white hover:text-gray-900">检测</button>
    </div>
  );
}

function WorkspaceLocation({ label, onToggle }: { label: string; onToggle: () => void }) {
  return (
    <div className="flex min-w-0 items-center gap-2 text-[#555]" title={`Agent 工作目录：${label}`}>
      <button type="button" onClick={onToggle} className="icon-button inline-flex size-7" aria-label={`切换工作目录，当前：${label}`} title="切换远端/本地目录">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true"><path d="M3.5 6.5h6l2 2h9v9.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2V6.5Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /></svg>
      </button>
      <span className="max-w-40 truncate text-[12px] font-medium text-[#303030]">{label}</span>
    </div>
  );
}

function ApolloPanel({ permissionMode, canManageConfig }: { permissionMode: ApolloPermissionMode; canManageConfig: boolean }) {
  const [tab, setTab] = useState<'config' | 'memory'>(canManageConfig ? 'config' : 'memory');

  return (
    <div>
      <div className="mb-3 flex gap-1 rounded-xl bg-gray-100 p-1 text-[11px]">
        {([...(canManageConfig ? [['config', '配置'] as const] : []), ['memory', '记忆'] as const]).map(([value, label]) => (
          <button key={value} type="button" onClick={() => setTab(value)} className={`flex-1 rounded-lg px-3 py-1.5 transition-colors ${tab === value ? 'bg-white font-medium text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-900'}`}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'config' && canManageConfig ? <ApolloConfigPanel permissionMode={permissionMode} /> : <MemoryPanel />}
    </div>
  );
}

function ApolloConfigPanel({ permissionMode }: { permissionMode: ApolloPermissionMode }) {
  const [config, setConfig] = useState('');
  const [configPath, setConfigPath] = useState('当前用户/.apollo/assistant-config.json');
  const [state, setState] = useState<'loading' | 'idle' | 'saving' | 'saved' | 'error'>('loading');
  const [error, setError] = useState('');

  useEffect(() => {
    getApolloConfig()
      .then((result) => {
        setConfigPath(result.path);
        setConfig(result.config);
        setState('idle');
      })
      .catch((reason) => {
        setError(reason instanceof Error ? reason.message : String(reason));
        setState('error');
      });
  }, []);

  useEffect(() => {
    setConfig((current) => {
      if (!current) return current;
      try {
        const parsed = JSON.parse(current) as Record<string, unknown>;
        const permissions = typeof parsed.permissions === 'object' && parsed.permissions
          ? parsed.permissions as Record<string, unknown>
          : {};
        if (permissions.mode === permissionMode) return current;
        parsed.permissions = { ...permissions, mode: permissionMode, autoApproveReadOnly: true };
        return JSON.stringify(parsed, null, 2);
      } catch {
        return current;
      }
    });
  }, [permissionMode]);

  const save = async () => {
    setState('saving');
    setError('');
    try {
      await saveApolloConfig(config);
      setState('saved');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setState('error');
    }
  };

  return (
    <div className="space-y-2 text-[11px]">
      <label htmlFor="apollo-config" className="block font-medium text-gray-600">
        Apollo 配置
      </label>
      <textarea
        id="apollo-config"
        value={config}
        disabled={state === 'loading'}
        onChange={(event) => {
          setConfig(event.target.value);
          setState('idle');
        }}
        spellCheck={false}
        rows={10}
        className="w-full resize-y rounded-lg border border-gray-300 bg-white px-2.5 py-2 font-mono text-[10px] leading-4 text-gray-800 outline-none focus:border-gray-500 focus:ring-2 focus:ring-gray-200"
      />
      <div className="flex items-center justify-between gap-3">
        <span className="truncate text-[10px] text-gray-400" title={configPath}>{configPath}</span>
        <button
          type="button"
          onClick={save}
          disabled={state === 'loading' || state === 'saving'}
          className="shrink-0 rounded-lg bg-gray-900 px-3 py-1.5 font-medium text-white transition-colors hover:bg-gray-700 disabled:cursor-default disabled:bg-gray-300"
        >
          {state === 'saving' ? '保存中…' : '保存配置'}
        </button>
      </div>
      {state === 'saved' && <p className="text-emerald-600">已保存，下次消息自动使用新配置。</p>}
      {state === 'error' && <p className="text-red-500">{error}</p>}
    </div>
  );
}

const emptyMemory = { title: '', content: '', tags: [] as string[] };

function MemoryPanel() {
  const [memories, setMemories] = useState<ApolloMemory[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [draft, setDraft] = useState(emptyMemory);
  const [tags, setTags] = useState('');
  const [state, setState] = useState<'loading' | 'idle' | 'saving' | 'error'>('loading');
  const [error, setError] = useState('');

  useEffect(() => {
    listApolloMemories()
      .then((items) => {
        setMemories(items);
        const first = items[0];
        if (first) {
          setSelectedId(first.id);
          setDraft({ title: first.title, content: first.content, tags: first.tags });
          setTags(first.tags.join(', '));
        }
        setState('idle');
      })
      .catch((reason) => {
        setError(reason instanceof Error ? reason.message : String(reason));
        setState('error');
      });
  }, []);

  const select = (memory?: ApolloMemory) => {
    setSelectedId(memory?.id);
    setDraft(memory ? { title: memory.title, content: memory.content, tags: memory.tags } : emptyMemory);
    setTags(memory?.tags.join(', ') ?? '');
    setError('');
  };

  const save = async () => {
    if (!draft.title.trim() || !draft.content.trim()) {
      setError('请填写标题和记忆内容');
      return;
    }
    setState('saving');
    setError('');
    try {
      const saved = await saveApolloMemory({
        id: selectedId,
        title: draft.title.trim(),
        content: draft.content.trim(),
        tags: tags.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean),
      });
      setMemories((items) => [saved, ...items.filter((item) => item.id !== saved.id)]);
      select(saved);
      setState('idle');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setState('error');
    }
  };

  const remove = async () => {
    if (!selectedId || !window.confirm('确定删除这条记忆吗？')) return;
    try {
      await deleteApolloMemory(selectedId);
      const remaining = memories.filter((item) => item.id !== selectedId);
      setMemories(remaining);
      select(remaining[0]);
      setState('idle');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setState('error');
    }
  };

  return (
    <div className="space-y-3 text-[11px]">
      <div><span className="font-medium text-gray-600">当前助理记忆</span><p className="mt-1 text-[10px] leading-4 text-gray-400">这里显示助理已经保存的长期记忆，修改后会直接影响后续对话。</p></div>
      {state === 'loading' ? <p className="py-5 text-center text-gray-400">正在读取记忆…</p> : (
        <>
          {memories.length > 0 && (
            <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
              {memories.map((memory) => <button type="button" key={memory.id} onClick={() => select(memory)} className={`rounded-lg px-2.5 py-1.5 text-left ${selectedId === memory.id ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>{memory.title}</button>)}
            </div>
          )}
          {selectedId ? <>
            <input value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} aria-label="记忆标题" className="w-full rounded-lg border border-gray-300 px-2.5 py-2 outline-none focus:border-gray-500 focus:ring-2 focus:ring-gray-200" />
            <input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="标签，用逗号分隔（可选）" aria-label="记忆标签" className="w-full rounded-lg border border-gray-300 px-2.5 py-2 outline-none focus:border-gray-500 focus:ring-2 focus:ring-gray-200" />
            <textarea value={draft.content} onChange={(event) => setDraft((current) => ({ ...current, content: event.target.value }))} aria-label="记忆内容" rows={8} className="w-full resize-y rounded-lg border border-gray-300 px-2.5 py-2 leading-4 outline-none focus:border-gray-500 focus:ring-2 focus:ring-gray-200" />
            <div className="flex justify-end gap-2"><button type="button" onClick={remove} className="rounded-lg px-3 py-1.5 text-red-600 hover:bg-red-50">删除</button><button type="button" onClick={save} disabled={state === 'saving'} className="rounded-lg bg-gray-900 px-3 py-1.5 font-medium text-white hover:bg-gray-700 disabled:bg-gray-300">{state === 'saving' ? '保存中…' : '保存修改'}</button></div>
          </> : <p className="rounded-xl bg-gray-50 px-3 py-5 text-center text-[10px] leading-4 text-gray-400">当前助理还没有长期记忆。你可以在对话中告诉助理“请记住……”，保存后会显示在这里。</p>}
        </>
      )}
      {error && <p className="text-red-500">{error}</p>}
    </div>
  );
}

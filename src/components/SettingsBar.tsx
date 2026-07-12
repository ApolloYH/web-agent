import { useEffect, useState } from 'react';
import type { BackendMode, NoumiSettings } from '@/lib/settings';
import { listNoumiProjects } from '@/lib/noumiAgent';
import { getApolloConfig, saveApolloConfig } from '@/lib/apolloAgent';
import type { ApolloPermissionMode } from '@/lib/apolloAgent';
import { useDismissDetails } from '@/lib/useDismissDetails';

export default function SettingsBar({
  backend,
  noumi,
  onChangeBackend,
  onChangeNoumi,
  apolloPermissionMode,
  allowBackendSelection = true,
}: {
  backend: BackendMode;
  noumi: NoumiSettings;
  onChangeBackend: (v: BackendMode) => void;
  onChangeNoumi: (v: NoumiSettings) => void;
  apolloPermissionMode: ApolloPermissionMode;
  allowBackendSelection?: boolean;
}) {
  const detailsRef = useDismissDetails();
  const badge =
    backend === 'apollo'
      ? { text: '本地智能体', dot: 'bg-emerald-500' }
      : { text: 'Noumi', dot: 'bg-emerald-500' };

  return (
    <header className="relative flex h-12 shrink-0 items-center justify-between bg-white pl-12 pr-3 lg:px-3">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="text-[12px] font-semibold tracking-tight text-gray-900">威彦达</span>
        <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-gray-500">
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${badge.dot}`} aria-hidden="true" />
          <span className="truncate">{badge.text}</span>
        </span>
      </div>

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
          <div className="absolute right-0 z-30 mt-2 w-[min(24rem,calc(100vw-1.5rem))] rounded-2xl border border-black/[0.08] bg-white p-4 shadow-[0_18px_48px_rgba(0,0,0,0.12)]">
            <h2 className="mb-3 text-[13px] font-semibold text-gray-900">设置</h2>
            {/* 后端模式选择 */}
            {allowBackendSelection && <div className="mb-3">
              <span className="text-[11px] font-medium text-gray-600">后端模式</span>
              <div className="mt-2 grid grid-cols-2 gap-1 rounded-xl bg-gray-100 p-1 text-[11px]">
                {(
                  [
                    ['apollo', '本地'],
                    ['noumi', 'Noumi'],
                  ] as [BackendMode, string][]
                ).map(([v, label]) => (
                  <button
                    key={v}
                    onClick={() => onChangeBackend(v)}
                    className={`min-w-0 rounded-lg px-1.5 py-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 ${
                      backend === v ? 'bg-white font-medium text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-900'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>}

            {backend === 'noumi' && <NoumiPanel noumi={noumi} onChange={onChangeNoumi} />}

            {backend === 'apollo' && (
              <ApolloPanel permissionMode={apolloPermissionMode} />
            )}
          </div>
      </details>
    </header>
  );
}

function ApolloPanel({ permissionMode }: { permissionMode: ApolloPermissionMode }) {
  const [config, setConfig] = useState('');
  const [configPath, setConfigPath] = useState('.apollo/config.json');
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

function NoumiPanel({
  noumi,
  onChange,
}: {
  noumi: NoumiSettings;
  onChange: (v: NoumiSettings) => void;
}) {
  const [projects, setProjects] = useState<{ id: string; topics: { id: string; name: string }[] }[]>(
    [],
  );
  const [loadState, setLoadState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [err, setErr] = useState('');

  // 有 baseUrl + apiKey 时，自动拉项目列表供选择
  useEffect(() => {
    if (!noumi.baseUrl || !noumi.apiKey) return;
    let cancelled = false;
    const ctrl = new AbortController();
    setLoadState('loading');
    setErr('');
    listNoumiProjects({ baseUrl: noumi.baseUrl, apiKey: noumi.apiKey }, ctrl.signal)
      .then((ps) => {
        if (cancelled) return;
        setProjects(ps);
        setLoadState('idle');
      })
      .catch((e) => {
        if (cancelled) return;
        setErr(e instanceof Error ? e.message : String(e));
        setLoadState('error');
      });
    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, [noumi.baseUrl, noumi.apiKey]);

  const topics = projects.find((p) => p.id === noumi.projectId)?.topics ?? [];

  return (
    <div className="space-y-2 text-[12px]">
      <Field
        label="Base URL"
        value={noumi.baseUrl}
        onChange={(v) => onChange({ ...noumi, baseUrl: v })}
        placeholder="https://www.langhub.cn/api/external/v1"
      />
      <Field
        label="API Key"
        value={noumi.apiKey}
        onChange={(v) => onChange({ ...noumi, apiKey: v })}
        placeholder="nim_..."
        type="password"
      />

      <label className="block">
        <span className="text-gray-500">项目</span>
        {projects.length > 0 ? (
          <select
            value={noumi.projectId}
            onChange={(e) => onChange({ ...noumi, projectId: e.target.value, topicId: '' })}
            className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-2.5 py-2 outline-none focus:border-gray-500 focus:ring-2 focus:ring-gray-200"
          >
            <option value="">（选择项目）</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.id}
              </option>
            ))}
          </select>
        ) : (
          <input
            value={noumi.projectId}
            placeholder="项目 id，如 yh-文件生成"
            onChange={(e) => onChange({ ...noumi, projectId: e.target.value })}
            className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-2.5 py-2 outline-none focus:border-gray-500 focus:ring-2 focus:ring-gray-200"
          />
        )}
      </label>

      <label className="block">
        <span className="text-gray-500">话题（留空自动新建）</span>
        {topics.length > 0 ? (
          <select
            value={noumi.topicId}
            onChange={(e) => onChange({ ...noumi, topicId: e.target.value })}
            className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-2.5 py-2 outline-none focus:border-gray-500 focus:ring-2 focus:ring-gray-200"
          >
            <option value="">（新建临时话题）</option>
            {topics.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}（{t.id}）
              </option>
            ))}
          </select>
        ) : (
          <input
            value={noumi.topicId}
            placeholder="话题 id，留空自动新建"
            onChange={(e) => onChange({ ...noumi, topicId: e.target.value })}
            className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-2.5 py-2 outline-none focus:border-gray-500 focus:ring-2 focus:ring-gray-200"
          />
        )}
      </label>

      {loadState === 'loading' && <p className="text-[11px] text-gray-400">正在加载项目列表…</p>}
      {loadState === 'error' && <p className="text-[11px] text-red-500">加载项目失败：{err}</p>}
      <p className="text-[11px] leading-4 text-gray-400">
        直连 langhub.cn。密钥仅存于本机浏览器，请勿在公开环境使用。
      </p>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="text-gray-500">{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-2.5 py-2 outline-none focus:border-gray-500 focus:ring-2 focus:ring-gray-200"
      />
    </label>
  );
}

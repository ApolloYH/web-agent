import { useEffect, useRef, useState } from 'react';
import {
  deleteApolloMemory,
  getApolloConfig,
  getImSettings,
  listApolloMemories,
  pollWeixinLogin,
  saveApolloConfig,
  saveImChannel,
  saveApolloMemory,
  saveTelegramSettings,
  startWeixinLogin,
  verifyWeixinLogin,
} from '@/lib/apolloAgent';
import type { ApolloMemory, ApolloPermissionMode, ImChannelSettings, WeixinLoginState } from '@/lib/apolloAgent';
import type { BrowserConnectionStatus } from '@/lib/browserExtension';

export default function SettingsBar({
  workspaceLabel,
  onWorkspaceToggle,
}: {
  workspaceLabel: string;
  onWorkspaceToggle: () => void;
}) {
  return (
    <header className="relative flex h-12 shrink-0 items-center bg-white pl-12 pr-3 lg:px-3">
      <WorkspaceLocation label={workspaceLabel} onToggle={onWorkspaceToggle} />
    </header>
  );
}

export function UserCenterDialog({ username, admin, permissionMode, browserStatus, onRefreshBrowser, onClose, onLogout }: {
  username: string;
  admin: boolean;
  permissionMode: ApolloPermissionMode;
  browserStatus: BrowserConnectionStatus;
  onRefreshBrowser: () => void;
  onClose: () => void;
  onLogout: () => void;
}) {
  useEffect(() => {
    const close = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [onClose]);
  return (
    <div className="app-overlay-motion fixed inset-0 z-[70] flex items-center justify-center bg-black/25 p-4" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section role="dialog" aria-modal="true" aria-labelledby="user-center-title" className="app-dialog-motion flex max-h-[min(760px,calc(100dvh-2rem))] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-black/[0.08] bg-white shadow-[0_28px_90px_rgba(0,0,0,0.2)]">
        <header className="flex items-center justify-between border-b border-black/[0.06] px-5 py-4">
          <div><h2 id="user-center-title" className="text-[16px] font-semibold text-gray-900">用户中心</h2><p className="mt-0.5 text-[10px] text-gray-400">账号、连接与 Apollo 通用设置</p></div>
          <button autoFocus type="button" onClick={onClose} aria-label="关闭用户中心" className="flex size-8 items-center justify-center rounded-lg text-xl text-gray-400 hover:bg-gray-100 hover:text-gray-700">×</button>
        </header>
        <div className="min-h-0 overflow-y-auto p-5">
          <div className="mb-4 flex items-center gap-3 rounded-xl border border-black/[0.07] p-3">
            <span className="flex size-10 items-center justify-center rounded-full bg-gray-100 text-[14px] font-semibold text-gray-600">{username.slice(0, 1).toUpperCase()}</span>
            <div className="min-w-0 flex-1"><p className="truncate text-[12px] font-semibold text-gray-800">{username}</p><p className="mt-0.5 text-[10px] text-gray-400">{admin ? '管理员' : '成员'}</p></div>
            <button type="button" onClick={onLogout} className="rounded-lg px-3 py-2 text-[11px] text-red-600 hover:bg-red-50">退出登录</button>
          </div>
          <BrowserConnection status={browserStatus} onRefresh={onRefreshBrowser} />
          <ApolloPanel permissionMode={permissionMode} canManageConfig={admin} />
        </div>
      </section>
    </div>
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
  const [tab, setTab] = useState<'config' | 'memory' | 'im'>('im');

  return (
    <div>
      <div className="mb-3 flex gap-1 rounded-xl bg-gray-100 p-1 text-[11px]">
        {([['im', 'IM 接入'] as const, ['memory', '记忆'] as const, ...(canManageConfig ? [['config', '高级'] as const] : [])]).map(([value, label]) => (
          <button key={value} type="button" onClick={() => setTab(value)} className={`flex-1 rounded-lg px-3 py-1.5 transition-colors ${tab === value ? 'bg-white font-medium text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-900'}`}>
            {label}
          </button>
        ))}
      </div>
      <div key={tab} className="app-state-motion">
        {tab === 'im' ? <ImChannelsPanel /> : tab === 'config' && canManageConfig ? <ApolloConfigPanel permissionMode={permissionMode} /> : <MemoryPanel />}
      </div>
    </div>
  );
}

type ImPlatform = keyof ImChannelSettings;
type ImDraft = { enabled: boolean; identifier: string; secret: string; allowedUsers: string };

const imLabels: Record<ImPlatform, string> = {
  feishu: '飞书',
  wecom: '企业微信',
  dingtalk: '钉钉',
  weixin: '微信',
  telegram: 'Telegram',
};

function ImChannelsPanel() {
  const [selected, setSelected] = useState<ImPlatform>('feishu');
  const [channels, setChannels] = useState<ImChannelSettings>();
  const [drafts, setDrafts] = useState<Record<ImPlatform, ImDraft>>();
  const [state, setState] = useState<'loading' | 'idle' | 'saving' | 'login'>('loading');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [login, setLogin] = useState<WeixinLoginState>();
  const [verifyCode, setVerifyCode] = useState('');
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    getImSettings()
      .then((settings) => {
        setChannels(settings);
        setDrafts({
          telegram: { enabled: settings.telegram.enabled, identifier: '', secret: '', allowedUsers: settings.telegram.allowedUserIds.join(', ') },
          feishu: { enabled: settings.feishu.enabled, identifier: settings.feishu.appId, secret: '', allowedUsers: settings.feishu.allowedUserIds.join(', ') },
          wecom: { enabled: settings.wecom.enabled, identifier: settings.wecom.botId, secret: '', allowedUsers: settings.wecom.allowedUserIds.join(', ') },
          dingtalk: { enabled: settings.dingtalk.enabled, identifier: settings.dingtalk.clientId, secret: '', allowedUsers: settings.dingtalk.allowedUserIds.join(', ') },
          weixin: { enabled: settings.weixin.enabled, identifier: settings.weixin.accountId, secret: '', allowedUsers: settings.weixin.allowedUserIds.join(', ') },
        });
        setState('idle');
      })
      .catch((reason) => {
        setError(reason instanceof Error ? reason.message : String(reason));
        setState('idle');
      });
    return () => { mounted.current = false; };
  }, []);

  const updateDraft = (patch: Partial<ImDraft>) => {
    setDrafts((current) => current ? { ...current, [selected]: { ...current[selected], ...patch } } : current);
  };

  const save = async () => {
    if (!drafts || !channels) return;
    const platform = selected;
    const draft = drafts[platform];
    const allowedUserIds = draft.allowedUsers.split(/[,，\s]+/).map((value) => value.trim()).filter(Boolean);
    setState('saving');
    setError('');
    setNotice('');
    try {
      let saved: ImChannelSettings[ImPlatform];
      if (platform === 'telegram') {
        saved = await saveTelegramSettings({ enabled: draft.enabled, ...(draft.secret.trim() ? { token: draft.secret.trim() } : {}), allowedUserIds });
      } else if (platform === 'feishu') {
        saved = await saveImChannel('feishu', { enabled: draft.enabled, appId: draft.identifier, ...(draft.secret.trim() ? { appSecret: draft.secret.trim() } : {}), allowedUserIds });
      } else if (platform === 'wecom') {
        saved = await saveImChannel('wecom', { enabled: draft.enabled, botId: draft.identifier, ...(draft.secret.trim() ? { secret: draft.secret.trim() } : {}), allowedUserIds });
      } else if (platform === 'dingtalk') {
        saved = await saveImChannel('dingtalk', { enabled: draft.enabled, clientId: draft.identifier, ...(draft.secret.trim() ? { clientSecret: draft.secret.trim() } : {}), allowedUserIds });
      } else {
        saved = await saveImChannel('weixin', { enabled: draft.enabled, allowedUserIds });
      }
      setChannels((current) => current ? { ...current, [platform]: saved } as ImChannelSettings : current);
      setDrafts((current) => current ? { ...current, [platform]: { ...current[platform], secret: '' } } : current);
      setNotice(draft.enabled ? `已保存，Apollo 正在${imLabels[platform]}中等待消息。` : `已停用${imLabels[platform]}接入。`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setState('idle');
    }
  };

  const startLogin = async () => {
    setState('login');
    setError('');
    setNotice('');
    try {
      const started = await startWeixinLogin();
      setLogin(started);
      while (mounted.current) {
        const next = await pollWeixinLogin();
        if (!mounted.current) return;
        setLogin(next);
        if (next.settings) {
          setChannels((current) => current ? { ...current, weixin: next.settings! } : current);
          setDrafts((current) => current ? { ...current, weixin: { ...current.weixin, enabled: true, identifier: next.settings!.accountId, allowedUsers: next.settings!.allowedUserIds.join(', ') } } : current);
          setNotice('微信已连接，扫码账号已自动加入白名单。');
          break;
        }
        if (['need_verifycode', 'verify_code_blocked', 'expired', 'binded_redirect'].includes(next.status)) break;
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (mounted.current) setState('idle');
    }
  };

  const submitVerify = async () => {
    setError('');
    try {
      await verifyWeixinLogin(verifyCode.trim());
      setVerifyCode('');
      await startLoginPolling();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const startLoginPolling = async () => {
    setState('login');
    try {
      while (mounted.current) {
        const next = await pollWeixinLogin();
        if (!mounted.current) return;
        setLogin(next);
        if (next.settings) {
          setChannels((current) => current ? { ...current, weixin: next.settings! } : current);
          setDrafts((current) => current ? { ...current, weixin: { ...current.weixin, enabled: true, identifier: next.settings!.accountId, allowedUsers: next.settings!.allowedUserIds.join(', ') } } : current);
          setNotice('微信已连接，扫码账号已自动加入白名单。');
          break;
        }
        if (['need_verifycode', 'verify_code_blocked', 'expired', 'binded_redirect'].includes(next.status)) break;
      }
    } finally {
      if (mounted.current) setState('idle');
    }
  };

  if (state === 'loading' || !channels || !drafts) return <p className="py-8 text-center text-[11px] text-gray-400">正在读取 IM 配置…</p>;
  const draft = drafts[selected];
  const channel = channels[selected];
  const status = channel.status.state === 'connected'
    ? { dot: 'bg-emerald-500', text: '已连接' }
    : channel.status.state === 'connecting'
      ? { dot: 'bg-amber-400', text: '正在连接' }
      : channel.status.state === 'error'
        ? { dot: 'bg-red-500', text: '连接异常' }
        : { dot: 'bg-gray-300', text: '未连接' };

  const identifiers = {
    feishu: { label: 'App ID', placeholder: 'cli_xxx' },
    wecom: { label: 'Bot ID', placeholder: '企业微信智能机器人 ID' },
    dingtalk: { label: 'Client ID', placeholder: '钉钉应用 AppKey' },
  } as const;
  const secrets = {
    telegram: { label: 'Bot Token', configured: channels.telegram.tokenConfigured, placeholder: '从 @BotFather 获取' },
    feishu: { label: 'App Secret', configured: channels.feishu.secretConfigured, placeholder: '飞书应用凭据' },
    wecom: { label: 'Secret', configured: channels.wecom.secretConfigured, placeholder: '企业微信机器人 Secret' },
    dingtalk: { label: 'Client Secret', configured: channels.dingtalk.secretConfigured, placeholder: '钉钉应用 AppSecret' },
  } as const;

  return (
    <div key={selected} className="app-state-motion space-y-3 text-[11px]">
      <div className="grid grid-cols-3 gap-1 rounded-xl bg-gray-100 p-1">
        {(Object.keys(imLabels) as ImPlatform[]).map((platform) => (
          <button key={platform} type="button" onClick={() => { setSelected(platform); setError(''); setNotice(''); }} className={`rounded-lg px-2 py-1.5 transition-all ${selected === platform ? 'bg-white font-medium text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800'}`}>
            {imLabels[platform]}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between rounded-xl border border-black/[0.07] px-3 py-2.5">
        <div>
          <div className="flex items-center gap-1.5 font-medium text-gray-800"><span className={`h-1.5 w-1.5 rounded-full ${status.dot}`} />{imLabels[selected]}</div>
          <p className="mt-0.5 text-[10px] text-gray-400">{selected === 'telegram' && channels.telegram.botUsername ? `@${channels.telegram.botUsername} · ${status.text}` : selected === 'weixin' && channels.weixin.accountId ? `${channels.weixin.accountId} · ${status.text}` : status.text}</p>
        </div>
        <button type="button" role="switch" aria-checked={draft.enabled} onClick={() => updateDraft({ enabled: !draft.enabled })} className={`relative h-5 w-9 rounded-full transition-colors ${draft.enabled ? 'bg-gray-900' : 'bg-gray-200'}`}>
          <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${draft.enabled ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
        </button>
      </div>

      {selected === 'weixin' ? (
        <div className="rounded-xl bg-gray-50 p-3 text-center">
          {login?.qrDataUrl ? <img src={login.qrDataUrl} alt="微信连接二维码" className="mx-auto h-40 w-40 rounded-xl bg-white p-2 shadow-sm" /> : null}
          <p className="mt-2 font-medium text-gray-700">{login?.message ?? (channels.weixin.connectedAccount ? '微信已完成扫码连接' : '使用手机微信扫码连接 Apollo')}</p>
          {login?.status === 'need_verifycode' ? (
            <div className="mx-auto mt-2 flex max-w-56 gap-2">
              <input inputMode="numeric" value={verifyCode} onChange={(event) => setVerifyCode(event.target.value)} placeholder="输入配对码" className="min-w-0 flex-1 rounded-lg border border-gray-300 px-2 py-1.5 outline-none focus:border-gray-500" />
              <button type="button" onClick={submitVerify} className="rounded-lg bg-gray-900 px-3 text-white">确认</button>
            </div>
          ) : (
            <button type="button" onClick={startLogin} disabled={state !== 'idle'} className="mt-2 rounded-lg border border-gray-300 bg-white px-3 py-1.5 font-medium text-gray-700 hover:border-gray-400 disabled:text-gray-300">{state === 'login' ? '等待扫码…' : channels.weixin.connectedAccount ? '重新扫码' : '获取二维码'}</button>
          )}
        </div>
      ) : (
        <>
          {selected !== 'telegram' ? <Field label={identifiers[selected].label} value={draft.identifier} onChange={(identifier) => updateDraft({ identifier })} placeholder={identifiers[selected].placeholder} /> : null}
          <Field label={secrets[selected].label} type="password" value={draft.secret} onChange={(secret) => updateDraft({ secret })} placeholder={secrets[selected].configured ? '已安全保存，留空表示不修改' : secrets[selected].placeholder} />
        </>
      )}

      <label className="block font-medium text-gray-600" htmlFor="im-allowed-users">允许使用的用户 ID</label>
      <input
        id="im-allowed-users"
        value={draft.allowedUsers}
        onChange={(event) => updateDraft({ allowedUsers: event.target.value })}
        placeholder={selected === 'feishu' ? '飞书 Open ID，多个用逗号分隔' : selected === 'dingtalk' ? '钉钉 Staff ID，多个用逗号分隔' : '用户 ID，多个用逗号分隔'}
        className="w-full rounded-lg border border-gray-300 px-2.5 py-2 outline-none focus:border-gray-500 focus:ring-2 focus:ring-gray-200"
      />
      <p className="text-[10px] leading-4 text-gray-400">默认拒绝白名单之外的消息。企业平台使用官方长连接，无需配置公网回调；微信扫码账号会自动加入白名单。</p>

      <div className="flex justify-end gap-2">
        <button type="button" onClick={save} disabled={state !== 'idle'} className="rounded-lg bg-gray-900 px-3 py-1.5 font-medium text-white hover:bg-gray-700 disabled:bg-gray-300">{state === 'saving' ? '保存中…' : '保存'}</button>
      </div>
      {notice && <p className="text-emerald-600">{notice}</p>}
      {(error || channel.status.error) && <p className="text-red-500">{error || channel.status.error}</p>}
    </div>
  );
}

function Field({ label, value, onChange, placeholder, type = 'text' }: { label: string; value: string; onChange: (value: string) => void; placeholder: string; type?: 'text' | 'password' }) {
  const id = `im-${label.toLowerCase().replace(/\s+/g, '-')}`;
  return (
    <label className="block space-y-1.5 font-medium text-gray-600" htmlFor={id}>
      <span>{label}</span>
      <input id={id} type={type} autoComplete="off" value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="w-full rounded-lg border border-gray-300 px-2.5 py-2 font-normal outline-none focus:border-gray-500 focus:ring-2 focus:ring-gray-200" />
    </label>
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

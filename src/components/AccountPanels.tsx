import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  changePassword,
  getAccountProfile,
  getAdminOverview,
  updateManagedUser,
  type AccountProfile,
  type AdminOverview,
  type ManagedUser,
} from '@/lib/auth';
import type { BrowserConnectionStatus } from '@/lib/browserExtension';

export function AccountOverview({ username, admin, browserStatus, onRefreshBrowser, onLogout }: {
  username: string;
  admin: boolean;
  browserStatus: BrowserConnectionStatus;
  onRefreshBrowser: () => void;
  onLogout: () => void;
}) {
  const [profile, setProfile] = useState<AccountProfile>();
  const [error, setError] = useState('');
  useEffect(() => {
    getAccountProfile().then(setProfile).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, []);

  const quotaPercent = profile?.storageQuotaBytes
    ? Math.min(100, Math.round(profile.storageUsedBytes / profile.storageQuotaBytes * 100))
    : 0;

  return (
    <div className="space-y-5">
      <section className="flex flex-col gap-4 border-b border-black/[0.07] pb-5 sm:flex-row sm:items-center">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-[#ececec] text-[16px] font-semibold text-[#414141]">{username.slice(0, 1).toUpperCase()}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-[16px] font-semibold tracking-[-0.02em] text-[#171717]">{username}</h3>
            <span className="rounded-md bg-[#f0f0f0] px-1.5 py-0.5 text-[9px] font-medium text-[#555]">{admin ? '管理员' : '成员'}</span>
          </div>
          <p className="mt-1 text-[10px] text-[#777]">{profile ? `加入于 ${formatDate(profile.createdAt)} · ${profile.lastActiveAt ? `最近活动 ${formatRelative(profile.lastActiveAt)}` : '尚未运行任务'} · ${profile.sessionCount} 个有效登录` : '正在读取账号信息…'}</p>
        </div>
        <button type="button" onClick={onLogout} className="h-8 cursor-pointer self-start border border-red-200 px-3 text-[10px] font-medium text-red-600 transition-colors hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500 sm:self-auto">退出登录</button>
      </section>

      {error ? <Notice tone="error">{error}</Notice> : (
        <div className="grid grid-cols-2 border border-black/[0.08] sm:grid-cols-4">
          <Stat label="对话" value={profile?.conversationCount} />
          <Stat label="任务" value={profile?.runCount} />
          <Stat label="已完成" value={profile?.successfulRuns} />
          <Stat label="失败" value={profile?.failedRuns} last />
        </div>
      )}

      <section>
        <SectionTitle title="存储空间" description={profile?.storageQuotaBytes ? `${formatBytes(profile.storageUsedBytes)} / ${formatBytes(profile.storageQuotaBytes)}` : `${formatBytes(profile?.storageUsedBytes ?? 0)} · 不限额`} />
        <div className="mt-2 h-1.5 overflow-hidden bg-[#ededed]" aria-label={`存储空间已使用 ${quotaPercent}%`}>
          <div className="h-full bg-[#2563eb] transition-[width] duration-300" style={{ width: `${profile?.storageQuotaBytes ? Math.max(2, quotaPercent) : 0}%` }} />
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="border-t border-black/[0.08] pt-4">
          <SectionTitle title="浏览器连接" description="让 Apollo 操作你授权的 Chrome 标签页" />
          <div className="mt-3 flex items-center gap-3">
            <span className={`size-2 shrink-0 rounded-full ${browserStatus.connected ? 'bg-emerald-500' : 'bg-[#c8c8c8]'}`} aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-medium text-[#333]">{browserStatus.connected ? '扩展已连接' : '扩展未连接'}</p>
              <p className="mt-0.5 truncate text-[9px] text-[#888]" title={browserStatus.tab?.url ?? browserStatus.error}>{browserStatus.tab?.title || browserStatus.error || '安装扩展后可授权当前标签页'}</p>
            </div>
            <button type="button" onClick={onRefreshBrowser} className="h-8 cursor-pointer px-2 text-[10px] text-[#555] transition-colors hover:bg-[#f3f3f3] hover:text-[#111] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#171717]">重新检测</button>
          </div>
        </section>
        <PasswordPanel />
      </div>
    </div>
  );
}

export function AdminPanel({ currentUserId }: { currentUserId: string }) {
  const [data, setData] = useState<AdminOverview>();
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  const load = () => getAdminOverview().then(setData).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
  useEffect(() => { void load(); }, []);
  const users = useMemo(() => data?.users.filter((user) => user.username.toLowerCase().includes(query.trim().toLowerCase())) ?? [], [data, query]);

  const update = async (user: ManagedUser, patch: { admin?: boolean; disabled?: boolean }) => {
    setBusyId(user.id);
    setError('');
    try {
      await updateManagedUser(user.id, patch);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusyId('');
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div><h3 className="text-[15px] font-semibold text-[#171717]">运行概览</h3><p className="mt-1 text-[10px] text-[#777]">用户、任务与访问权限集中管理</p></div>
        <span className={`inline-flex w-fit items-center gap-1.5 text-[10px] ${data?.registrationEnabled ? 'text-emerald-700' : 'text-[#777]'}`}><span className={`size-1.5 rounded-full ${data?.registrationEnabled ? 'bg-emerald-500' : 'bg-[#bbb]'}`} />{data?.registrationEnabled ? '邀请注册已开启' : '注册已关闭'}</span>
      </div>
      <div className="grid grid-cols-2 border border-black/[0.08] lg:grid-cols-4">
        <Stat label="全部用户" value={number(data?.stats.totalUsers)} />
        <Stat label="可用账号" value={number(data?.stats.enabledUsers)} />
        <Stat label="24 小时任务" value={number(data?.stats.runs24h)} />
        <Stat label="正在运行" value={number(data?.stats.runningRuns)} last />
      </div>
      <section>
        <div className="flex flex-col justify-between gap-3 border-b border-black/[0.08] pb-3 sm:flex-row sm:items-center">
          <div><h3 className="text-[12px] font-semibold text-[#222]">用户管理</h3><p className="mt-0.5 text-[9px] text-[#888]">停用账号会立即撤销其登录会话</p></div>
          <label className="relative block sm:w-56">
            <span className="sr-only">搜索用户</span>
            <SearchIcon />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索用户名" className="h-8 w-full border border-black/[0.12] bg-white pl-8 pr-2 text-[10px] outline-none transition-colors placeholder:text-[#aaa] focus:border-[#777]" />
          </label>
        </div>
        {error && <div className="mt-3"><Notice tone="error">{error}</Notice></div>}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] border-collapse text-left">
            <thead><tr className="border-b border-black/[0.07] text-[9px] font-medium uppercase tracking-[0.08em] text-[#888]"><th className="px-2 py-2.5">用户</th><th className="px-2 py-2.5">状态</th><th className="px-2 py-2.5">使用情况</th><th className="px-2 py-2.5">最近活动</th><th className="px-2 py-2.5 text-right">操作</th></tr></thead>
            <tbody>
              {users.map((item) => {
                const self = item.id === currentUserId;
                return <tr key={item.id} className="border-b border-black/[0.055] text-[10px] text-[#444] transition-colors hover:bg-[#fafafa]">
                  <td className="px-2 py-3"><div className="flex items-center gap-2"><span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[#ededed] text-[10px] font-semibold">{item.username.slice(0, 1).toUpperCase()}</span><div><p className="font-medium text-[#222]">{item.username}{self ? '（你）' : ''}</p><p className="mt-0.5 text-[9px] text-[#999]">{formatDate(item.createdAt)}</p></div></div></td>
                  <td className="px-2 py-3"><span className={`inline-flex items-center gap-1.5 ${item.isDisabled ? 'text-red-600' : 'text-emerald-700'}`}><span className={`size-1.5 rounded-full ${item.isDisabled ? 'bg-red-400' : 'bg-emerald-500'}`} />{item.isDisabled ? '已停用' : item.isAdmin ? '管理员' : '正常'}</span></td>
                  <td className="px-2 py-3"><p>{item.conversationCount} 个对话 · {item.runCount} 次任务</p>{item.failedRuns > 0 && <p className="mt-0.5 text-[9px] text-[#999]">{item.failedRuns} 次失败</p>}</td>
                  <td className="px-2 py-3 text-[#777]">{item.lastActiveAt ? formatRelative(item.lastActiveAt) : '尚未运行任务'}</td>
                  <td className="px-2 py-3"><div className="flex justify-end gap-1">
                    <ActionButton disabled={self || busyId === item.id} onClick={() => void update(item, { admin: !item.isAdmin })}>{item.isAdmin ? '设为成员' : '设为管理员'}</ActionButton>
                    <ActionButton danger={!item.isDisabled} disabled={self || busyId === item.id} onClick={() => { if (item.isDisabled || window.confirm(`停用 ${item.username}？该用户会立即退出登录。`)) void update(item, { disabled: !item.isDisabled }); }}>{item.isDisabled ? '启用' : '停用'}</ActionButton>
                  </div></td>
                </tr>;
              })}
            </tbody>
          </table>
          {data && users.length === 0 && <p className="py-10 text-center text-[10px] text-[#999]">没有匹配的用户</p>}
          {!data && !error && <p className="py-10 text-center text-[10px] text-[#999]">正在读取用户数据…</p>}
        </div>
      </section>
    </div>
  );
}

function PasswordPanel() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState('');
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setState('saving'); setError('');
    try {
      await changePassword(currentPassword, newPassword);
      setCurrentPassword(''); setNewPassword(''); setState('saved');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason)); setState('error');
    }
  };
  return <section className="border-t border-black/[0.08] pt-4">
    <SectionTitle title="登录安全" description="修改密码后，其他设备会退出登录" />
    <form onSubmit={(event) => void submit(event)} className="mt-3 grid grid-cols-[1fr_auto] gap-2">
      <div className="space-y-2">
        <input type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => { setCurrentPassword(event.target.value); setState('idle'); }} placeholder="当前密码" aria-label="当前密码" className="h-8 w-full border border-black/[0.12] px-2.5 text-[10px] outline-none focus:border-[#777]" />
        <input type="password" autoComplete="new-password" value={newPassword} onChange={(event) => { setNewPassword(event.target.value); setState('idle'); }} placeholder="新密码（至少 8 位）" aria-label="新密码" className="h-8 w-full border border-black/[0.12] px-2.5 text-[10px] outline-none focus:border-[#777]" />
      </div>
      <button type="submit" disabled={state === 'saving' || !currentPassword || newPassword.length < 8} className="h-full min-h-8 cursor-pointer bg-[#171717] px-3 text-[10px] font-medium text-white transition-colors hover:bg-[#333] disabled:cursor-default disabled:bg-[#ccc]">{state === 'saving' ? '保存中' : '更新'}</button>
    </form>
    {state === 'saved' && <p className="mt-2 text-[9px] text-emerald-700">密码已更新，其他设备已退出。</p>}
    {state === 'error' && <p className="mt-2 text-[9px] text-red-600">{error}</p>}
  </section>;
}

function Stat({ label, value, last = false }: { label: string; value?: number; last?: boolean }) {
  return <div className={`px-3 py-3.5 ${last ? '' : 'border-r border-black/[0.07]'} [&:nth-child(2)]:border-r-0 sm:[&:nth-child(2)]:border-r`}><p className="text-[18px] font-semibold tabular-nums tracking-[-0.03em] text-[#18181b]">{value ?? '—'}</p><p className="mt-1 text-[9px] text-[#888]">{label}</p></div>;
}
function SectionTitle({ title, description }: { title: string; description: string }) { return <div className="flex items-baseline justify-between gap-3"><h3 className="text-[11px] font-semibold text-[#333]">{title}</h3><p className="truncate text-right text-[9px] text-[#888]">{description}</p></div>; }
function Notice({ children, tone }: { children: string; tone: 'error' }) { return <p role="alert" className={tone === 'error' ? 'border-l-2 border-red-400 bg-red-50 px-3 py-2 text-[10px] text-red-700' : ''}>{children}</p>; }
function ActionButton({ children, onClick, disabled, danger = false }: { children: string; onClick: () => void; disabled: boolean; danger?: boolean }) { return <button type="button" disabled={disabled} onClick={onClick} className={`h-7 cursor-pointer border px-2 text-[9px] transition-colors disabled:cursor-default disabled:opacity-35 ${danger ? 'border-red-200 text-red-600 hover:bg-red-50' : 'border-black/[0.1] text-[#555] hover:bg-[#f1f1f1]'}`}>{children}</button>; }
function SearchIcon() { return <svg viewBox="0 0 20 20" width="13" height="13" fill="none" className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[#888]" aria-hidden="true"><circle cx="9" cy="9" r="5" stroke="currentColor" strokeWidth="1.5" /><path d="m13 13 3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>; }
function formatDate(value: string): string { return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(value)); }
function formatRelative(value: string): string { const ms = Date.now() - Date.parse(value); const minutes = Math.max(0, Math.round(ms / 60_000)); return minutes < 1 ? '刚刚' : minutes < 60 ? `${minutes} 分钟前` : minutes < 1440 ? `${Math.round(minutes / 60)} 小时前` : `${Math.round(minutes / 1440)} 天前`; }
function formatBytes(value: number): string { return value < 1024 * 1024 ? `${Math.ceil(value / 1024)} KB` : value < 1024 ** 3 ? `${(value / 1024 ** 2).toFixed(1)} MB` : `${(value / 1024 ** 3).toFixed(1)} GB`; }
function number(value: number | null | undefined): number | undefined { return value == null ? undefined : Number(value); }

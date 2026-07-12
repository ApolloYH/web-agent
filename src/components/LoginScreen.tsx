import { useState } from 'react';
import { authenticate } from '@/lib/auth';
import type { AuthUser } from '@/lib/auth';

export default function LoginScreen({ hasUsers, registrationEnabled, onAuthenticated }: { hasUsers: boolean; registrationEnabled: boolean; onAuthenticated: (user: AuthUser) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>(!hasUsers && registrationEnabled ? 'register' : 'login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setLoading(true); setError('');
    try { onAuthenticated(await authenticate(mode, username, password, inviteCode)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setLoading(false); }
  };
  return (
    <main className="flex min-h-dvh items-center justify-center bg-[#f7f7f7] px-5">
      <form onSubmit={submit} className="w-full max-w-[340px] rounded-2xl border border-black/[0.07] bg-white p-7 shadow-[0_18px_50px_rgba(0,0,0,0.08)]">
        <div className="mb-7 flex items-center gap-2.5"><img src="./wyd_mark_transparent.png" alt="WYD" className="size-8 object-contain" /><div><h1 className="text-[16px] font-semibold text-[#202123]">威彦达</h1><p className="text-[10px] text-[#888]">智能体工作台</p></div></div>
        <h2 className="text-[14px] font-medium text-[#202123]">{mode === 'login' ? '登录账号' : '创建本地账号'}</h2>
        <div className="mt-4 space-y-3">
          <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" placeholder="用户名" aria-label="用户名" className="h-10 w-full rounded-xl border border-[#ddd] px-3 text-[12px] outline-none focus:border-[#999] focus:ring-2 focus:ring-black/5" />
          <input value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} type="password" placeholder="密码（至少 8 位）" aria-label="密码" className="h-10 w-full rounded-xl border border-[#ddd] px-3 text-[12px] outline-none focus:border-[#999] focus:ring-2 focus:ring-black/5" />
          {mode === 'register' && <input value={inviteCode} onChange={(event) => setInviteCode(event.target.value)} type="password" placeholder="注册邀请码" aria-label="注册邀请码" className="h-10 w-full rounded-xl border border-[#ddd] px-3 text-[12px] outline-none focus:border-[#999] focus:ring-2 focus:ring-black/5" />}
        </div>
        {error && <p className="mt-3 text-[11px] text-red-600">{error}</p>}
        <button disabled={loading || !username.trim() || password.length < 8 || (mode === 'register' && !inviteCode)} className="mt-5 h-10 w-full rounded-xl bg-[#171717] text-[12px] font-medium text-white hover:bg-[#333] disabled:bg-[#bbb]">{loading ? '请稍候…' : mode === 'login' ? '登录' : '创建并登录'}</button>
        {registrationEnabled && <button type="button" onClick={() => { setMode((value) => value === 'login' ? 'register' : 'login'); setError(''); }} className="mt-3 w-full py-1 text-[10px] text-[#777] hover:text-[#222]">{mode === 'login' ? '使用邀请码创建账号' : '已有账号？返回登录'}</button>}
      </form>
    </main>
  );
}

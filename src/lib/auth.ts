export interface AuthUser { id: string; username: string; admin: boolean }

export async function getCurrentUser(): Promise<{ user: AuthUser | null; hasUsers: boolean; registrationEnabled: boolean }> {
  const response = await fetch('/apollo-api/auth/me');
  if (!response.ok) throw new Error('无法读取登录状态');
  return response.json();
}

export async function authenticate(mode: 'login' | 'register', username: string, password: string, inviteCode = ''): Promise<AuthUser> {
  const response = await fetch(`/apollo-api/auth/${mode}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password, inviteCode }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? '登录失败');
  return body.user;
}

export async function logout(): Promise<void> {
  await fetch('/apollo-api/auth/logout', { method: 'POST' });
}

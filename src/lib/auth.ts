export interface AuthUser { id: string; username: string; admin: boolean }

export interface AccountProfile extends AuthUser {
  createdAt: string;
  conversationCount: number;
  runCount: number;
  successfulRuns: number;
  failedRuns: number;
  lastActiveAt: string | null;
  sessionCount: number;
  storageUsedBytes: number;
  storageQuotaBytes: number;
}

export interface ManagedUser {
  id: string;
  username: string;
  isAdmin: number;
  isDisabled: number;
  createdAt: string;
  conversationCount: number;
  runCount: number;
  failedRuns: number;
  lastActiveAt: string | null;
}

export interface AdminOverview {
  stats: {
    totalUsers: number;
    enabledUsers: number;
    runs24h: number;
    runningRuns: number;
  };
  users: ManagedUser[];
  registrationEnabled: boolean;
}

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

export async function getAccountProfile(): Promise<AccountProfile> {
  return (await requestJson<{ profile: AccountProfile }>('/apollo-api/account')).profile;
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  await requestJson('/apollo-api/account/password', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ currentPassword, newPassword }),
  });
}

export async function getAdminOverview(): Promise<AdminOverview> {
  return requestJson<AdminOverview>('/apollo-api/admin');
}

export async function updateManagedUser(id: string, patch: { admin?: boolean; disabled?: boolean }): Promise<void> {
  await requestJson(`/apollo-api/admin/users/${encodeURIComponent(id)}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
  });
}

export async function logout(): Promise<void> {
  await fetch('/apollo-api/auth/logout', { method: 'POST' });
}

async function requestJson<T = Record<string, unknown>>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? '请求失败');
  return body as T;
}

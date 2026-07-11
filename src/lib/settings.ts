const MOCK_KEY = 'web-agent.useMock';

export function loadUseMock(): boolean {
  return localStorage.getItem(MOCK_KEY) !== 'false'; // 默认开启 mock，方便先跑通
}

export function saveUseMock(v: boolean): void {
  localStorage.setItem(MOCK_KEY, String(v));
}

// ── 后端模式 ──────────────────────────────────────────────
// 'apollo' 本地 Apollo SDK（默认）
// 'mock'   本地演示（无需后端）
// 'noumi'  Noumi 平台（langhub.cn，项目/话题制）
export type BackendMode = 'apollo' | 'mock' | 'noumi';

const BACKEND_KEY = 'web-agent.backend';

export function loadBackend(): BackendMode {
  const raw = localStorage.getItem(BACKEND_KEY);
  if (raw === 'apollo' || raw === 'noumi') return raw;
  return 'apollo';
}

export function saveBackend(v: BackendMode): void {
  localStorage.setItem(BACKEND_KEY, v);
}

// ── Noumi 配置 ────────────────────────────────────────────
export interface NoumiSettings {
  baseUrl: string;
  apiKey: string;
  projectId: string;
  topicId: string;
}

const NOUMI_KEY = 'web-agent.noumi';

export const DEFAULT_NOUMI: NoumiSettings = {
  // 默认走 Vite 同源代理（见 vite.config.ts），绕开 langhub.cn 的 CORS。
  // 如需直连可改成 https://www.langhub.cn/api/external/v1（浏览器会被 CORS 拦，仅 curl/服务端可用）。
  baseUrl: '/noumi-api',
  apiKey: '',
  projectId: '',
  topicId: '',
};

export function loadNoumi(): NoumiSettings {
  try {
    const raw = localStorage.getItem(NOUMI_KEY);
    if (raw) return { ...DEFAULT_NOUMI, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_NOUMI };
}

export function saveNoumi(v: NoumiSettings): void {
  localStorage.setItem(NOUMI_KEY, JSON.stringify(v));
}

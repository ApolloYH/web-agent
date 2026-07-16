const APOLLO_BROWSER_MESSAGE = 'APOLLO_BROWSER_REQUEST';
const APOLLO_BROWSER_RESPONSE = 'APOLLO_BROWSER_RESPONSE';

export interface BrowserConnectionStatus {
  connected: boolean;
  version?: string;
  tab?: { id?: number; title?: string; url?: string };
  error?: string;
}

export async function runBrowserAction(action: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const id = crypto.randomUUID();
    const finish = (value: Record<string, unknown>) => {
      window.clearTimeout(timer);
      window.removeEventListener('message', receive);
      resolve(value);
    };
    const receive = (event: MessageEvent<unknown>) => {
      if (event.source !== window || event.origin !== location.origin || !event.data || typeof event.data !== 'object') return;
      const message = event.data as { type?: unknown; id?: unknown; response?: unknown };
      if (message.type !== APOLLO_BROWSER_RESPONSE || message.id !== id) return;
      finish(message.response && typeof message.response === 'object' && !Array.isArray(message.response)
        ? message.response as Record<string, unknown>
        : { ok: false, error: '浏览器扩展返回格式无效' });
    };
    const timeout = action === 'status' ? 2_000 : 30_000;
    const timer = window.setTimeout(() => finish({
      ok: false,
      error: action === 'status' ? '未检测到 Apollo Browser Bridge 扩展' : '浏览器操作超时',
    }), timeout);
    window.addEventListener('message', receive);
    window.postMessage({ type: APOLLO_BROWSER_MESSAGE, id, action, input }, location.origin);
  });
}

export async function getBrowserConnectionStatus(): Promise<BrowserConnectionStatus> {
  const result = await runBrowserAction('status', {});
  if (result.ok !== true) return { connected: false, error: typeof result.error === 'string' ? result.error : '浏览器扩展不可用' };
  return {
    connected: true,
    version: typeof result.version === 'string' ? result.version : undefined,
    tab: result.tab && typeof result.tab === 'object' && !Array.isArray(result.tab)
      ? result.tab as BrowserConnectionStatus['tab']
      : undefined,
  };
}

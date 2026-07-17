export const APOLLO_BROWSER_MESSAGE = 'APOLLO_BROWSER_REQUEST';
export const APOLLO_BROWSER_RESPONSE = 'APOLLO_BROWSER_RESPONSE';
export const APOLLO_PAGE_MESSAGE = 'APOLLO_PAGE_REQUEST';
export const MAX_PAGE_CONTENT = 100_000;

export type BrowserAction =
  | 'status'
  | 'list_tabs'
  | 'get_state'
  | 'open_url'
  | 'switch_tab'
  | 'close_tab'
  | 'click'
  | 'type'
  | 'select'
  | 'scroll'
  | 'control_start'
  | 'control_end';

export interface BrowserRequest {
  type: typeof APOLLO_BROWSER_MESSAGE;
  id: string;
  action: BrowserAction;
  input: Record<string, unknown>;
}

export interface BrowserResponse {
  ok: boolean;
  error?: string;
  [key: string]: unknown;
}

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export function safeHttpUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length > 4_096) throw new Error('URL 无效');
  const url = new URL(value);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('只允许 HTTP/HTTPS URL');
  return url.href;
}

export function integer(value: unknown, name: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isInteger(value) || Number(value) < minimum || Number(value) > maximum) throw new Error(`${name} 无效`);
  return Number(value);
}

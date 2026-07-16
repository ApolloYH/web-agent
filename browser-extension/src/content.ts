import { PageController } from '@page-agent/page-controller';
import { APOLLO_BROWSER_MESSAGE, APOLLO_BROWSER_RESPONSE, APOLLO_PAGE_MESSAGE, MAX_PAGE_CONTENT, integer, isRecord, type BrowserRequest, type BrowserResponse } from './protocol';

let pageController: PageController | undefined;

if (['https://apollo.yh521.top', 'http://127.0.0.1:5173', 'http://localhost:5173'].includes(location.origin)) {
  window.addEventListener('message', (event: MessageEvent<unknown>) => {
    if (event.source !== window || event.origin !== location.origin || !isRecord(event.data) || event.data.type !== APOLLO_BROWSER_MESSAGE) return;
    const request = event.data as unknown as BrowserRequest;
    void chrome.runtime.sendMessage(request).then((response) => {
      window.postMessage({ type: APOLLO_BROWSER_RESPONSE, id: request.id, response }, location.origin);
    }).catch((error) => {
      window.postMessage({ type: APOLLO_BROWSER_RESPONSE, id: request.id, response: { ok: false, error: error instanceof Error ? error.message : String(error) } }, location.origin);
    });
  });
}

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse): true | undefined => {
  if (!isRecord(message) || message.type !== APOLLO_PAGE_MESSAGE || typeof message.action !== 'string') return;
  void handlePageAction(message.action, isRecord(message.input) ? message.input : {})
    .then(sendResponse)
    .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  return true;
});

async function handlePageAction(action: string, input: Record<string, unknown>): Promise<BrowserResponse> {
  const controller = pageController ??= new PageController({ enableMask: false, viewportExpansion: 400, keepSemanticTags: true });
  if (action === 'get_state') {
    const state = await controller.getBrowserState();
    return {
      ok: true,
      ...state,
      content: sanitizePageContent(state.content).slice(0, MAX_PAGE_CONTENT),
      truncated: state.content.length > MAX_PAGE_CONTENT,
    };
  }
  if (action === 'click') return withIndicator(() => controller.clickElement(integer(input.index, 'index')));
  if (action === 'type') {
    if (typeof input.text !== 'string' || input.text.length > 10_000) throw new Error('text 无效或过长');
    return withIndicator(() => controller.inputText(integer(input.index, 'index'), input.text as string));
  }
  if (action === 'select') {
    if (typeof input.option !== 'string' || input.option.length > 1_000) throw new Error('option 无效或过长');
    return withIndicator(() => controller.selectOption(integer(input.index, 'index'), input.option as string));
  }
  if (action === 'scroll') {
    const direction = input.direction;
    if (direction !== 'up' && direction !== 'down') throw new Error('direction 无效');
    const pages = input.pages === undefined ? 1 : integer(input.pages, 'pages', 1, 10);
    const index = input.index === undefined ? undefined : integer(input.index, 'index');
    return withIndicator(() => controller.scroll({ down: direction === 'down', numPages: pages, index }));
  }
  throw new Error(`不支持的页面动作：${action}`);
}

async function withIndicator(operation: () => Promise<{ success: boolean; message: string }>): Promise<BrowserResponse> {
  const indicator = document.createElement('div');
  indicator.dataset.pageAgentNotInteractive = 'true';
  indicator.textContent = 'Apollo 正在操作此页面';
  Object.assign(indicator.style, {
    position: 'fixed', top: '12px', right: '12px', zIndex: '2147483647', padding: '8px 12px',
    borderRadius: '10px', background: '#2563eb', color: '#fff', font: '12px/16px system-ui, sans-serif',
    boxShadow: '0 8px 24px rgba(0,0,0,.18)', pointerEvents: 'none',
  });
  document.documentElement.appendChild(indicator);
  try { return actionResult(await operation()); } finally { indicator.remove(); }
}

function actionResult(value: { success: boolean; message: string }): BrowserResponse {
  return value.success ? { ok: true, message: redact(value.message) } : { ok: false, error: redact(value.message) };
}

function sanitizePageContent(value: string): string {
  return redact(value)
    .replace(/(<input\b[^>]*type=["']?password["']?[^>]*)(?:value=["'][^"']*["'])?/gi, '$1 value="[REDACTED]"')
    .replace(/\b(?:authorization|access[_-]?token|refresh[_-]?token)\s*[=:]\s*[^\s<>]{8,}/gi, '[REDACTED]');
}

function redact(value: string): string {
  return value.replace(/\b(?:sk|sess|token)-[A-Za-z0-9_-]{12,}\b/g, '[REDACTED]');
}

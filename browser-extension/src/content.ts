import { PageController } from '@page-agent/page-controller';
import { APOLLO_BROWSER_MESSAGE, APOLLO_BROWSER_RESPONSE, APOLLO_PAGE_MESSAGE, MAX_PAGE_CONTENT, integer, isRecord, type BrowserRequest, type BrowserResponse } from './protocol';

let pageController: PageController | undefined;
let controlIndicator: ControlIndicator | undefined;

type ControlIndicator = {
  show(label: string): void;
  moveTo(x: number, y: number): void;
  hideSoon(): void;
};

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
    const state = await withIndicator('正在查看页面', undefined, () => controller.getBrowserState());
    return {
      ok: true,
      ...state,
      content: sanitizePageContent(state.content).slice(0, MAX_PAGE_CONTENT),
      truncated: state.content.length > MAX_PAGE_CONTENT,
    };
  }
  if (action === 'click') {
    const index = integer(input.index, 'index');
    return actionResult(await withIndicator('正在点击', index, () => controller.clickElement(index)));
  }
  if (action === 'type') {
    if (typeof input.text !== 'string' || input.text.length > 10_000) throw new Error('text 无效或过长');
    const index = integer(input.index, 'index');
    return actionResult(await withIndicator('正在输入', index, () => controller.inputText(index, input.text as string)));
  }
  if (action === 'select') {
    if (typeof input.option !== 'string' || input.option.length > 1_000) throw new Error('option 无效或过长');
    const index = integer(input.index, 'index');
    return actionResult(await withIndicator('正在选择', index, () => controller.selectOption(index, input.option as string)));
  }
  if (action === 'scroll') {
    const direction = input.direction;
    if (direction !== 'up' && direction !== 'down') throw new Error('direction 无效');
    const pages = input.pages === undefined ? 1 : integer(input.pages, 'pages', 1, 10);
    const index = input.index === undefined ? undefined : integer(input.index, 'index');
    return actionResult(await withIndicator(direction === 'down' ? '正在向下滚动' : '正在向上滚动', index, () => controller.scroll({ down: direction === 'down', numPages: pages, index })));
  }
  throw new Error(`不支持的页面动作：${action}`);
}

async function withIndicator<T>(label: string, index: number | undefined, operation: () => Promise<T>): Promise<T> {
  const indicator = controlIndicator ??= createControlIndicator();
  indicator.show(label);
  const target = index === undefined ? undefined : indexedElement(index);
  if (target) indicator.moveTo(...elementCenter(target));
  try { return await operation(); } finally { indicator.hideSoon(); }
}

function createControlIndicator(): ControlIndicator {
  const host = document.createElement('div');
  host.dataset.pageAgentNotInteractive = 'true';
  Object.assign(host.style, {
    all: 'initial',
    position: 'fixed',
    inset: '0',
    zIndex: '2147483647',
    pointerEvents: 'none',
    contain: 'strict',
  });
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `
    <style>
      .control { position: absolute; inset: 0; opacity: 0; transition: opacity 180ms ease-in; }
      .control.active { opacity: 1; transition-timing-function: ease-out; }
      .edge { position: absolute; inset: 3px; border-radius: 15px;
        box-shadow: inset 0 0 24px rgba(96, 115, 255, .18), 0 0 20px rgba(123, 92, 255, .58);
        animation: apollo-edge-pulse 1.35s ease-in-out infinite; will-change: opacity; }
      .edge::before { content: ""; position: absolute; inset: 0; padding: 3px; border-radius: inherit;
        background: conic-gradient(from 80deg, #51e3ff, #5b6cff, #ed64ff, #ff8f70, #ffd45c, #51e3ff);
        -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
        -webkit-mask-composite: xor; mask-composite: exclude; }
      .status { position: absolute; left: 50%; bottom: 18px; display: flex; align-items: center; gap: 8px;
        transform: translateX(-50%); padding: 8px 13px; border: 1px solid rgba(255,255,255,.28); border-radius: 999px;
        background: rgba(18, 22, 38, .88); color: white; box-shadow: 0 8px 28px rgba(0,0,0,.28);
        font: 600 12px/16px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        letter-spacing: .01em; backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); }
      .dot { width: 7px; height: 7px; border-radius: 50%; background: #62e6ff; box-shadow: 0 0 10px #62e6ff; }
      .cursor { position: absolute; left: 0; top: 0; width: 54px; height: 54px;
        transform: translate3d(calc(64vw - 8px), calc(50vh - 5px), 0);
        transition: transform 260ms cubic-bezier(.2,.75,.25,1); will-change: transform;
        filter: drop-shadow(0 5px 8px rgba(24, 31, 70, .35)); }
      .ripple { position: absolute; left: 0; top: 0; width: 38px; height: 38px; border: 3px solid #64d9ff;
        border-radius: 50%; opacity: 0; transform: translate3d(calc(64vw - 19px), calc(50vh - 19px), 0); scale: .25; }
      .ripple.click { animation: apollo-click 420ms ease-out; }
      @keyframes apollo-edge-pulse {
        0%, 100% { opacity: .58; }
        50% { opacity: 1; }
      }
      @keyframes apollo-click {
        0% { opacity: .95; scale: .35; }
        100% { opacity: 0; scale: 1.7; }
      }
      @media (prefers-reduced-motion: reduce) {
        .control, .cursor { transition: none; }
        .edge, .ripple.click { animation: none; }
        .edge { opacity: 1; }
      }
    </style>
    <div class="control" aria-hidden="true">
      <div class="edge"></div>
      <div class="status"><span class="dot"></span><span class="label">Apollo 正在操作</span></div>
      <div class="ripple"></div>
      <svg class="cursor" viewBox="0 0 54 54" aria-hidden="true">
        <path d="M8 4.5v35.2l9.1-8.2 7 15.8 8-3.6-7-15.4 12.1-.8L8 4.5Z" fill="#fff" stroke="#5368ff" stroke-width="4" stroke-linejoin="round"/>
      </svg>
    </div>`;
  document.documentElement.appendChild(host);

  const control = root.querySelector<HTMLElement>('.control')!;
  const label = root.querySelector<HTMLElement>('.label')!;
  const cursor = root.querySelector<HTMLElement>('.cursor')!;
  const ripple = root.querySelector<HTMLElement>('.ripple')!;
  let x = window.innerWidth * .64;
  let y = window.innerHeight * .5;
  let hideTimer: ReturnType<typeof setTimeout> | undefined;

  const moveTo = (nextX: number, nextY: number) => {
    x = Math.max(10, Math.min(window.innerWidth - 10, nextX));
    y = Math.max(10, Math.min(window.innerHeight - 10, nextY));
    cursor.style.transform = `translate3d(${x - 8}px, ${y - 5}px, 0)`;
    ripple.style.transform = `translate3d(${x - 19}px, ${y - 19}px, 0)`;
  };
  const click = () => {
    ripple.classList.remove('click');
    void ripple.offsetWidth;
    ripple.classList.add('click');
  };

  window.addEventListener('PageAgent::MovePointerTo', (event) => {
    const detail = (event as CustomEvent<unknown>).detail;
    if (isRecord(detail) && typeof detail.x === 'number' && typeof detail.y === 'number') moveTo(detail.x, detail.y);
  });
  window.addEventListener('PageAgent::ClickPointer', click);
  moveTo(x, y);

  return {
    show(text) {
      if (hideTimer) clearTimeout(hideTimer);
      label.textContent = `Apollo ${text}`;
      control.classList.add('active');
    },
    moveTo,
    hideSoon() {
      if (hideTimer) clearTimeout(hideTimer);
      hideTimer = setTimeout(() => control.classList.remove('active'), 650);
    },
  };
}

function indexedElement(index: number): HTMLElement | undefined {
  const controller = pageController as unknown as { selectorMap?: Map<number, { ref?: HTMLElement }> } | undefined;
  return controller?.selectorMap?.get(index)?.ref;
}

function elementCenter(element: HTMLElement): [number, number] {
  const rect = element.getBoundingClientRect();
  let x = rect.left + rect.width / 2;
  let y = rect.top + rect.height / 2;
  try {
    let frame = element.ownerDocument.defaultView?.frameElement;
    while (frame instanceof HTMLElement) {
      const frameRect = frame.getBoundingClientRect();
      x += frameRect.left;
      y += frameRect.top;
      frame = frame.ownerDocument.defaultView?.frameElement;
    }
  } catch { /* Cross-origin frames are already positioned by PageController. */ }
  return [x, y];
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

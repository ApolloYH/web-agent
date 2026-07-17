import { PageController } from '@page-agent/page-controller';
import { Motion } from 'ai-motion';
import { APOLLO_BROWSER_MESSAGE, APOLLO_BROWSER_RESPONSE, APOLLO_PAGE_MESSAGE, MAX_PAGE_CONTENT, integer, isRecord, type BrowserRequest, type BrowserResponse } from './protocol';

let pageController: PageController | undefined;
let controlIndicator: ControlIndicator | undefined;

type ControlIndicator = {
  show(label: string): void;
  moveTo(x: number, y: number): void;
  hide(): void;
};

if (['https://apollo.yh521.top', 'http://127.0.0.1:5173', 'http://localhost:5173'].includes(location.origin)) {
  window.addEventListener('message', (event: MessageEvent<unknown>) => {
    if (event.source !== window || event.origin !== location.origin || !isRecord(event.data) || event.data.type !== APOLLO_BROWSER_MESSAGE) return;
    const request = event.data as unknown as BrowserRequest;
    try {
      void chrome.runtime.sendMessage(request).then((response) => {
        window.postMessage({ type: APOLLO_BROWSER_RESPONSE, id: request.id, response }, location.origin);
      }).catch((error) => {
        window.postMessage({ type: APOLLO_BROWSER_RESPONSE, id: request.id, response: { ok: false, error: browserExtensionError(error) } }, location.origin);
      });
    } catch (error) {
      window.postMessage({ type: APOLLO_BROWSER_RESPONSE, id: request.id, response: { ok: false, error: browserExtensionError(error) } }, location.origin);
    }
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
  if (action === 'control_start') {
    (controlIndicator ??= createControlIndicator()).show('正在操作');
    return { ok: true };
  }
  if (action === 'control_end') {
    controlIndicator?.hide();
    return { ok: true };
  }
  const controller = pageController ??= new PageController({
    enableMask: false,
    viewportExpansion: 400,
    keepSemanticTags: true,
    highlightOpacity: 0,
    highlightLabelOpacity: 0,
  });
  if (action === 'get_state') {
    const state = await withIndicator('正在查看页面', undefined, async () => {
      try { return await controller.getBrowserState(); }
      finally { await controller.cleanUpHighlights(); }
    });
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
  return operation();
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
      .control { position: absolute; inset: 0; opacity: 0; transition: opacity 240ms ease-in; }
      .control.active { opacity: 1; transition-timing-function: ease-out; }
      .edge { position: absolute; inset: 0; border-radius: 18px; overflow: hidden; opacity: .78; }
      .edge.fallback { box-shadow: inset 0 0 32px rgba(57, 182, 255, .4), inset 0 0 56px rgba(189, 69, 251, .22); }
      .status { position: absolute; left: 50%; bottom: 18px; display: flex; align-items: center; gap: 8px;
        transform: translateX(-50%); padding: 9px 15px; border: 1px solid rgba(125, 211, 252, .56); border-radius: 999px;
        background: rgba(15, 23, 42, .92); color: white; box-shadow: 0 8px 28px rgba(15, 23, 42, .34), 0 0 18px rgba(14, 165, 233, .24);
        font: 600 12px/16px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        letter-spacing: .01em; backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); }
      .dot { width: 8px; height: 8px; border-radius: 50%; background: #67e8f9; box-shadow: 0 0 12px #38bdf8; }
      .cursor { position: absolute; left: 0; top: 0; width: 64px; height: 64px;
        transform: translate3d(calc(64vw - 8px), calc(50vh - 15px), 0) rotate(-135deg) scale(1.06);
        transform-origin: center; will-change: transform;
        filter: drop-shadow(0 4px 6px rgba(15, 23, 42, .38)) drop-shadow(0 0 7px rgba(56, 189, 248, .36)); }
      .ripple { position: absolute; left: 0; top: 0; width: 36px; height: 36px; border: 3px solid #38bdf8;
        border-radius: 50%; opacity: 0; transform: translate3d(calc(64vw - 18px), calc(50vh - 18px), 0); scale: .25; }
      .ripple.click { animation: apollo-click 300ms ease-out; }
      @keyframes apollo-click {
        0% { opacity: .95; scale: 0; }
        100% { opacity: 0; scale: 2; }
      }
      @media (prefers-reduced-motion: reduce) {
        .control { transition: none; }
        .ripple.click { animation: none; }
      }
    </style>
    <div class="control" aria-hidden="true">
      <div class="edge"></div>
      <div class="status"><span class="dot"></span><span class="label">Apollo 正在操作</span></div>
      <div class="ripple"></div>
      <svg class="cursor" width="64" height="64" viewBox="0 0 100 100" aria-hidden="true">
        <defs><linearGradient id="apollo-cursor-gradient" x1="15" y1="17" x2="78" y2="67" gradientUnits="userSpaceOnUse"><stop stop-color="#67e8f9"/><stop offset=".55" stop-color="#38bdf8"/><stop offset="1" stop-color="#2563eb"/></linearGradient></defs>
        <path d="M15 42v-5.01q0-5 8.7-5h4.35q4.36 0 4.36-10V17q0-5 8.68-.05l35.22 20.1q8.69 4.95 0 9.9l-35.22 20.1q-8.68 4.95-8.68-5.04v-5q0-5-8.71-5h-4.35Q15 52.01 15 47.01Z" fill="#fff" stroke="url(#apollo-cursor-gradient)" stroke-width="7" stroke-linejoin="round"/>
      </svg>
    </div>`;
  document.documentElement.appendChild(host);

  const control = root.querySelector<HTMLElement>('.control')!;
  const edge = root.querySelector<HTMLElement>('.edge')!;
  const label = root.querySelector<HTMLElement>('.label')!;
  const cursor = root.querySelector<HTMLElement>('.cursor')!;
  const ripple = root.querySelector<HTMLElement>('.ripple')!;
  let x = window.innerWidth * .64;
  let y = window.innerHeight * .5;
  let targetX = x;
  let targetY = y;
  let animationFrame = 0;
  let motion: Motion | undefined;

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    edge.classList.add('fallback');
  } else {
    try {
      motion = new Motion({ mode: 'light', borderWidth: 3, borderRadius: 18, glowWidth: 72, styles: { position: 'absolute', inset: '0' }, skipGreeting: true });
      edge.appendChild(motion.element);
      motion.autoResize(edge);
    } catch {
      edge.classList.add('fallback');
    }
  }

  const renderPosition = () => {
    cursor.style.transform = `translate3d(${x - 8}px, ${y - 15}px, 0) rotate(-135deg) scale(1.06)`;
    ripple.style.transform = `translate3d(${x - 18}px, ${y - 18}px, 0)`;
  };
  const animatePointer = () => {
    animationFrame = 0;
    const deltaX = targetX - x;
    const deltaY = targetY - y;
    if (Math.abs(deltaX) < 2 && Math.abs(deltaY) < 2) {
      x = targetX;
      y = targetY;
      renderPosition();
      return;
    }
    x += deltaX * .2;
    y += deltaY * .2;
    renderPosition();
    animationFrame = requestAnimationFrame(animatePointer);
  };
  const moveTo = (nextX: number, nextY: number) => {
    targetX = Math.max(10, Math.min(window.innerWidth - 10, nextX));
    targetY = Math.max(10, Math.min(window.innerHeight - 10, nextY));
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      x = targetX;
      y = targetY;
      renderPosition();
    } else if (!animationFrame) {
      animationFrame = requestAnimationFrame(animatePointer);
    }
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
  renderPosition();

  return {
    show(text) {
      label.textContent = `Apollo ${text}`;
      control.classList.add('active');
      motion?.start();
    },
    moveTo,
    hide() {
      control.classList.remove('active');
      motion?.pause();
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

function browserExtensionError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('Extension context invalidated') ? '浏览器扩展已更新，请刷新当前网页后重试' : message;
}

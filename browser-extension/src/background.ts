import {
  APOLLO_BROWSER_MESSAGE,
  APOLLO_PAGE_MESSAGE,
  integer,
  isRecord,
  safeHttpUrl,
  type BrowserAction,
  type BrowserRequest,
  type BrowserResponse,
} from './protocol';

const ALLOWED_APOLLO_ORIGINS = new Set([
  'https://apollo.yh521.top',
  'http://127.0.0.1:5173',
  'http://localhost:5173',
]);
const ACTIONS = new Set<BrowserAction>([
  'status', 'list_tabs', 'get_state', 'open_url', 'switch_tab', 'close_tab', 'click', 'type', 'select', 'scroll', 'control_start', 'control_end',
]);
const TARGET_TAB_KEY = 'apolloTargetTabId';

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse): true | undefined => {
  if (!allowedSender(sender)) {
    sendResponse({ ok: false, error: '来源页面无权连接 Apollo 浏览器扩展' });
    return;
  }
  if (!validRequest(message)) {
    sendResponse({ ok: false, error: '浏览器请求格式无效' });
    return;
  }
  void handleBrowserRequest(message, sender)
    .then((response) => sendResponse(bounded(response)))
    .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  return true;
});

chrome.action.onClicked.addListener((tab) => {
  if (!tab.id || !controllable(tab.url)) {
    void chrome.action.setBadgeText({ text: '!', tabId: tab.id });
    return;
  }
  void setTargetTab(tab.id);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void chrome.storage.session.get(TARGET_TAB_KEY).then((value) => {
    if (value[TARGET_TAB_KEY] === tabId) {
      void chrome.storage.session.remove(TARGET_TAB_KEY);
      void chrome.action.setBadgeText({ text: '' });
    }
  });
});

async function handleBrowserRequest(request: BrowserRequest, sender: chrome.runtime.MessageSender): Promise<BrowserResponse> {
  const { action, input } = request;
  if (action === 'status') {
    const tab = await resolveTargetTab(input.tab_id).catch(() => undefined);
    return { ok: true, connected: true, version: chrome.runtime.getManifest().version, tab: tab && tabSummary(tab) };
  }
  if (action === 'list_tabs') {
    const tabs = (await chrome.tabs.query({ windowId: sender.tab?.windowId })).filter((tab) => controllable(tab.url));
    const current = await storedTargetTabId();
    return { ok: true, tabs: tabs.map((tab) => ({ ...tabSummary(tab), current: tab.id === current })) };
  }
  if (action === 'open_url') {
    const tab = await chrome.tabs.create({ url: safeHttpUrl(input.url), active: true, windowId: sender.tab?.windowId });
    if (tab.id === undefined) throw new Error('浏览器没有返回新标签页 ID');
    await setTargetTab(tab.id);
    await waitUntilLoaded(tab.id);
    return { ok: true, tab: tabSummary(await chrome.tabs.get(tab.id)) };
  }
  if (action === 'switch_tab') {
    const tab = await resolveTargetTab(input.tab_id);
    await setTargetTab(tab.id!);
    await chrome.tabs.update(tab.id!, { active: true });
    return { ok: true, tab: tabSummary(await chrome.tabs.get(tab.id!)) };
  }
  if (action === 'close_tab') {
    const tab = await resolveTargetTab(input.tab_id);
    if (tab.id === sender.tab?.id) throw new Error('不能关闭当前 Apollo 页面');
    await chrome.tabs.remove(tab.id!);
    await chrome.storage.session.remove(TARGET_TAB_KEY);
    return { ok: true };
  }

  const tab = await resolveTargetTab(input.tab_id);
  await setTargetTab(tab.id!);
  const response = await chrome.tabs.sendMessage(tab.id!, { type: APOLLO_PAGE_MESSAGE, action, input });
  if (!isRecord(response)) throw new Error('目标页面没有返回有效结果');
  if (typeof response.ok !== 'boolean') throw new Error('目标页面响应缺少状态');
  return { ok: response.ok, ...response, tab: tabSummary(await chrome.tabs.get(tab.id!)) };
}

function validRequest(value: unknown): value is BrowserRequest {
  return isRecord(value)
    && value.type === APOLLO_BROWSER_MESSAGE
    && typeof value.id === 'string'
    && value.id.length > 0
    && value.id.length <= 128
    && typeof value.action === 'string'
    && ACTIONS.has(value.action as BrowserAction)
    && isRecord(value.input);
}

function allowedSender(sender: chrome.runtime.MessageSender): boolean {
  try { return ALLOWED_APOLLO_ORIGINS.has(new URL(sender.url ?? '').origin); } catch { return false; }
}

function controllable(url?: string): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && !ALLOWED_APOLLO_ORIGINS.has(parsed.origin);
  } catch { return false; }
}

async function resolveTargetTab(requested: unknown): Promise<chrome.tabs.Tab> {
  const requestedId = requested === undefined ? undefined : integer(requested, 'tab_id', 1);
  const id = requestedId ?? await storedTargetTabId();
  if (id !== undefined) {
    const tab = await chrome.tabs.get(id).catch(() => undefined);
    if (tab && controllable(tab.url)) return tab;
  }
  const tabs = (await chrome.tabs.query({})).filter((tab) => controllable(tab.url));
  if (!tabs.length) throw new Error('没有可操作的网页标签页，请先打开目标网站');
  throw new Error('尚未选择受控标签页，请在目标网页点击 Apollo Browser Bridge 扩展图标');
}

async function storedTargetTabId(): Promise<number | undefined> {
  const value = (await chrome.storage.session.get(TARGET_TAB_KEY))[TARGET_TAB_KEY];
  return typeof value === 'number' ? value : undefined;
}

async function setTargetTab(tabId: number): Promise<void> {
  const previous = await storedTargetTabId();
  if (previous && previous !== tabId) {
    await chrome.tabs.sendMessage(previous, { type: APOLLO_PAGE_MESSAGE, action: 'control_end', input: {} }).catch(() => undefined);
    await chrome.action.setBadgeText({ text: '', tabId: previous }).catch(() => undefined);
  }
  await chrome.storage.session.set({ [TARGET_TAB_KEY]: tabId });
  await chrome.action.setBadgeBackgroundColor({ color: '#2563eb' });
  await chrome.action.setBadgeText({ text: 'ON', tabId });
}

function tabSummary(tab: chrome.tabs.Tab) {
  return { id: tab.id, title: tab.title ?? '', url: tab.url ?? '', active: Boolean(tab.active) };
}

function waitUntilLoaded(tabId: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, 10_000);
    function done() {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }
    function listener(updatedId: number, change: { status?: string }) {
      if (updatedId === tabId && change.status === 'complete') done();
    }
    chrome.tabs.onUpdated.addListener(listener);
    void chrome.tabs.get(tabId).then((tab) => tab.status === 'complete' && done()).catch(done);
  });
}

function bounded(response: BrowserResponse): BrowserResponse {
  return JSON.stringify(response).length <= 200_000 ? response : { ok: false, error: '浏览器响应超过 200KB 限制' };
}

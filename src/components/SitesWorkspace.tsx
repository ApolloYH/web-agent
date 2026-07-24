import { useEffect, useRef, useState, type CSSProperties, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import ResizeDivider from '@/components/ResizeDivider';
import { getPublishedSites, type PublishedSite, type SiteElementSelection } from '@/lib/sites';

const CHAT_WIDTH = { default: 400, min: 320, max: 640 };

export default function SitesWorkspace({
  chat,
  refreshKey,
  onNewConversation,
  onOpenConversation,
  onSiteChange,
  elementSelections,
  onElementSelectionsChange,
}: {
  chat: ReactNode;
  refreshKey: number;
  onNewConversation: () => void;
  onOpenConversation: (id: string) => void;
  onSiteChange: (site: PublishedSite | null) => void;
  elementSelections: SiteElementSelection[];
  onElementSelectionsChange: Dispatch<SetStateAction<SiteElementSelection[]>>;
}) {
  const [sites, setSites] = useState<PublishedSite[]>([]);
  const [selectedSlug, setSelectedSlug] = useState('');
  const [view, setView] = useState<'gallery' | 'builder'>('gallery');
  const [loadingSites, setLoadingSites] = useState(true);
  const [available, setAvailable] = useState(true);
  const [notice, setNotice] = useState('');
  const [chatWidth, setChatWidth] = useState(CHAT_WIDTH.default);
  const [resizing, setResizing] = useState(false);
  const [pickingElement, setPickingElement] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const newSiteAfterRef = useRef(0);
  const selectedCountRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    setLoadingSites(true);
    void getPublishedSites().then((result) => {
      if (cancelled) return;
      setAvailable(result.available);
      setSites(result.sites);
      const created = newSiteAfterRef.current
        ? result.sites.find((site) => Date.parse(site.publishedAt) >= newSiteAfterRef.current - 5_000)
        : undefined;
      if (created) {
        newSiteAfterRef.current = 0;
        setSelectedSlug(created.slug);
      } else {
        setSelectedSlug((current) => current && result.sites.some((site) => site.slug === current)
          ? current
          : newSiteAfterRef.current ? '' : result.sites[0]?.slug ?? '');
      }
    }).catch((error) => {
      if (!cancelled) setNotice(error instanceof Error ? error.message : String(error));
    }).finally(() => {
      if (!cancelled) setLoadingSites(false);
    });
    return () => { cancelled = true; };
  }, [refreshKey]);

  const selectedSite = sites.find((site) => site.slug === selectedSlug) ?? null;
  useEffect(() => { onSiteChange(selectedSite); }, [onSiteChange, selectedSite]);
  useEffect(() => {
    setPickingElement(false);
    onElementSelectionsChange([]);
  }, [onElementSelectionsChange, selectedSlug]);

  useEffect(() => {
    if (selectedCountRef.current > 0 && !elementSelections.length && pickingElement) {
      setPickingElement(false);
      iframeRef.current?.contentWindow?.postMessage({ type: 'od:comment-mode', enabled: false, mode: 'picker' }, '*');
    }
    selectedCountRef.current = elementSelections.length;
  }, [elementSelections.length, pickingElement]);

  useEffect(() => {
    const receiveSelection = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow || !event.data || typeof event.data !== 'object') return;
      if (event.data.type === 'apollo:inspector-ready' && pickingElement) {
        iframeRef.current.contentWindow?.postMessage({ type: 'od:comment-mode', enabled: true, mode: 'picker' }, '*');
        return;
      }
      if (event.data.type === 'apollo:picker-cancelled') return setPickingElement(false);
      if (!pickingElement) return;
      const selection = normalizeSelection(event.data);
      if (!selection) return;
      onElementSelectionsChange((current) => current.some((item) => item.elementId === selection.elementId) ? current : [...current, selection]);
    };
    window.addEventListener('message', receiveSelection);
    return () => window.removeEventListener('message', receiveSelection);
  }, [onElementSelectionsChange, pickingElement]);

  const toggleElementPicker = () => {
    const enabled = !pickingElement;
    setPickingElement(enabled);
    iframeRef.current?.contentWindow?.postMessage({ type: 'od:comment-mode', enabled, mode: 'picker' }, '*');
  };

  const startNew = () => {
    newSiteAfterRef.current = Date.now();
    setSelectedSlug('');
    setNotice('');
    setView('builder');
    onNewConversation();
  };

  const openSite = (site: PublishedSite) => {
    newSiteAfterRef.current = 0;
    setSelectedSlug(site.slug);
    setNotice('');
    setView('builder');
    if (site.conversationId) onOpenConversation(site.conversationId);
    else onNewConversation();
  };

  if (view === 'gallery') {
    return (
      <div key="gallery" className="app-view-motion flex min-h-0 flex-1 flex-col bg-white">
        <main className="min-h-0 flex-1 overflow-y-auto px-5 pb-8 pt-16 sm:px-8 lg:px-12 lg:py-10">
          <div className="mx-auto w-full max-w-6xl">
            <div className="mb-7 flex items-start justify-between gap-4">
              <div><h1 className="text-[26px] font-semibold tracking-[-0.035em] text-[#171717] sm:text-[30px]">我的站点</h1><p className="mt-2 text-[12px] text-[#777]">预览已经发布的站点，或与 Apollo 一起创建一个新站点。</p></div>
              {!loadingSites && sites.length > 0 && <button type="button" disabled={!available} onClick={startNew} className="h-8 shrink-0 cursor-pointer rounded-full bg-[#171717] px-4 text-[11px] font-medium text-white transition-colors duration-200 hover:bg-[#343434] disabled:cursor-not-allowed disabled:opacity-35 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#171717]">创建站点</button>}
            </div>

            {notice && <p aria-live="polite" className="mb-4 rounded-xl bg-[#f6f6f6] px-4 py-3 text-[11px] text-[#666]">{notice}</p>}

            {loadingSites ? (
              <div className="flex min-h-[320px] items-center justify-center rounded-3xl border border-black/[0.07] bg-[#fcfcfc] text-[11px] text-[#888]" aria-live="polite">正在加载站点…</div>
            ) : sites.length > 0 ? (
              <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
                {sites.map((site) => (
                  <article
                    key={site.slug}
                    className="group relative min-w-0 overflow-hidden rounded-2xl border border-black/[0.09] bg-white text-left transition duration-200 hover:-translate-y-0.5 hover:border-black/[0.16] hover:shadow-[0_14px_35px_rgba(0,0,0,0.08)] focus-within:outline-2 focus-within:outline-offset-3 focus-within:outline-[#171717] motion-reduce:transform-none motion-reduce:transition-none"
                  >
                    <div className="relative aspect-[16/10] overflow-hidden border-b border-black/[0.07] bg-[#f5f5f5]">
                      <iframe
                        src={site.url}
                        title={`${site.name} 缩略预览`}
                        tabIndex={-1}
                        aria-hidden="true"
                        sandbox="allow-scripts"
                        className="pointer-events-none h-[160%] w-[160%] origin-top-left scale-[0.625] bg-white"
                      />
                      <span className="absolute right-3 top-3 rounded-full bg-white/90 px-2.5 py-1 text-[9px] font-medium text-[#333] opacity-0 shadow-sm backdrop-blur transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100">打开编辑</span>
                    </div>
                    <div className="flex items-center justify-between gap-4 p-4">
                      <div className="min-w-0">
                        <h3 className="truncate text-[13px] font-semibold text-[#222]">{site.name}</h3>
                        <p className="mt-1 truncate text-[10px] text-[#8a8a8a]">{site.url}</p>
                      </div>
                      <span className="shrink-0 text-[#888] transition-transform duration-200 group-hover:translate-x-0.5 motion-reduce:transform-none" aria-hidden="true"><ArrowIcon /></span>
                    </div>
                    <button type="button" onClick={() => openSite(site)} className="absolute inset-0 z-10 cursor-pointer focus:outline-none" aria-label={`打开并编辑站点：${site.name}`} />
                  </article>
                ))}
              </div>
            ) : (
              <div className="flex min-h-[420px] flex-col items-center justify-center rounded-3xl border border-dashed border-black/[0.14] bg-[#fcfcfc] px-6 text-center">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#f0f0f0] text-[#666]" aria-hidden="true"><PreviewIcon /></span>
                <h3 className="mt-5 text-[16px] font-semibold text-[#222]">你还没有创建任何站点</h3>
                <p className="mt-2 max-w-sm text-[11px] leading-5 text-[#777]">和 Apollo 聊聊你的想法，边构建边预览，确认后即可一键发布。</p>
                <button type="button" disabled={!available} onClick={startNew} className="mt-6 h-9 cursor-pointer rounded-full bg-[#171717] px-5 text-[11px] font-medium text-white transition-colors duration-200 hover:bg-[#343434] disabled:cursor-not-allowed disabled:opacity-35 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#171717]">创建网站</button>
              </div>
            )}
          </div>
        </main>
      </div>
    );
  }

  return (
    <div key="builder" className="app-view-motion flex min-h-0 flex-1 flex-col bg-white">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-black/[0.07] pl-12 pr-3 lg:px-4">
        <div className="flex min-w-0 items-center gap-3">
          <button type="button" onClick={() => setView('gallery')} className="flex h-8 cursor-pointer items-center gap-1.5 rounded-lg px-1.5 text-[11px] font-medium text-[#333] transition-colors duration-200 hover:bg-[#f3f3f3] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#171717]" aria-label="返回我的站点"><BackIcon /><span className="hidden sm:inline">我的站点</span></button>
          <span className="h-4 w-px bg-black/10" aria-hidden="true" />
          {sites.length > 0 && (
            <label className="min-w-0">
              <span className="sr-only">当前站点</span>
              <select
                value={selectedSlug}
                onChange={(event) => { const site = sites.find((item) => item.slug === event.target.value); if (site) openSite(site); }}
                className="max-w-24 cursor-pointer truncate rounded-lg border-0 bg-[#f3f3f3] px-2 py-1.5 text-[10px] text-[#555] outline-none focus-visible:ring-2 focus-visible:ring-black/15 sm:max-w-52 sm:px-2.5"
              >
                {!selectedSlug && <option value="">等待新站点发布</option>}
                {sites.map((site) => <option key={site.slug} value={site.slug}>{site.name}</option>)}
              </select>
            </label>
          )}
        </div>
        <div className="ml-2 flex shrink-0 items-center gap-1.5">
          {(elementSelections.length > 0 || pickingElement) && (
            <div className="hidden min-w-0 items-center gap-1 lg:flex">
              <div className="max-w-56 truncate text-[10px] text-[#777]" aria-live="polite" title={elementSelections.map((item) => item.label).join('、')}>
                {elementSelections.length ? <><span>已选择</span><code className="ml-1.5 text-[#2563eb]">{elementSelections.length} 个元素</code></> : '在预览中点击多个元素，Esc 结束'}
              </div>
              {elementSelections.length > 0 && <button type="button" onClick={() => onElementSelectionsChange([])} className="flex size-7 cursor-pointer items-center justify-center rounded-md text-[16px] leading-none text-[#999] hover:bg-[#f3f3f3] hover:text-[#333] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#171717]" aria-label="清除所选元素">×</button>}
            </div>
          )}
          <button type="button" disabled={!selectedSite} aria-pressed={pickingElement} onClick={toggleElementPicker} className={`h-8 cursor-pointer rounded-lg px-2.5 text-[10px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#2563eb] disabled:cursor-not-allowed disabled:opacity-35 ${pickingElement ? 'bg-[#eaf2ff] text-[#1d4ed8]' : 'text-[#444] hover:bg-[#f3f3f3]'}`}>
            {pickingElement ? '完成选择' : elementSelections.length ? '继续选择' : '选择元素'}
          </button>
          <button type="button" disabled={!available} onClick={startNew} className="h-8 cursor-pointer rounded-full bg-[#171717] px-3 text-[11px] font-medium text-white transition-colors hover:bg-[#343434] disabled:cursor-not-allowed disabled:opacity-35 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#171717] sm:px-4"><span className="sm:hidden">新建</span><span className="hidden sm:inline">新建站点</span></button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
        <aside
          style={{ '--site-chat-width': `${chatWidth}px` } as CSSProperties}
          className="flex h-[52dvh] min-h-[360px] w-full shrink-0 flex-col border-b border-black/[0.07] lg:h-auto lg:min-h-0 lg:w-[var(--site-chat-width)] lg:border-b-0"
          aria-label="站点对话"
        >
          <div className="min-h-0 flex-1">{chat}</div>
        </aside>

        <ResizeDivider
          value={chatWidth}
          min={CHAT_WIDTH.min}
          max={CHAT_WIDTH.max}
          growDirection={1}
          label="调整站点对话宽度"
          onChange={setChatWidth}
          onResizeStart={() => setResizing(true)}
          onResizeEnd={() => setResizing(false)}
        />

        <section className="flex h-[52dvh] min-h-[360px] min-w-0 flex-1 flex-col bg-[#f7f7f8] lg:h-auto lg:min-h-0" aria-label="站点实时预览">
          <div className="relative min-h-0 flex-1 overflow-hidden p-3">
            {selectedSite ? (
              <iframe
                ref={iframeRef}
                key={`${selectedSite.slug}:${selectedSite.publishedAt}`}
                src={selectedSite.url}
                title={`${selectedSite.name} 可交互预览`}
                sandbox="allow-scripts allow-forms allow-popups allow-modals allow-downloads"
                className={`app-state-motion h-full w-full rounded-xl border border-black/[0.09] bg-white shadow-[0_10px_30px_rgba(0,0,0,0.08)] ${resizing ? 'pointer-events-none' : ''}`}
              />
            ) : (
              <div className="app-state-motion flex h-full min-h-64 flex-col items-center justify-center rounded-xl border border-dashed border-black/[0.14] bg-white px-6 text-center">
                <PreviewIcon />
                <h2 className="mt-4 text-[15px] font-semibold text-[#242424]">边聊边做，实时查看</h2>
                <p className="mt-2 max-w-sm text-[10px] leading-5 text-[#777]">在左侧发网页链接或描述需求。Apollo 发布第一版后，预览会自动刷新，并且可以直接点击操作。</p>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}


function normalizeSelection(value: unknown): SiteElementSelection | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as Record<string, unknown>;
  if (data.type !== 'od:comment-target') return null;
  const string = (key: string, max: number) => typeof data[key] === 'string' ? data[key].slice(0, max) : '';
  const position = data.position && typeof data.position === 'object' ? data.position as Record<string, unknown> : {};
  const number = (key: string) => typeof position[key] === 'number' && Number.isFinite(position[key]) ? position[key] : 0;
  const rawStyle = data.style && typeof data.style === 'object' ? data.style as Record<string, unknown> : {};
  const style = Object.fromEntries(Object.entries(rawStyle).slice(0, 20).flatMap(([key, item]) => typeof item === 'string' ? [[key.slice(0, 50), item.slice(0, 300)]] : []));
  const selector = string('selector', 600);
  if (!selector) return null;
  return {
    elementId: string('elementId', 700) || `dom:${selector}`,
    selector,
    label: string('label', 200),
    text: string('text', 500),
    htmlHint: string('htmlHint', 1500),
    position: { x: number('x'), y: number('y'), width: number('width'), height: number('height') },
    style,
  };
}

function PreviewIcon() {
  return <svg viewBox="0 0 24 24" width="28" height="28" fill="none" className="text-[#777]" aria-hidden="true"><rect x="3.5" y="4" width="17" height="16" rx="2.5" stroke="currentColor" strokeWidth="1.6"/><path d="M3.5 8h17M7 6h.01M10 6h.01" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>;
}

function BackIcon() {
  return <svg viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true"><path d="m14.5 6-6 6 6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}

function ArrowIcon() {
  return <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true"><path d="M5 12h14m-5-5 5 5-5 5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}

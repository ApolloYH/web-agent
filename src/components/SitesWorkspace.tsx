import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { BrowserViewport } from '@/components/BrowserLivePanel';
import ResizeDivider from '@/components/ResizeDivider';
import type { ManagedBrowserView } from '@/lib/apolloAgent';
import { getPublishedSites, republishSite, type PublishedSite } from '@/lib/sites';

const CHAT_WIDTH = { default: 400, min: 320, max: 640 };

export default function SitesWorkspace({
  chat,
  browserView,
  refreshKey,
  onNewConversation,
  onSiteChange,
}: {
  chat: ReactNode;
  browserView: ManagedBrowserView | null;
  refreshKey: number;
  onNewConversation: () => void;
  onSiteChange: (site: PublishedSite | null) => void;
}) {
  const [sites, setSites] = useState<PublishedSite[]>([]);
  const [selectedSlug, setSelectedSlug] = useState('');
  const [view, setView] = useState<'gallery' | 'builder'>('gallery');
  const [loadingSites, setLoadingSites] = useState(true);
  const [available, setAvailable] = useState(true);
  const [busySlug, setBusySlug] = useState('');
  const [notice, setNotice] = useState('');
  const [preview, setPreview] = useState<'site' | 'browser'>('site');
  const [chatWidth, setChatWidth] = useState(CHAT_WIDTH.default);
  const [resizing, setResizing] = useState(false);
  const newSiteAfterRef = useRef(0);

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
        setPreview('site');
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
  useEffect(() => { if (browserView?.id) setPreview('browser'); }, [browserView?.id]);

  const startNew = () => {
    newSiteAfterRef.current = Date.now();
    setSelectedSlug('');
    setPreview('site');
    setNotice('');
    setView('builder');
    onNewConversation();
  };

  const openSite = (site: PublishedSite) => {
    newSiteAfterRef.current = 0;
    setSelectedSlug(site.slug);
    setPreview('site');
    setNotice('');
    setView('builder');
    onNewConversation();
  };

  const deploy = async () => {
    if (!selectedSite) return;
    setBusySlug(selectedSite.slug);
    setNotice('');
    try {
      const updated = await republishSite(selectedSite);
      setSites((items) => items.map((item) => item.slug === updated.slug ? updated : item));
      setNotice(`“${updated.name}”已重新部署`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusySlug('');
    }
  };

  if (view === 'gallery') {
    return (
      <div className="flex min-h-0 flex-1 flex-col bg-white">
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-black/[0.07] pl-12 pr-3 lg:px-4">
          <h1 className="text-[13px] font-semibold text-[#202020]">站点</h1>
          <button type="button" disabled={!available} onClick={startNew} className="h-8 cursor-pointer rounded-full bg-[#171717] px-4 text-[11px] font-medium text-white transition-colors duration-200 hover:bg-[#343434] disabled:cursor-not-allowed disabled:opacity-35 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#171717]">创建站点</button>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto px-5 py-8 sm:px-8 lg:px-12 lg:py-10">
          <div className="mx-auto w-full max-w-6xl">
            <div className="mb-7">
              <h2 className="text-[26px] font-semibold tracking-[-0.035em] text-[#171717] sm:text-[30px]">我的站点</h2>
              <p className="mt-2 text-[12px] text-[#777]">预览已经发布的站点，或与 Apollo 一起创建一个新站点。</p>
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
    <div className="flex min-h-0 flex-1 flex-col bg-white">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-black/[0.07] pl-12 pr-3 lg:px-4">
        <div className="flex min-w-0 items-center gap-3">
          <button type="button" onClick={() => setView('gallery')} className="flex h-8 cursor-pointer items-center gap-1.5 rounded-lg px-1.5 text-[11px] font-medium text-[#333] transition-colors duration-200 hover:bg-[#f3f3f3] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#171717]" aria-label="返回我的站点"><BackIcon /><span className="hidden sm:inline">我的站点</span></button>
          <span className="h-4 w-px bg-black/10" aria-hidden="true" />
          {sites.length > 0 && (
            <label className="min-w-0">
              <span className="sr-only">当前站点</span>
              <select
                value={selectedSlug}
                onChange={(event) => { setSelectedSlug(event.target.value); setPreview('site'); }}
                className="max-w-24 cursor-pointer truncate rounded-lg border-0 bg-[#f3f3f3] px-2 py-1.5 text-[10px] text-[#555] outline-none focus-visible:ring-2 focus-visible:ring-black/15 sm:max-w-52 sm:px-2.5"
              >
                {!selectedSlug && <option value="">等待新站点发布</option>}
                {sites.map((site) => <option key={site.slug} value={site.slug}>{site.name}</option>)}
              </select>
            </label>
          )}
        </div>
        <button type="button" disabled={!available} onClick={startNew} className="h-8 cursor-pointer rounded-full bg-[#171717] px-3 text-[11px] font-medium text-white transition-colors hover:bg-[#343434] disabled:cursor-not-allowed disabled:opacity-35 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#171717] sm:px-4"><span className="sm:hidden">新建</span><span className="hidden sm:inline">新建站点</span></button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
        <aside
          style={{ '--site-chat-width': `${chatWidth}px` } as CSSProperties}
          className="flex h-[52dvh] min-h-[360px] w-full shrink-0 flex-col border-b border-black/[0.07] lg:h-auto lg:min-h-0 lg:w-[var(--site-chat-width)] lg:border-b-0"
          aria-label="站点对话"
        >
          <div className="flex h-11 shrink-0 items-center justify-between border-b border-black/[0.06] px-4">
            <div>
              <p className="text-[11px] font-medium text-[#303030]">与 Apollo 一起构建</p>
              <p className="mt-0.5 text-[9px] text-[#888]">发链接、上传资料，或继续描述修改</p>
            </div>
            <span className="rounded-full bg-[#f2f2f2] px-2 py-1 text-[9px] text-[#666]">持续对话</span>
          </div>
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
          <header className="flex h-11 shrink-0 items-center justify-between border-b border-black/[0.07] bg-white px-3">
            <div className="flex items-center gap-1 rounded-lg bg-[#f3f3f3] p-0.5">
              <PreviewTab active={preview === 'site'} onClick={() => setPreview('site')}>网站预览</PreviewTab>
              <PreviewTab active={preview === 'browser'} onClick={() => setPreview('browser')}>参考网页</PreviewTab>
            </div>
            <div className="flex items-center gap-1.5">
              {notice && <span aria-live="polite" className="hidden max-w-48 truncate text-[9px] text-[#666] sm:block">{notice}</span>}
              {selectedSite && preview === 'site' && <>
                <button type="button" disabled={busySlug === selectedSite.slug} onClick={() => { void deploy(); }} className="h-7 cursor-pointer rounded-full px-2.5 text-[9px] font-medium text-[#555] transition-colors hover:bg-[#f2f2f2] disabled:cursor-wait disabled:opacity-50">{busySlug === selectedSite.slug ? '部署中…' : '重新部署'}</button>
                <a href={selectedSite.url} target="_blank" rel="noreferrer" className="inline-flex h-7 cursor-pointer items-center rounded-full bg-[#171717] px-3 text-[9px] font-medium text-white transition-colors hover:bg-[#343434]">新窗口打开</a>
              </>}
            </div>
          </header>

          <div className="flex h-10 shrink-0 items-center gap-2 border-b border-black/[0.06] bg-white px-3">
            <span className="text-[#858585]" aria-hidden="true"><LockIcon /></span>
            <div className="min-w-0 flex-1 truncate rounded-lg border border-black/[0.08] bg-[#f7f7f8] px-3 py-1.5 text-[9px] text-[#666]">
              {preview === 'browser' ? browserView?.url || '参考网页将在这里打开' : selectedSite?.url || '站点发布后会自动出现在这里'}
            </div>
          </div>

          <div className="relative min-h-0 flex-1 overflow-hidden p-3">
            {preview === 'browser' ? (
              <BrowserViewport view={browserView} className="h-full w-full rounded-xl border border-black/[0.09] shadow-[0_10px_30px_rgba(0,0,0,0.08)]" />
            ) : selectedSite ? (
              <iframe
                key={`${selectedSite.slug}:${selectedSite.publishedAt}`}
                src={selectedSite.url}
                title={`${selectedSite.name} 可交互预览`}
                sandbox="allow-scripts allow-forms allow-popups allow-modals allow-downloads"
                className={`h-full w-full rounded-xl border border-black/[0.09] bg-white shadow-[0_10px_30px_rgba(0,0,0,0.08)] ${resizing ? 'pointer-events-none' : ''}`}
              />
            ) : (
              <div className="flex h-full min-h-64 flex-col items-center justify-center rounded-xl border border-dashed border-black/[0.14] bg-white px-6 text-center">
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

function PreviewTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" onClick={onClick} className={`h-7 cursor-pointer rounded-md px-3 text-[9px] font-medium transition-colors ${active ? 'bg-white text-[#222] shadow-sm' : 'text-[#707070] hover:text-[#222]'}`}>{children}</button>;
}

function LockIcon() {
  return <svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true"><rect x="6.5" y="10" width="11" height="9" rx="2" stroke="currentColor" strokeWidth="1.6"/><path d="M9 10V7.8a3 3 0 0 1 6 0V10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>;
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

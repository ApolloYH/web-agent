import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { ManagedBrowserView } from '@/lib/apolloAgent';

export default function BrowserLivePanel({
  open,
  width,
  resizing,
  view,
  onClose,
}: {
  open: boolean;
  width: number;
  resizing: boolean;
  view: ManagedBrowserView | null;
  onClose: () => void;
}) {
  const [frameUrl, setFrameUrl] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const closeTimerRef = useRef<number | null>(null);

  useEffect(() => { setFrameUrl(null); }, [view?.id]);
  useEffect(() => {
    if (!open) return;
    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
    setClosing(false);
  }, [open]);
  useEffect(() => () => {
    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
  }, []);
  useEffect(() => {
    if (!view?.frame_version) return;
    const next = `/apollo-api/browser-view/frame?v=${encodeURIComponent(view.frame_version)}`;
    const image = new Image();
    let cancelled = false;
    image.decoding = 'async';
    image.fetchPriority = 'high';
    image.onload = () => { void image.decode().catch(() => undefined).then(() => { if (!cancelled) setFrameUrl(next); }); };
    image.src = next;
    return () => { cancelled = true; };
  }, [view?.frame_version]);

  const status = viewStatus(view);
  const visuallyOpen = open && !closing;
  const transition = resizing ? 'transition-none' : `transition-[opacity,transform] duration-200 motion-reduce:transition-none ${closing ? 'ease-in' : 'ease-out'}`;
  const requestClose = () => {
    if (closing) return;
    setClosing(true);
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return onClose();
    closeTimerRef.current = window.setTimeout(onClose, 200);
  };

  return (
    <aside
      aria-label="托管浏览器实时画面"
      aria-hidden={!visuallyOpen}
      inert={!visuallyOpen}
      style={{ '--browser-panel-width': `${width}px` } as CSSProperties}
      className={`relative z-30 flex shrink-0 transform-gpu flex-col overflow-hidden bg-[#f7f7f8] ${transition} ${closing ? 'lg:absolute lg:inset-y-0 lg:right-0' : ''} max-lg:absolute max-lg:inset-y-0 max-lg:right-0 max-lg:w-[min(640px,100%)] max-lg:shadow-[-18px_0_50px_rgba(0,0,0,0.14)] ${
        open ? 'w-[min(var(--browser-panel-width),calc(100%_-_420px))] border-l border-black/[0.08]' : 'pointer-events-none w-0 border-l border-transparent'
      } ${
        visuallyOpen ? 'translate-x-0 opacity-100' : 'pointer-events-none translate-x-full opacity-0'
      }`}
    >
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-black/[0.07] bg-white px-3.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <BrowserIcon />
          <span className="truncate text-[12px] font-semibold text-[#262626]">托管浏览器</span>
          <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-[#f2f3f4] px-2 py-1 text-[10px] font-medium text-[#59606a]">
            <span className={`h-1.5 w-1.5 rounded-full ${status.dot}${status.pulse ? ' animate-pulse' : ''}`} />
            {status.label}
          </span>
        </div>
        <button type="button" onClick={requestClose} className="icon-button inline-flex shrink-0" aria-label="关闭浏览器画面">
          <CloseIcon />
        </button>
      </header>

      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-black/[0.06] bg-white px-3">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-lg text-[#858585]" aria-hidden="true"><LockIcon /></span>
        <div className="min-w-0 flex-1 rounded-lg border border-black/[0.08] bg-[#f7f7f8] px-3 py-1.5 text-[10px] text-[#60646b] shadow-[inset_0_1px_1px_rgba(0,0,0,0.02)]">
          <span className="block truncate" title={view?.url || 'about:blank'}>{view?.url || 'about:blank'}</span>
        </div>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_50%_20%,#ffffff_0%,#f5f5f6_56%,#eeeeef_100%)] p-3">
        <div className="relative flex aspect-video max-h-full w-full min-h-52 items-center justify-center overflow-hidden rounded-xl border border-black/[0.09] bg-white shadow-[0_12px_34px_rgba(0,0,0,0.10)]">
          {view?.live_view_url ? (
            <iframe
              src={view.live_view_url}
              title={view?.title ? `托管浏览器：${view.title}` : '托管浏览器实时画面'}
              sandbox="allow-same-origin allow-scripts"
              allow="clipboard-read; clipboard-write"
              className="absolute inset-0 h-full w-full border-0"
            />
          ) : frameUrl ? (
            <img src={frameUrl} decoding="async" alt={view?.title ? `托管浏览器：${view.title}` : '托管浏览器实时画面'} className="absolute inset-0 h-full w-full object-contain object-center" />
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-8 text-center">
              <div className="flex size-12 items-center justify-center rounded-2xl bg-[#f2f3f4] text-[#777]"><BrowserIcon large /></div>
              <div>
                <p className="text-[12px] font-medium text-[#3b3b3b]">{view?.status === 'failed' ? '浏览器任务未完成' : '正在准备浏览器画面'}</p>
                <p className="mt-1 text-[10px] leading-5 text-[#777]">{view?.error || '启动浏览器后，实时画面会显示在这里。'}</p>
              </div>
            </div>
          )}
        </div>
      </div>

      <footer className="flex h-9 shrink-0 items-center justify-between border-t border-black/[0.06] bg-white px-3.5 text-[10px] text-[#777]">
        <span className="truncate" title={view?.title}>{view?.title || '等待页面载入'}</span>
        <span className="ml-3 shrink-0">{view?.step ? `第 ${view.step} 步` : '实时画面'}</span>
      </footer>
    </aside>
  );
}

function viewStatus(view: ManagedBrowserView | null) {
  if (view?.status === 'running') return { label: '正在操作', dot: 'bg-[#34a853]', pulse: true };
  if (view?.status === 'succeeded') return { label: '已完成', dot: 'bg-[#34a853]', pulse: false };
  if (view?.status === 'failed') return { label: '运行失败', dot: 'bg-[#ea4335]', pulse: false };
  return { label: '正在启动', dot: 'bg-[#fbbc05]', pulse: true };
}

function BrowserIcon({ large = false }: { large?: boolean }) {
  return <svg viewBox="0 0 24 24" width={large ? 25 : 18} height={large ? 25 : 18} fill="none" className="shrink-0" aria-hidden="true"><circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.7"/><path d="M3.8 9h16.4M3.8 15h16.4M12 3.5c2 2.3 3 5.1 3 8.5s-1 6.2-3 8.5c-2-2.3-3-5.1-3-8.5s1-6.2 3-8.5Z" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round"/></svg>;
}

function LockIcon() {
  return <svg viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true"><rect x="6.5" y="10" width="11" height="9" rx="2" stroke="currentColor" strokeWidth="1.6"/><path d="M9 10V7.8a3 3 0 0 1 6 0V10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>;
}

function CloseIcon() {
  return <svg viewBox="0 0 24 24" width="17" height="17" fill="none" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>;
}

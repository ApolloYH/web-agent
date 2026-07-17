import { useEffect, useState } from 'react';
import { getPublishedSites, republishSite, type PublishedSite } from '@/lib/sites';

export default function SitesWorkspace({ onCreate }: { onCreate: (description: string) => void }) {
  const [description, setDescription] = useState('');
  const [sites, setSites] = useState<PublishedSite[]>([]);
  const [available, setAvailable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busySlug, setBusySlug] = useState('');
  const [notice, setNotice] = useState('');

  const refresh = () => getPublishedSites().then((result) => {
    setAvailable(result.available);
    setSites(result.sites);
  }).catch((error) => setNotice(error instanceof Error ? error.message : String(error))).finally(() => setLoading(false));

  useEffect(() => { void refresh(); }, []);

  const deploy = async (site: PublishedSite) => {
    setBusySlug(site.slug);
    setNotice('');
    try {
      const updated = await republishSite(site);
      setSites((items) => items.map((item) => item.slug === updated.slug ? updated : item));
      setNotice(`“${site.name}”已重新部署`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusySlug('');
    }
  };

  const submit = () => {
    const value = description.trim();
    if (!value) return;
    onCreate(value);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-white">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-black/[0.06] pl-12 pr-4 lg:px-5">
        <div className="flex items-center gap-2.5"><SitesIcon /><h1 className="text-[13px] font-semibold text-[#202020]">站点</h1></div>
        <span className="text-[10px] text-[#858585]">{sites.length ? `${sites.length} 个站点` : '轻站点'}</span>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-8 lg:px-10">
        <div className="mx-auto max-w-6xl">
          <section className="rounded-2xl border border-black/[0.08] bg-[#fafafa] p-5 sm:p-6">
            <div className="max-w-2xl">
              <h2 className="text-[21px] font-semibold tracking-[-0.025em] text-[#171717]">把想法变成一个网站</h2>
              <p className="mt-1.5 text-[12px] leading-5 text-[#666]">描述用途、内容和风格，Apollo 会创建静态网站并在发布前请求你确认。</p>
            </div>
            <label htmlFor="site-description" className="mt-5 block text-[11px] font-medium text-[#333]">网站描述</label>
            <div className="mt-2 flex flex-col gap-2.5 sm:flex-row">
              <textarea
                id="site-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') submit(); }}
                rows={3}
                placeholder="例如：为我的摄影工作室做一个极简作品集，包含介绍、作品和联系方式"
                className="min-h-24 flex-1 resize-none rounded-xl border border-black/[0.10] bg-white px-3.5 py-3 text-[12px] leading-5 text-[#202020] outline-none transition-colors placeholder:text-[#aaa] focus:border-black/30 focus-visible:ring-2 focus-visible:ring-black/10"
              />
              <button type="button" disabled={!description.trim() || !available} onClick={submit} className="h-10 cursor-pointer self-end rounded-full bg-[#171717] px-5 text-[11px] font-medium text-white transition-colors hover:bg-[#333] disabled:cursor-not-allowed disabled:opacity-35 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#171717]">用 Apollo 创建</button>
            </div>
            {!available && <p className="mt-3 text-[11px] text-[#b45309]">管理员尚未配置独立站点域名，创建后暂时不能发布。</p>}
          </section>

          <div className="mt-8 flex items-end justify-between">
            <div><h2 className="text-[14px] font-semibold text-[#202020]">我的站点</h2><p className="mt-1 text-[10px] text-[#858585]">修改源文件后，可在这里一键重新部署。</p></div>
            {notice && <p aria-live="polite" className="text-[10px] text-[#555]">{notice}</p>}
          </div>

          {loading ? (
            <div className="flex h-48 items-center justify-center text-[11px] text-[#888]">正在读取站点…</div>
          ) : sites.length ? (
            <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {sites.map((site) => <SiteCard key={site.slug} site={site} busy={busySlug === site.slug} onDeploy={() => { void deploy(site); }} />)}
            </div>
          ) : (
            <div className="mt-4 flex h-48 flex-col items-center justify-center rounded-2xl border border-dashed border-black/[0.12] bg-[#fcfcfc] text-center">
              <div className="flex size-10 items-center justify-center rounded-xl bg-[#f0f0f0] text-[#777]"><SitesIcon /></div>
              <p className="mt-3 text-[12px] font-medium text-[#444]">还没有站点</p>
              <p className="mt-1 text-[10px] text-[#888]">在上方描述你想要的网站，Apollo 会完成创建和发布。</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SiteCard({ site, busy, onDeploy }: { site: PublishedSite; busy: boolean; onDeploy: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(site.url);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };
  return (
    <article className="overflow-hidden rounded-2xl border border-black/[0.08] bg-white transition-colors hover:border-black/[0.16]">
      <div className="aspect-[16/10] overflow-hidden border-b border-black/[0.06] bg-[#f4f4f4]">
        <iframe src={site.url} title={`${site.name} 预览`} sandbox="allow-scripts allow-forms" loading="lazy" tabIndex={-1} className="pointer-events-none h-[160%] w-[160%] origin-top-left scale-[0.625] border-0 bg-white" />
      </div>
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0"><h3 className="truncate text-[12px] font-semibold text-[#252525]">{site.name}</h3><p className="mt-1 truncate text-[9px] text-[#8a8a8a]" title={site.url}>{site.url}</p></div>
          <span className="flex shrink-0 items-center gap-1 rounded-full bg-[#edf7ef] px-2 py-1 text-[9px] font-medium text-[#347744]"><span className="size-1.5 rounded-full bg-[#42a85a]" />已发布</span>
        </div>
        <p className="mt-3 text-[9px] text-[#999]">{new Date(site.publishedAt).toLocaleString('zh-CN')} · {site.fileCount} 个文件</p>
        <div className="mt-4 flex items-center gap-2">
          <a href={site.url} target="_blank" rel="noreferrer" className="inline-flex h-8 cursor-pointer items-center rounded-full bg-[#171717] px-3.5 text-[10px] font-medium text-white transition-colors hover:bg-[#333] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#171717]">访问</a>
          <button type="button" onClick={copy} className="h-8 cursor-pointer rounded-full border border-black/[0.12] px-3 text-[10px] text-[#444] transition-colors hover:bg-[#f5f5f5] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#171717]">{copied ? '已复制' : '复制链接'}</button>
          <button type="button" disabled={busy} onClick={onDeploy} className="ml-auto h-8 cursor-pointer rounded-full px-2 text-[10px] font-medium text-[#555] transition-colors hover:bg-[#f2f2f2] disabled:cursor-wait disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#171717]">{busy ? '部署中…' : '重新部署'}</button>
        </div>
      </div>
    </article>
  );
}

function SitesIcon() {
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true"><path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5v-13Z" stroke="currentColor" strokeWidth="1.7"/><path d="M4 8h16M7 6h.01M10 6h.01M13 6h.01" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/></svg>;
}

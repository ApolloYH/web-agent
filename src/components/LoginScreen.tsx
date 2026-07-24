import { useEffect, useRef, useState } from 'react';
import { authenticate } from '@/lib/auth';
import type { AuthUser } from '@/lib/auth';

const githubUrl = 'https://github.com/ApolloYH/web-agent';

export default function LoginScreen({ hasUsers, registrationEnabled, onAuthenticated }: { hasUsers: boolean; registrationEnabled: boolean; onAuthenticated: (user: AuthUser) => void }) {
  const landingRef = useRef<HTMLElement>(null);
  const [mode, setMode] = useState<'login' | 'register'>(!hasUsers && registrationEnabled ? 'register' : 'login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    const root = landingRef.current;
    if (!root) return;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    root.classList.add('landing-ready');
    const reveals = root.querySelectorAll<HTMLElement>('[data-reveal]');
    if (reducedMotion) {
      reveals.forEach((element) => element.classList.add('is-visible'));
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.14, rootMargin: '0px 0px -8% 0px' });
    reveals.forEach((element) => observer.observe(element));
    let frame = 0;
    const updateScroll = () => {
      frame = 0;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      root.style.setProperty('--landing-progress', String(max > 0 ? window.scrollY / max : 0));
      root.style.setProperty('--landing-parallax', `${Math.min(window.scrollY * 0.04, 48)}px`);
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(updateScroll);
    };
    updateScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setLoading(true); setError('');
    try { onAuthenticated(await authenticate(mode, username, password, inviteCode)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setLoading(false); }
  };
  return (
    <main ref={landingRef} data-landing className="landing-page min-h-dvh overflow-x-clip bg-[#fafaf7] text-[#151515] selection:bg-[#c7dcff]">
      <div aria-hidden="true" className="landing-scroll-progress" />
      <nav aria-label="主导航" className="landing-nav sticky top-4 z-30 mx-auto flex h-16 w-[calc(100%-32px)] max-w-[1280px] items-center justify-between px-4 sm:px-6">
        <a href="#top" className="flex items-center gap-3 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#151515]">
          <img src="/apollo-avatar.jpg" alt="Apollo" className="size-9 rounded-full object-cover ring-1 ring-black/10" />
          <span className="text-[18px] font-semibold tracking-[-0.03em]">Apollo</span>
          <span className="hidden border-l border-black/15 pl-3 text-[10px] font-medium uppercase tracking-[0.18em] text-[#797979] sm:inline">Personal Super Agent</span>
        </a>
        <div className="flex items-center gap-2 sm:gap-5">
          <a href="/docs/" className="hidden rounded-lg px-2 py-2 text-[11px] font-medium text-[#545454] hover:text-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#151515] sm:block">使用文档</a>
          <a href={githubUrl} target="_blank" rel="noreferrer" aria-label="在新窗口打开 Apollo GitHub" className="inline-flex h-11 w-36 items-center justify-center gap-2 rounded-full border border-black/15 bg-white/60 text-[11px] font-semibold hover:border-black/30 hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#151515]">
            <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4 fill-current"><path d="M12 .7a11.5 11.5 0 0 0-3.64 22.4c.58.1.79-.25.79-.56v-2.23c-3.22.7-3.9-1.37-3.9-1.37-.52-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.71.08-.71 1.17.08 1.78 1.2 1.78 1.2 1.04 1.78 2.72 1.27 3.38.97.1-.75.4-1.27.74-1.56-2.57-.29-5.27-1.29-5.27-5.68 0-1.25.45-2.28 1.19-3.08-.12-.29-.52-1.46.11-3.04 0 0 .97-.31 3.16 1.18a10.9 10.9 0 0 1 5.76 0c2.2-1.49 3.16-1.18 3.16-1.18.63 1.58.23 2.75.11 3.04.74.8 1.19 1.83 1.19 3.08 0 4.4-2.71 5.38-5.29 5.67.42.36.79 1.07.79 2.16v3.2c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .7Z" /></svg>
            <span>GitHub</span>
          </a>
          <a href="#access" className="hidden h-11 w-36 items-center justify-center rounded-full bg-[#171717] text-[11px] font-semibold text-white hover:bg-[#343434] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#151515] sm:inline-flex">进入 Apollo</a>
        </div>
      </nav>

      <section id="top" className="landing-hero relative mx-auto flex max-w-[1280px] flex-col items-center px-5 pb-20 pt-20 text-center sm:px-8 sm:pt-28 lg:px-12 lg:pb-28 lg:pt-32">
        <div aria-hidden="true" className="landing-orb landing-orb-a" /><div aria-hidden="true" className="landing-orb landing-orb-b" />
        <div className="landing-hero-copy relative z-10 mx-auto max-w-[920px]">
          <div className="mb-7 flex items-center justify-center gap-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-[#676767]"><span className="h-px w-8 bg-[#676767]" />Open-source Web Agent</div>
          <h1 className="landing-hero-title mx-auto max-w-[920px] font-semibold text-[#121212]"><span className="block">住在 Web 上，</span><span className="block">替你真正行动。</span></h1>
          <p className="mx-auto mt-8 max-w-[720px] text-[16px] leading-8 text-[#565656] sm:text-[18px]">Apollo 是住在互联网上的 Web Agent。它能进入真实网页，理解页面与资料，完成读取、点击、填写、创建与发布，让目标直接变成可继续使用的结果。</p>
          <div className="mt-9 flex flex-wrap justify-center gap-3">
            <a href="#access" className="group inline-flex h-11 items-center justify-center gap-3 rounded-full bg-[#171717] px-5 text-[11px] font-semibold text-white hover:-translate-y-0.5 hover:bg-[#303030] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[#151515]">开始使用 <span aria-hidden="true" className="transition-transform group-hover:translate-x-1">→</span></a>
            <a href="/docs/" className="inline-flex h-11 items-center justify-center gap-3 rounded-full border border-black/15 bg-white/50 px-5 text-[11px] font-semibold hover:-translate-y-0.5 hover:border-black/30 hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[#151515]">阅读完整文档 <span aria-hidden="true">↗</span></a>
          </div>
        </div>

        <div aria-label="Apollo Web Agent 正在浏览并编辑网页的界面示意图" role="img" className="landing-product-wrap relative mt-16 w-full max-w-[1180px] sm:mt-20">
          <div className="absolute -inset-12 -z-10 opacity-60 [background-image:radial-gradient(circle_at_center,rgba(73,101,150,.16),transparent_64%)]" />
          <div className="landing-product overflow-hidden rounded-[22px] border border-black/[0.08] bg-[#f9f9f9] p-1.5 shadow-[0_46px_110px_rgba(0,0,0,0.16)] sm:p-2">
            <div className="flex h-11 items-center border-b border-black/[0.07] px-3 text-[#777] sm:px-4">
              <div className="flex gap-1.5"><span className="size-2 rounded-full bg-[#b8b8b8]" /><span className="size-2 rounded-full bg-[#cccccc]" /><span className="size-2 rounded-full bg-[#dddddd]" /></div>
              <div className="mx-auto flex h-7 w-[48%] max-w-[380px] items-center justify-center gap-2 rounded-lg border border-black/[0.07] bg-[#f4f4f4] text-[7px] tracking-[0.08em] sm:text-[8px]"><svg aria-hidden="true" viewBox="0 0 20 20" className="size-2.5 fill-none stroke-current stroke-[1.5]"><rect x="5" y="8" width="10" height="8" rx="2" /><path d="M7.5 8V6a2.5 2.5 0 0 1 5 0v2" /></svg>apollo.local / live-browser</div>
              <div className="flex items-center gap-1.5 text-[7px] font-medium uppercase tracking-[0.12em]"><span className="landing-browser-live size-1.5 rounded-full bg-[#0d0d0d]" /><span className="hidden sm:inline">Live</span></div>
            </div>

            <div className="grid min-h-[430px] grid-cols-[52px_minmax(0,1fr)] text-left sm:min-h-[520px] sm:grid-cols-[62px_minmax(0,1fr)] lg:grid-cols-[62px_minmax(0,1fr)_248px]">
              <aside className="flex flex-col items-center border-r border-black/[0.07] bg-[#f9f9f9] py-4 text-[#777]">
                <img src="/apollo-avatar.jpg" alt="" className="size-7 rounded-full object-cover ring-1 ring-black/10 sm:size-8" />
                <div className="mt-7 flex flex-col gap-2">
                  <span className="flex size-8 items-center justify-center rounded-lg bg-[#ececec] text-[#202123] shadow-[0_5px_18px_rgba(0,0,0,.18)] sm:size-9"><svg aria-hidden="true" viewBox="0 0 24 24" className="size-4 fill-none stroke-current stroke-[1.6]"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 4v-4A2.5 2.5 0 0 1 3 13.5v-8Z" /></svg></span>
                  <span className="flex size-8 items-center justify-center rounded-lg sm:size-9"><svg aria-hidden="true" viewBox="0 0 24 24" className="size-4 fill-none stroke-current stroke-[1.6]"><circle cx="12" cy="12" r="8.5" /><path d="m9.5 14.5 1.4-4.2 4.1-1.5-1.4 4.2-4.1 1.5Z" /></svg></span>
                  <span className="flex size-8 items-center justify-center rounded-lg sm:size-9"><svg aria-hidden="true" viewBox="0 0 24 24" className="size-4 fill-none stroke-current stroke-[1.6]"><path d="M5 4h14v16H5zM8 8h8M8 12h8M8 16h5" /></svg></span>
                  <span className="flex size-8 items-center justify-center rounded-lg sm:size-9"><svg aria-hidden="true" viewBox="0 0 24 24" className="size-4 fill-none stroke-current stroke-[1.6]"><path d="M4 18.5V8l8-4.5L20 8v10.5M8 20v-7h8v7" /></svg></span>
                </div>
                <span className="mt-auto flex size-8 items-center justify-center rounded-full border border-black/[0.07] text-[8px] sm:size-9">AY</span>
              </aside>

              <div className="flex min-w-0 flex-col bg-white p-3 sm:p-5 lg:p-6">
                <header className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-[7px] font-semibold uppercase tracking-[0.18em] text-[#8e8ea0]"><span className="h-px w-5 bg-[#d7d7d7]" />Current run</div>
                    <h3 className="mt-2 truncate text-[12px] font-semibold tracking-[-0.02em] text-[#0d0d0d] sm:text-[15px]">重构品牌首页，并发布预览</h3>
                  </div>
                  <span className="hidden shrink-0 items-center gap-1.5 rounded-full border border-black/[0.08] bg-white px-3 py-1.5 text-[7px] font-medium text-[#555] sm:flex"><span className="size-1.5 rounded-full bg-[#777]" />浏览器已连接</span>
                </header>

                <div className="mt-4 overflow-hidden rounded-[14px] border border-black/[0.08] bg-white shadow-[0_18px_45px_rgba(0,0,0,.08)] sm:mt-5 sm:rounded-[17px]">
                  <div className="flex h-9 items-center gap-2 border-b border-black/[0.07] bg-[#f4f4f4] px-3 sm:h-10">
                    <div className="flex gap-1"><span className="size-1.5 rounded-full bg-[#c7c7c7]" /><span className="size-1.5 rounded-full bg-[#d7d7d7]" /></div>
                    <div className="mx-auto flex h-5 w-[58%] items-center justify-center rounded-md border border-black/[0.07] bg-white/80 text-[6px] text-[#777] sm:h-6 sm:text-[7px]">aster.studio / home</div>
                    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-3 fill-none stroke-[#777] stroke-[1.6]"><path d="M4 12a8 8 0 1 0 2.3-5.6M4 4v5h5" /></svg>
                  </div>

                  <div className="relative min-h-[285px] overflow-hidden bg-white p-4 sm:min-h-[340px] sm:p-6">
                    <div className="flex items-center justify-between border-b border-black/[0.08] pb-3 text-[6px] font-semibold uppercase tracking-[0.15em] text-[#555] sm:text-[7px]"><span>Aster / Independent Studio</span><span>Work&nbsp;&nbsp; About&nbsp;&nbsp; Contact</span></div>
                    <div className="grid gap-5 pt-6 sm:grid-cols-[1.05fr_.95fr] sm:gap-7 sm:pt-8">
                      <div>
                        <p className="text-[6px] font-semibold uppercase tracking-[0.2em] text-[#8f8f8f] sm:text-[7px]">Digital objects · 2026</p>
                        <p className="mt-3 max-w-[340px] font-serif text-[24px] leading-[0.95] tracking-[-0.045em] text-[#0d0d0d] sm:mt-4 sm:text-[38px] lg:text-[46px]">Ideas shaped<br />for the web.</p>
                        <p className="mt-4 max-w-[260px] text-[7px] leading-4 text-[#777] sm:text-[8px]">把品牌、内容与交互编排成真正可以访问、操作和持续生长的网站。</p>
                        <div className="relative mt-5 inline-flex h-7 items-center rounded-full bg-[#0d0d0d] px-4 text-[7px] font-semibold text-white sm:h-8 sm:px-5">
                          View selected work
                          <span className="landing-agent-cursor absolute -right-3 -top-3 rounded-md bg-[#315fba] px-1.5 py-1 text-[6px] font-semibold text-white shadow-md">Apollo</span>
                        </div>
                      </div>
                      <div className="relative hidden min-h-[190px] overflow-hidden rounded-[10px] bg-[#ececec] sm:block">
                        <div className="absolute inset-0 [background-image:linear-gradient(rgba(255,255,255,.42)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.42)_1px,transparent_1px)] [background-size:34px_34px]" />
                        <div className="absolute inset-x-5 bottom-5 top-5 border border-black/10 bg-[#202123] p-4 text-white">
                          <span className="text-[6px] uppercase tracking-[0.18em] text-[#777]">Selected project 01</span>
                          <p className="absolute bottom-4 left-4 font-serif text-[22px] leading-none">Web<br />native.</p>
                          <div className="absolute right-4 top-4 size-8 rounded-full border border-white/25" />
                        </div>
                      </div>
                    </div>
                    <div className="landing-selection absolute bottom-3 left-3 right-3 flex h-6 items-center justify-between rounded-md border border-[#315fba]/30 bg-[#edf3ff]/95 px-2 text-[6px] text-[#315fba] sm:bottom-4 sm:left-auto sm:right-4 sm:w-[210px]"><span>button.cta · selected</span><span>192 × 32</span></div>
                  </div>
                </div>

                <div className="mt-3 flex items-center gap-2 text-[7px] text-[#777] sm:mt-4"><span className="landing-browser-live size-1.5 rounded-full bg-[#315fba]" /><span>正在检查页面结构与交互状态</span><span className="ml-auto hidden font-mono text-[#8f8f8f] sm:inline">18 nodes · 6.4s</span></div>
              </div>

              <aside className="hidden flex-col border-l border-black/[0.08] bg-white p-5 lg:flex">
                <div className="flex items-center justify-between"><div><p className="text-[7px] font-semibold uppercase tracking-[0.18em] text-[#8e8ea0]">Apollo agent</p><p className="mt-1.5 text-[11px] font-semibold tracking-[-0.02em]">网页执行记录</p></div><span className="flex size-7 items-center justify-center rounded-full border border-black/[0.08] bg-white"><span className="landing-browser-live size-1.5 rounded-full bg-[#777]" /></span></div>
                <div className="mt-7 space-y-5 border-l border-black/[0.08] pl-4">
                  <div className="relative"><span className="absolute -left-[19px] top-1 size-2 rounded-full border-2 border-white bg-[#202123]" /><p className="text-[8px] font-semibold">读取页面</p><p className="mt-1 text-[7px] leading-4 text-[#777]">识别导航、版式与 18 个可操作节点</p></div>
                  <div className="relative"><span className="absolute -left-[19px] top-1 size-2 rounded-full border-2 border-white bg-[#202123]" /><p className="text-[8px] font-semibold">选择元素</p><p className="mt-1 text-[7px] leading-4 text-[#777]">已定位首屏主行动按钮</p></div>
                  <div className="relative"><span className="landing-activity-dot absolute -left-[19px] top-1 size-2 rounded-full border-2 border-white bg-[#315fba]" /><p className="text-[8px] font-semibold text-[#315fba]">正在优化交互</p><p className="mt-1 text-[7px] leading-4 text-[#777]">调整文案、间距与悬停反馈</p></div>
                </div>
                <div className="mt-auto rounded-[12px] bg-[#0d0d0d] p-4 text-white shadow-[0_15px_35px_rgba(0,0,0,.15)]"><div className="flex items-center justify-between text-[7px] text-[#777]"><span>NEXT ACTION</span><span>03 / 04</span></div><p className="mt-3 text-[9px] font-medium leading-5">生成预览并等待你的确认</p><div className="mt-4 flex items-center gap-2"><span className="h-1 flex-1 overflow-hidden rounded-full bg-[#d7d7d7]"><span className="block h-full w-3/4 rounded-full bg-white" /></span><span className="text-[7px] text-[#777]">75%</span></div></div>
              </aside>
            </div>
          </div>
        </div>
      </section>

      <div aria-hidden="true" className="landing-marquee border-y border-black/10 bg-white/45">
        <div className="landing-marquee-track">{[0, 1].map((copy) => <div key={copy} className="flex shrink-0 items-center">{['对话协作', '文件理解', '双路 RAG', '知识图谱', '文档制作', '网站生成', '浏览器执行', '开源可控'].map((label) => <span key={`${copy}-${label}`} className="flex items-center gap-8 px-4 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#646464] sm:px-7">{label}<i className="size-1.5 rounded-full bg-[#77a7ef]" /></span>)}</div>)}</div>
      </div>

      <section aria-labelledby="capabilities-title" className="landing-dark border-b border-black/10 bg-[#181818] text-white">
        <div className="mx-auto max-w-[1280px] px-5 py-20 sm:px-8 lg:px-12 lg:py-28">
          <div className="grid gap-10 lg:grid-cols-[0.72fr_1.28fr]">
            <div data-reveal><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/45">One workspace, real outcomes</p><h2 id="capabilities-title" className="mt-5 max-w-[430px] text-[38px] font-semibold leading-[1.08] tracking-[-0.045em] sm:text-[48px]">不止回答问题，更把结果做出来。</h2><p className="mt-6 max-w-[430px] text-[13px] leading-7 text-white/55">每项能力都围绕同一个目标：减少工具切换，让资料、推理、执行和交付留在一条连续的工作流里。</p></div>
            <div className="grid border-l border-white/10 sm:grid-cols-2">
              {[['01', '理解你的资料', '上传 Word、PDF、Markdown、图片或整个文件夹。Apollo 能阅读、检索并把结果写回工作区。'], ['02', '吃透知识脉络', 'WeKnora 文段召回与 LightRAG 知识图谱协同返回实体、关系、路径和原文依据。'], ['03', '直接制作与修改', '生成文档和网站，通过可视化预览继续编辑；选中多个网页元素后可直接对话修改。'], ['04', '在网页中行动', '使用隔离浏览器或连接自己的 Chrome 标签页，过程可见、随时停止，并受权限控制。']].map(([number, title, body]) => <article data-reveal key={number} className="landing-capability border-b border-r border-white/10 p-7 sm:p-9"><span className="text-[9px] tracking-[0.2em] text-white/35">{number}</span><h3 className="mt-12 text-[17px] font-medium tracking-[-0.025em]">{title}</h3><p className="mt-4 text-[11px] leading-6 text-white/50">{body}</p></article>)}
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[1280px] px-5 py-20 sm:px-8 lg:px-12 lg:py-28">
        <div data-reveal className="mb-12 flex flex-col justify-between gap-5 border-b border-black/10 pb-8 sm:flex-row sm:items-end">
          <div><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#777]">Native to the open web</p><h2 className="mt-4 max-w-[760px] text-[36px] font-semibold leading-[1.08] tracking-[-0.05em] sm:text-[48px]">住在互联网上，理解、创造，也真正行动。</h2></div>
          <a href="/docs/" className="group text-[11px] font-semibold underline decoration-black/25 underline-offset-8 hover:decoration-black focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#151515]">查看 Web Agent 指南 <span className="inline-block transition-transform group-hover:translate-x-1">→</span></a>
        </div>
        <div className="grid gap-px overflow-hidden rounded-[14px] border border-black/10 bg-black/10 md:grid-cols-3">
          <article data-reveal className="landing-journey-card flex flex-col bg-[#eaf0f4] p-7 sm:p-9">
            <span className="inline-flex w-fit rounded-full border border-[#6f879a]/35 px-3 py-1 text-[8px] font-semibold uppercase tracking-[0.15em] text-[#536d80]">Understand</span>
            <h3 className="mt-12 text-[26px] font-semibold leading-[1.2] tracking-[-0.04em]">看见页面，<br />也读懂页面结构。</h3>
            <p className="mt-5 text-[11px] leading-6 text-[#586c79]">视觉、DOM 和页面状态一起理解。不是只截一张图，也不靠猜。</p>
            <div aria-hidden="true" className="mt-12 overflow-hidden rounded-[12px] border border-[#7890a0]/25 bg-white shadow-[0_14px_30px_rgba(55,73,86,0.12)] md:mt-auto">
              <div className="flex h-8 items-center gap-1.5 border-b border-black/10 bg-[#f7f8f8] px-3"><i className="size-1.5 rounded-full bg-[#ef776d]" /><i className="size-1.5 rounded-full bg-[#e9bb52]" /><i className="size-1.5 rounded-full bg-[#65b67b]" /><span className="mx-auto rounded border border-black/10 bg-white px-5 py-1 text-[6px] text-[#879098]">apollo.yh521.top/docs</span></div>
              <div className="grid h-[150px] grid-cols-[1fr_88px]">
                <div className="relative bg-[#fbfbfa] p-3"><div className="flex items-center justify-between"><b className="text-[7px] tracking-[-0.02em]">Apollo Docs</b><span className="text-[5px] text-[#7a8186]">Guide · API</span></div><div className="relative mt-5 rounded-md border-2 border-[#4c83c3] bg-[#eef5fb] p-3"><span className="absolute -top-2 left-2 bg-[#4c83c3] px-1.5 py-0.5 font-mono text-[5px] text-white">section.hero</span><b className="block text-[9px]">Connect the open web.</b><span className="mt-2 block h-1 w-4/5 rounded bg-[#8da5b5]/35" /><span className="mt-1 block h-1 w-3/5 rounded bg-[#8da5b5]/25" /><span className="mt-3 inline-flex rounded bg-[#182126] px-2 py-1 text-[5px] text-white">Read guide</span></div><svg viewBox="0 0 20 24" className="absolute bottom-4 right-5 h-6 w-5 fill-[#161b1e] stroke-white stroke-[1.2]"><path d="M2 1.5v17l4.8-4 3.2 7 3.4-1.6-3.2-6.6H17L2 1.5Z" /></svg></div>
                <div className="border-l border-black/10 bg-[#f3f5f5] p-2 font-mono text-[5px] leading-4 text-[#64717a]"><b className="text-[#27343c]">DOM</b><div className="mt-2 text-[#8a949a]">&lt;main&gt;</div><div className="pl-2 text-[#3f70a8]">&lt;section&gt;</div><div className="pl-4">&lt;h1&gt;</div><div className="pl-4">&lt;p&gt;</div><div className="pl-4">&lt;button&gt;</div><div className="pl-2 text-[#3f70a8]">&lt;/section&gt;</div><div className="text-[#8a949a]">&lt;/main&gt;</div></div>
              </div>
            </div>
          </article>
          <article data-reveal className="landing-journey-card flex flex-col bg-[#f0ede8] p-7 sm:p-9">
            <span className="inline-flex w-fit rounded-full border border-[#907b64]/35 px-3 py-1 text-[8px] font-semibold uppercase tracking-[0.15em] text-[#765f49]">Build</span>
            <h3 className="mt-12 text-[26px] font-semibold leading-[1.2] tracking-[-0.04em]">不只生成代码，<br />直接把网站做出来。</h3>
            <p className="mt-5 text-[11px] leading-6 text-[#74685d]">真实预览、选中元素、继续修改。结果从一开始就活在网页里。</p>
            <div aria-hidden="true" className="mt-12 overflow-hidden rounded-[12px] border border-[#907b64]/25 bg-white shadow-[0_14px_30px_rgba(71,61,51,0.12)] md:mt-auto">
              <div className="flex h-8 items-center gap-1.5 border-b border-black/10 bg-[#faf9f7] px-3"><i className="size-1.5 rounded-full bg-[#ef776d]" /><i className="size-1.5 rounded-full bg-[#e9bb52]" /><i className="size-1.5 rounded-full bg-[#65b67b]" /><span className="mx-auto rounded border border-black/10 bg-white px-6 py-1 text-[6px] text-[#908880]">studio.apollo.site</span></div>
              <div className="relative h-[150px] overflow-hidden bg-[#f7f3ed] p-3"><div className="flex items-center justify-between"><b className="text-[6px] tracking-[0.18em]">NORTH / STUDIO</b><span className="text-[5px] text-[#7e756b]">WORK · ABOUT · CONTACT</span></div><div className="mt-5 grid grid-cols-[1.08fr_.92fr] gap-3"><div><b className="block text-[15px] leading-[1.02] tracking-[-0.06em]">Built for<br />the open web.</b><span className="mt-3 inline-flex rounded-full bg-[#db5e3d] px-2.5 py-1 text-[5px] font-semibold text-white">View projects →</span></div><div className="grid grid-cols-2 gap-1"><span className="h-16 bg-[#d1baa5]" /><span className="h-16 bg-[#425d69]" /><span className="col-span-2 h-6 bg-[#d9d3c8]" /></div></div><div className="absolute inset-y-10 left-2 right-2 rounded border-2 border-[#467fbd]"><span className="absolute -top-3 right-2 rounded bg-[#467fbd] px-2 py-1 text-[5px] font-semibold text-white">Hero selected · Edit</span><i className="absolute -left-1 -top-1 size-2 rounded-full border border-white bg-[#467fbd]" /><i className="absolute -right-1 -top-1 size-2 rounded-full border border-white bg-[#467fbd]" /><i className="absolute -bottom-1 -left-1 size-2 rounded-full border border-white bg-[#467fbd]" /><i className="absolute -bottom-1 -right-1 size-2 rounded-full border border-white bg-[#467fbd]" /></div></div>
            </div>
          </article>
          <article data-reveal className="landing-journey-card flex flex-col bg-[#e9efea] p-7 sm:p-9">
            <span className="inline-flex w-fit rounded-full border border-[#6f8977]/35 px-3 py-1 text-[8px] font-semibold uppercase tracking-[0.15em] text-[#58715f]">Act</span>
            <h3 className="mt-12 text-[26px] font-semibold leading-[1.2] tracking-[-0.04em]">像用户一样操作，<br />控制权仍然属于你。</h3>
            <p className="mt-5 text-[11px] leading-6 text-[#617166]">读取、点击、填写、下载；敏感操作先确认，过程可见、随时停止。</p>
            <div aria-hidden="true" className="mt-12 overflow-hidden rounded-[12px] border border-[#758b7b]/25 bg-white shadow-[0_14px_30px_rgba(54,72,60,0.12)] md:mt-auto">
              <div className="flex h-8 items-center gap-1.5 border-b border-black/10 bg-[#f7f9f7] px-3"><i className="size-1.5 rounded-full bg-[#ef776d]" /><i className="size-1.5 rounded-full bg-[#e9bb52]" /><i className="size-1.5 rounded-full bg-[#65b67b]" /><span className="mx-auto rounded border border-black/10 bg-white px-6 py-1 text-[6px] text-[#7d8a80]">chrome://connected-tab</span></div>
              <div className="h-[150px] bg-[#fbfcfb] p-3"><div className="mb-2 flex items-center justify-between"><b className="text-[7px]">执行过程</b><span className="flex items-center gap-1 text-[5px] text-[#65806c]"><i className="size-1.5 rounded-full bg-[#50a56c]" />实时连接</span></div><div className="space-y-1.5"><div className="flex items-center gap-2 rounded-md border border-black/[0.06] bg-[#f5f7f5] px-2 py-1.5"><span className="flex size-4 items-center justify-center rounded-full bg-[#dce9df] text-[6px] text-[#39764c]">✓</span><span className="text-[6px] font-medium">读取价格页面</span><span className="ml-auto text-[5px] text-[#879188]">完成</span></div><div className="flex items-center gap-2 rounded-md border border-black/[0.06] bg-[#f5f7f5] px-2 py-1.5"><span className="flex size-4 items-center justify-center rounded-full bg-[#dce9df] text-[6px] text-[#39764c]">✓</span><span className="text-[6px] font-medium">比较 6 个方案</span><span className="ml-auto text-[5px] text-[#879188]">完成</span></div><div className="flex items-center gap-2 rounded-md border border-[#c9a96a]/40 bg-[#fffaf0] px-2 py-2"><span className="flex size-4 items-center justify-center rounded-full bg-[#1d2420] text-[6px] text-white">3</span><div><b className="block text-[6px]">提交表单</b><span className="text-[5px] text-[#8b7d66]">将向网站发送信息</span></div><span className="ml-auto rounded-full bg-[#1d2420] px-2 py-1 text-[5px] font-semibold text-white">等待确认</span></div></div></div>
            </div>
          </article>
        </div>
      </section>

      <section id="access" className="border-t border-black/10 bg-white">
        <div className="mx-auto grid max-w-[1200px] gap-12 px-5 py-20 sm:px-8 lg:grid-cols-[1fr_400px] lg:items-center lg:px-12 lg:py-28">
          <div data-reveal><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#777]">Your next task starts here</p><h2 className="mt-5 max-w-[620px] text-[42px] font-semibold leading-[1.04] tracking-[-0.055em] sm:text-[58px]">少切换几个工具，<br />多完成一件事情。</h2><p className="mt-7 max-w-[530px] text-[13px] leading-7 text-[#676767]">登录后即可进入完整工作区。第一次使用？先读<a href="/docs/" className="mx-1 font-semibold text-[#1f5fae] underline decoration-[#1f5fae]/30 underline-offset-4 hover:decoration-[#1f5fae]">使用文档</a>，了解文件、知识库、站点和浏览器能力。</p><a href={githubUrl} target="_blank" rel="noreferrer" className="group mt-8 inline-flex items-center gap-3 text-[11px] font-semibold hover:text-[#555] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#151515]"><svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 fill-current"><path d="M12 .7a11.5 11.5 0 0 0-3.64 22.4c.58.1.79-.25.79-.56v-2.23c-3.22.7-3.9-1.37-3.9-1.37-.52-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.71.08-.71 1.17.08 1.78 1.2 1.78 1.2 1.04 1.78 2.72 1.27 3.38.97.1-.75.4-1.27.74-1.56-2.57-.29-5.27-1.29-5.27-5.68 0-1.25.45-2.28 1.19-3.08-.12-.29-.52-1.46.11-3.04 0 0 .97-.31 3.16 1.18a10.9 10.9 0 0 1 5.76 0c2.2-1.49 3.16-1.18 3.16-1.18.63 1.58.23 2.75.11 3.04.74.8 1.19 1.83 1.19 3.08 0 4.4-2.71 5.38-5.29 5.67.42.36.79 1.07.79 2.16v3.2c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .7Z" /></svg>开源项目，欢迎点亮 Star <span className="transition-transform group-hover:translate-x-1">↗</span></a></div>
          <form data-reveal onSubmit={submit} className="landing-access-card rounded-[16px] border border-black/10 bg-[#f7f7f4] p-6 shadow-[0_24px_70px_rgba(0,0,0,0.08)] sm:p-8">
            <div className="mb-7 flex items-center justify-between"><div><p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-[#858585]">Apollo workspace</p><h3 className="mt-2 text-[20px] font-semibold tracking-[-0.03em]">{mode === 'login' ? '欢迎回来' : '创建账号'}</h3></div><img src="/apollo-avatar.jpg" alt="" className="size-10 rounded-full object-cover" /></div>
            <div key={mode} className="app-state-motion space-y-3">
              <label className="block"><span className="mb-1.5 block text-[9px] font-medium text-[#686868]">用户名</span><input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" className="h-11 w-full rounded-[9px] border border-black/15 bg-white px-3.5 text-[11px] outline-none placeholder:text-[#aaa] focus:border-[#555] focus:ring-2 focus:ring-black/5" placeholder="输入用户名" /></label>
              <label className="block"><span className="mb-1.5 block text-[9px] font-medium text-[#686868]">密码</span><input value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} type="password" className="h-11 w-full rounded-[9px] border border-black/15 bg-white px-3.5 text-[11px] outline-none placeholder:text-[#aaa] focus:border-[#555] focus:ring-2 focus:ring-black/5" placeholder="至少 8 位" /></label>
              {mode === 'register' && <label className="block"><span className="mb-1.5 block text-[9px] font-medium text-[#686868]">注册邀请码</span><input value={inviteCode} onChange={(event) => setInviteCode(event.target.value)} type="password" className="h-11 w-full rounded-[9px] border border-black/15 bg-white px-3.5 text-[11px] outline-none placeholder:text-[#aaa] focus:border-[#555] focus:ring-2 focus:ring-black/5" placeholder="输入有效邀请码" /></label>}
            </div>
            {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-[9px] text-red-700">{error}</p>}
            <button disabled={loading || !username.trim() || password.length < 8 || (mode === 'register' && !inviteCode)} className="mt-5 h-11 w-full rounded-[9px] bg-[#171717] text-[11px] font-semibold text-white hover:bg-[#333] disabled:cursor-not-allowed disabled:bg-[#b9b9b5]">{loading ? '请稍候…' : mode === 'login' ? '登录工作区' : '创建并登录'}</button>
            {registrationEnabled && <button type="button" onClick={() => { setMode((value) => value === 'login' ? 'register' : 'login'); setError(''); }} className="mt-3 w-full py-2 text-[9px] font-medium text-[#6f6f6f] hover:text-[#171717]">{mode === 'login' ? '使用邀请码创建账号' : '已有账号？返回登录'}</button>}
            <p className="mt-5 border-t border-black/10 pt-4 text-center text-[8px] leading-4 text-[#969696]">登录即表示你仅在授权范围内使用 Apollo。</p>
          </form>
        </div>
      </section>

      <footer className="border-t border-black/10 bg-white"><div className="mx-auto flex max-w-[1280px] flex-col justify-between gap-4 px-5 py-8 text-[9px] text-[#7c7c7c] sm:flex-row sm:items-center sm:px-8 lg:px-12"><span>© 2026 Apollo · Personal Super Agent</span><div className="flex gap-6"><a href="/docs/" className="hover:text-black">使用文档</a><a href={githubUrl} target="_blank" rel="noreferrer" className="hover:text-black">GitHub</a><a href="#top" className="hover:text-black">返回顶部 ↑</a></div></div></footer>
    </main>
  );
}

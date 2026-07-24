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
          <a href={githubUrl} target="_blank" rel="noreferrer" aria-label="在 GitHub 上为 Apollo 点亮 Star（在新窗口打开）" className="inline-flex items-center gap-2 rounded-full border border-black/15 bg-white/60 px-3 py-2 text-[10px] font-semibold hover:border-black/30 hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#151515] sm:px-4">
            <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4 fill-current"><path d="M12 .7a11.5 11.5 0 0 0-3.64 22.4c.58.1.79-.25.79-.56v-2.23c-3.22.7-3.9-1.37-3.9-1.37-.52-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.71.08-.71 1.17.08 1.78 1.2 1.78 1.2 1.04 1.78 2.72 1.27 3.38.97.1-.75.4-1.27.74-1.56-2.57-.29-5.27-1.29-5.27-5.68 0-1.25.45-2.28 1.19-3.08-.12-.29-.52-1.46.11-3.04 0 0 .97-.31 3.16 1.18a10.9 10.9 0 0 1 5.76 0c2.2-1.49 3.16-1.18 3.16-1.18.63 1.58.23 2.75.11 3.04.74.8 1.19 1.83 1.19 3.08 0 4.4-2.71 5.38-5.29 5.67.42.36.79 1.07.79 2.16v3.2c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .7Z" /></svg>
            <span className="hidden sm:inline">GitHub</span> Star
            <svg aria-hidden="true" viewBox="0 0 24 24" className="size-3.5 fill-none stroke-current stroke-[1.8]"><path d="m12 3 2.75 5.57 6.15.9-4.45 4.33 1.05 6.12L12 17.03l-5.5 2.89 1.05-6.12L3.1 9.47l6.15-.9L12 3Z" /></svg>
          </a>
          <a href="#access" className="hidden rounded-full bg-[#171717] px-4 py-2.5 text-[10px] font-semibold text-white hover:bg-[#343434] sm:block focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#151515] sm:px-5">进入 Apollo</a>
        </div>
      </nav>

      <section id="top" className="landing-hero relative mx-auto flex max-w-[1280px] flex-col items-center px-5 pb-20 pt-20 text-center sm:px-8 sm:pt-28 lg:px-12 lg:pb-28 lg:pt-32">
        <div aria-hidden="true" className="landing-orb landing-orb-a" /><div aria-hidden="true" className="landing-orb landing-orb-b" />
        <div className="landing-hero-copy relative z-10 mx-auto max-w-[920px]">
          <div className="mb-7 flex items-center justify-center gap-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-[#676767]"><span className="h-px w-8 bg-[#676767]" />Open-source AI workspace</div>
          <h1 className="landing-hero-title mx-auto max-w-[920px] font-semibold text-[#121212]"><span className="block">把复杂工作，</span><span className="block">交给会行动的 AI。</span></h1>
          <p className="mx-auto mt-8 max-w-[720px] text-[16px] leading-8 text-[#565656] sm:text-[18px]">Apollo 把对话、文件、知识图谱、网站制作和浏览器操作放进同一个工作区。你只需说明目标，它负责理解资料、调用工具并交付可继续编辑的结果。</p>
          <div className="mt-9 flex flex-wrap justify-center gap-3">
            <a href="#access" className="group inline-flex items-center gap-3 rounded-full bg-[#171717] px-6 py-3.5 text-[11px] font-semibold text-white hover:-translate-y-0.5 hover:bg-[#303030] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[#151515]">开始使用 <span aria-hidden="true" className="transition-transform group-hover:translate-x-1">→</span></a>
            <a href="/docs/" className="inline-flex items-center gap-3 rounded-full border border-black/15 bg-white/50 px-6 py-3.5 text-[11px] font-semibold hover:-translate-y-0.5 hover:border-black/30 hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[#151515]">阅读完整文档 <span aria-hidden="true">↗</span></a>
          </div>
          <dl className="mx-auto mt-12 grid max-w-[560px] grid-cols-3 border-y border-black/10 py-5">
            <div><dt className="text-[9px] uppercase tracking-[0.14em] text-[#848484]">工作入口</dt><dd className="mt-1 text-[15px] font-semibold">一个工作区</dd></div>
            <div className="border-x border-black/10 px-5"><dt className="text-[9px] uppercase tracking-[0.14em] text-[#848484]">知识检索</dt><dd className="mt-1 text-[15px] font-semibold">双路 RAG</dd></div>
            <div className="pl-5"><dt className="text-[9px] uppercase tracking-[0.14em] text-[#848484]">代码许可</dt><dd className="mt-1 text-[15px] font-semibold">AGPL-3.0</dd></div>
          </dl>
        </div>

        <div aria-label="Apollo 工作区界面示意图" role="img" className="landing-product-wrap relative mt-16 w-full max-w-[1180px] sm:mt-20">
          <div className="absolute -inset-10 -z-10 opacity-50 [background-image:radial-gradient(circle_at_center,rgba(90,125,181,.18),transparent_62%)]" />
          <div className="landing-product overflow-hidden rounded-[18px] border border-black/15 bg-white shadow-[0_40px_100px_rgba(35,39,47,0.17)]">
            <div className="flex h-11 items-center justify-between border-b border-black/10 bg-[#fbfbfb] px-4">
              <div className="flex gap-1.5"><span className="size-2.5 rounded-full bg-[#ff6b5f]" /><span className="size-2.5 rounded-full bg-[#f7bd45]" /><span className="size-2.5 rounded-full bg-[#55c66a]" /></div>
              <div className="rounded-md border border-black/10 bg-white px-12 py-1 text-[8px] text-[#888]">apollo / workspace</div>
              <span className="size-5 rounded-full bg-[#202020]" />
            </div>
            <div className="grid min-h-[390px] grid-cols-[76px_1fr] sm:min-h-[500px] sm:grid-cols-[150px_1fr_165px]">
              <div className="border-r border-black/10 bg-[#f7f7f5] p-3 sm:p-4">
                <div className="mb-5 flex items-center gap-2"><img src="/apollo-avatar.jpg" alt="" className="size-6 rounded-full" /><b className="hidden text-[9px] sm:block">Apollo</b></div>
                {['对话', '文件', '知识库', '我的站点'].map((label, index) => <div key={label} className={`mb-1 flex items-center gap-2 rounded-md px-2 py-2 text-[8px] ${index === 0 ? 'bg-white font-semibold shadow-sm' : 'text-[#757575]'}`}><span className={`size-2 rounded-sm ${['bg-[#5b8def]', 'bg-[#7bb58d]', 'bg-[#af8de0]', 'bg-[#e2a760]'][index]}`} /><span className="hidden sm:inline">{label}</span></div>)}
                <div className="mt-7 hidden border-t border-black/10 pt-4 sm:block"><div className="mb-2 h-1.5 w-20 rounded bg-black/10" /><div className="h-1.5 w-14 rounded bg-black/[0.07]" /></div>
              </div>
              <div className="flex min-w-0 flex-col bg-white p-4 sm:p-6">
                <div className="mb-7 flex items-center justify-between"><div><div className="text-[8px] text-[#8b8b8b]">新的任务</div><div className="mt-1 text-[11px] font-semibold">分析产品资料并生成发布方案</div></div><span className="rounded-full border border-black/10 px-2.5 py-1 text-[7px] text-[#6c6c6c]">Ask before actions</span></div>
                <div className="ml-auto max-w-[82%] rounded-[14px_14px_4px_14px] bg-[#efefed] px-4 py-3 text-[9px] leading-5 text-[#444]">读取这批资料，梳理产品关系，并输出一份可发布的网站方案。</div>
                <div className="mt-5 flex gap-3"><img src="/apollo-avatar.jpg" alt="" className="mt-0.5 size-6 rounded-full" /><div className="min-w-0 flex-1"><div className="text-[9px] font-semibold">Apollo</div><p className="mt-2 text-[9px] leading-5 text-[#555]">我会先建立资料索引，再结合实体关系和来源段落完成分析。</p><div className="mt-3 grid grid-cols-2 gap-2"><div className="rounded-lg border border-[#cbdcf8] bg-[#f4f8ff] p-2.5"><span className="text-[7px] font-semibold text-[#3d6fbf]">W E K N O R A</span><div className="mt-1.5 h-1 w-4/5 rounded bg-[#8eb2ea]/50" /><div className="mt-1 h-1 w-3/5 rounded bg-[#8eb2ea]/30" /></div><div className="rounded-lg border border-[#decff3] bg-[#faf7ff] p-2.5"><span className="text-[7px] font-semibold text-[#7a53b8]">L I G H T R A G</span><div className="mt-2 flex gap-2"><span className="landing-rag-node size-2 rounded-full bg-[#5b8def]" /><span className="landing-rag-node size-2 rounded-full bg-[#e2a760]" /><span className="landing-rag-node size-2 rounded-full bg-[#7bb58d]" /></div></div></div><div className="mt-4 rounded-lg border border-black/10 p-3"><div className="flex items-center justify-between text-[8px]"><b>产品发布方案.md</b><span className="text-[#2f8c5f]">已生成</span></div><div className="mt-3 h-1.5 w-full rounded bg-black/[0.07]" /><div className="mt-1.5 h-1.5 w-4/5 rounded bg-black/[0.05]" /></div></div></div>
                <div className="mt-auto flex h-11 items-center rounded-xl border border-black/15 px-4 text-[8px] text-[#999] shadow-sm">继续告诉 Apollo 你想完成什么… <span className="landing-send ml-auto flex size-6 items-center justify-center rounded-full bg-[#171717] text-white">↑</span></div>
              </div>
              <div className="hidden border-l border-black/10 bg-[#fcfcfb] p-4 sm:block"><div className="flex items-center justify-between text-[8px] font-semibold"><span>活动</span><span className="text-[#8b8b8b]">3 项</span></div><div className="mt-5 border-l border-black/10 pl-3"><div className="relative mb-5"><span className="landing-activity-dot absolute -left-[15px] top-1 size-1.5 rounded-full bg-[#4d89e8]" /><b className="text-[8px]">读取资料</b><p className="mt-1 text-[7px] leading-4 text-[#858585]">12 个文件已建立索引</p></div><div className="relative mb-5"><span className="landing-activity-dot absolute -left-[15px] top-1 size-1.5 rounded-full bg-[#9c71d0]" /><b className="text-[8px]">检索知识图谱</b><p className="mt-1 text-[7px] leading-4 text-[#858585]">发现 28 个实体关系</p></div><div className="relative"><span className="landing-activity-dot absolute -left-[15px] top-1 size-1.5 rounded-full bg-[#5eaa77]" /><b className="text-[8px]">生成文档</b><p className="mt-1 text-[7px] leading-4 text-[#858585]">结果已保存到工作区</p></div></div></div>
            </div>
          </div>
          <div className="absolute -bottom-5 -left-2 hidden rounded-full border border-black/10 bg-[#f8f8f4] px-4 py-2 text-[9px] font-medium shadow-sm sm:block">任务过程可见 · 重要操作可审批</div>
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

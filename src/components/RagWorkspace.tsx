import { useEffect, useRef, useState } from 'react';
import {
  createRagCollection,
  deleteRagCollection,
  deleteRagDocument,
  listRagCollections,
  listRagDocuments,
  searchRag,
  uploadRagDocuments,
  type RagCollection,
  type RagChunkMethod,
  type RagDocument,
  type RagHit,
} from '@/lib/rag';

const CHUNK_METHODS: Array<{ value: RagChunkMethod; label: string; description: string }> = [
  { value: 'general', label: '通用文档', description: '按语义边界切分，适合大多数资料' },
  { value: 'qa', label: '问答对', description: '保持问题与答案在同一分段' },
  { value: 'manual', label: '操作手册', description: '按标题和编号章节组织内容' },
  { value: 'table', label: '表格 / 清单', description: '逐行保留表格和清单语义' },
  { value: 'paper', label: '学术论文', description: '识别摘要、章节、结论和参考文献' },
  { value: 'book', label: '书籍章节', description: '按章、节、卷组织长文档' },
  { value: 'laws', label: '法规条款', description: '按第几条拆分并保留条款上下文' },
  { value: 'presentation', label: '演示文稿', description: '按页面和页面标题切分' },
  { value: 'one', label: '整篇文档', description: '全文作为一个分段，适合短文' },
];

export default function RagWorkspace() {
  const [collections, setCollections] = useState<RagCollection[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [documents, setDocuments] = useState<RagDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<RagHit[]>([]);
  const [searched, setSearched] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const selected = collections.find((item) => item.id === selectedId);

  const refreshCollections = async (preferredId?: string) => {
    const next = await listRagCollections();
    setCollections(next);
    setSelectedId((current) => preferredId || (next.some((item) => item.id === current) ? current : next[0]?.id ?? ''));
  };

  useEffect(() => {
    refreshCollections().catch((reason) => setError(messageOf(reason))).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selectedId) return setDocuments([]);
    let cancelled = false;
    setLoading(true);
    listRagDocuments(selectedId)
      .then((items) => { if (!cancelled) setDocuments(items); })
      .catch((reason) => { if (!cancelled) setError(messageOf(reason)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [selectedId]);

  const upload = async (files: FileList | null) => {
    if (!selectedId || !files?.length) return;
    setBusy(true);
    setError('');
    try {
      await uploadRagDocuments(selectedId, [...files]);
      await Promise.all([refreshCollections(selectedId), listRagDocuments(selectedId).then(setDocuments)]);
    } catch (reason) {
      setError(messageOf(reason));
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const removeCollection = async () => {
    if (!selected || !window.confirm(`删除知识库“${selected.name}”及其中所有文档？`)) return;
    setBusy(true);
    try {
      await deleteRagCollection(selected.id);
      setHits([]);
      await refreshCollections();
    } catch (reason) {
      setError(messageOf(reason));
    } finally {
      setBusy(false);
    }
  };

  const removeDocument = async (document: RagDocument) => {
    if (!window.confirm(`从知识库删除“${document.name}”？`)) return;
    setBusy(true);
    try {
      await deleteRagDocument(document.id);
      await Promise.all([refreshCollections(selectedId), listRagDocuments(selectedId).then(setDocuments)]);
    } catch (reason) {
      setError(messageOf(reason));
    } finally {
      setBusy(false);
    }
  };

  const search = async () => {
    if (!query.trim()) return;
    setBusy(true);
    setError('');
    setSearched(false);
    try {
      setHits(await searchRag(query.trim(), selectedId || undefined));
      setSearched(true);
    } catch (reason) {
      setError(messageOf(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="min-h-0 flex-1 overflow-y-auto bg-white px-4 pb-10 pt-7 md:px-8 md:pt-9">
      <div className="mx-auto w-full max-w-6xl">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-[24px] font-semibold tracking-[-0.04em] text-[#171717]">RAG</h1>
            <p className="mt-1.5 text-[11px] leading-5 text-[#6f6f6f]">把自己的资料变成 Apollo 可检索、可引用的知识。</p>
          </div>
          <button type="button" onClick={() => setCreating(true)} className="h-8 cursor-pointer rounded-full bg-[#171717] px-4 text-[11px] font-medium text-white transition-colors duration-200 hover:bg-[#333] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#171717]">新建知识库</button>
        </header>

        {error && <div role="alert" className="mt-5 rounded-xl bg-red-50 px-3.5 py-2.5 text-[11px] text-red-700">{error}</div>}

        <div className="mt-7 grid min-h-[560px] gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
          <aside className="rounded-2xl border border-black/[0.07] bg-[#fafafa] p-2" aria-label="知识库列表">
            {loading && !collections.length ? <p className="px-3 py-10 text-center text-[11px] text-[#888]">正在读取…</p> : collections.length ? (
              <div className="space-y-1">
                {collections.map((collection) => (
                  <button key={collection.id} type="button" onClick={() => { setSelectedId(collection.id); setHits([]); setSearched(false); }} className={`w-full cursor-pointer rounded-xl px-3 py-3 text-left transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#171717] ${selectedId === collection.id ? 'bg-white shadow-sm ring-1 ring-black/[0.07]' : 'hover:bg-white/80'}`}>
                    <span className="block truncate text-[12px] font-medium text-[#262626]">{collection.name}</span>
                    <span className="mt-1 block text-[10px] text-[#858585]">{methodLabel(collection.chunkMethod)} · {collection.documentCount} 个文档 · {collection.chunkCount} 个分段</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="flex h-full min-h-48 flex-col items-center justify-center px-5 text-center">
                <DatabaseIcon />
                <p className="mt-3 text-[12px] font-medium text-[#444]">还没有知识库</p>
                <button type="button" onClick={() => setCreating(true)} className="mt-3 cursor-pointer rounded-lg border border-[#ddd] bg-white px-3 py-1.5 text-[11px] text-[#444] hover:border-[#bbb]">创建第一个</button>
              </div>
            )}
          </aside>

          {selected ? (
            <div className="min-w-0 rounded-2xl border border-black/[0.07] bg-white p-4 sm:p-6">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h2 className="truncate text-[18px] font-semibold tracking-[-0.025em] text-[#202020]">{selected.name}</h2>
                  <p className="mt-1 text-[11px] leading-5 text-[#777]">{selected.description || '未填写说明'}</p>
                  <p className="mt-1 text-[10px] text-[#999]">处理模板：{methodLabel(selected.chunkMethod)}</p>
                </div>
                <button type="button" disabled={busy} onClick={removeCollection} className="shrink-0 cursor-pointer rounded-lg px-2.5 py-1.5 text-[10px] text-[#888] transition-colors hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40">删除知识库</button>
              </div>

              <button type="button" disabled={busy} onClick={() => fileInput.current?.click()} className="mt-6 flex min-h-28 w-full cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-[#d8d8d8] bg-[#fcfcfc] px-5 text-center transition-colors duration-200 hover:border-[#aaa] hover:bg-[#fafafa] disabled:cursor-wait disabled:opacity-60">
                <UploadIcon />
                <span className="mt-2 text-[11px] font-medium text-[#444]">{busy ? '正在处理文档…' : '上传资料'}</span>
                <span className="mt-1 text-[10px] text-[#888]">PDF、Office、图片、TXT、Markdown、CSV、HTML、JSON；单个不超过 20MB</span>
              </button>
              <input ref={fileInput} type="file" multiple accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.png,.jpg,.jpeg,.webp,.txt,.md,.markdown,.csv,.html,.htm,.json" onChange={(event) => { void upload(event.target.files); }} className="sr-only" />

              <div className="mt-7">
                <div className="flex items-center justify-between">
                  <h3 className="text-[12px] font-semibold text-[#333]">文档</h3>
                  <span className="text-[10px] text-[#999]">使用“{methodLabel(selected.chunkMethod)}”模板处理</span>
                </div>
                <div className="mt-2 divide-y divide-black/[0.05]">
                  {documents.length ? documents.map((document) => (
                    <div key={document.id} className="group flex min-h-14 items-center gap-3 py-2.5">
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-[#f4f4f4] text-[#666]"><DocumentIcon /></span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[11px] font-medium text-[#333]">{document.name}</span>
                        <span className="mt-0.5 block text-[10px] text-[#909090]">{document.chunkCount} 个分段 · {formatSize(document.size)}</span>
                      </span>
                      <button type="button" disabled={busy} onClick={() => { void removeDocument(document); }} className="cursor-pointer rounded-lg px-2 py-1 text-[10px] text-[#aaa] opacity-0 transition-colors hover:bg-red-50 hover:text-red-600 group-hover:opacity-100 focus:opacity-100 disabled:cursor-not-allowed">删除</button>
                    </div>
                  )) : <p className="py-8 text-center text-[11px] text-[#999]">上传文档后会显示在这里</p>}
                </div>
              </div>

              <div className="mt-7 border-t border-black/[0.06] pt-6">
                <h3 className="text-[12px] font-semibold text-[#333]">召回测试</h3>
                <p className="mt-1 text-[10px] text-[#888]">输入一个真实问题，检查 Apollo 会找到哪些原文。</p>
                <form onSubmit={(event) => { event.preventDefault(); void search(); }} className="mt-3 flex gap-2">
                  <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="例如：公司的报销标准是什么？" className="h-9 min-w-0 flex-1 rounded-xl border border-[#dedede] px-3 text-[11px] outline-none transition-shadow focus:border-[#aaa] focus:ring-2 focus:ring-black/[0.06]" aria-label="召回测试问题" />
                  <button type="submit" disabled={busy || !query.trim()} className="cursor-pointer rounded-xl bg-[#171717] px-4 text-[11px] font-medium text-white hover:bg-[#333] disabled:cursor-not-allowed disabled:opacity-35">检索</button>
                </form>
                {searched && (
                  <div className="mt-4 space-y-2" aria-live="polite">
                    {hits.length ? hits.map((hit, index) => (
                      <article key={hit.id} className="rounded-xl bg-[#f7f7f7] px-3.5 py-3">
                        <p className="text-[10px] font-medium text-[#666]">{index + 1}. {hit.documentName} · 分段 {hit.position + 1}</p>
                        <p className="mt-1.5 line-clamp-4 whitespace-pre-wrap text-[11px] leading-5 text-[#333]">{hit.content}</p>
                      </article>
                    )) : <p className="rounded-xl bg-[#f7f7f7] px-3.5 py-5 text-center text-[11px] text-[#888]">没有召回相关内容</p>}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex min-h-80 items-center justify-center rounded-2xl border border-dashed border-[#ddd] text-center">
              <div><DatabaseIcon /><p className="mt-3 text-[12px] font-medium text-[#555]">选择或新建一个知识库</p></div>
            </div>
          )}
        </div>
      </div>

      {creating && <CreateCollectionDialog onClose={() => setCreating(false)} onCreated={async (name, description, chunkMethod) => {
        setBusy(true);
        setError('');
        try {
          const collection = await createRagCollection(name, description, chunkMethod);
          await refreshCollections(collection.id);
          setCreating(false);
        } catch (reason) {
          setError(messageOf(reason));
        } finally {
          setBusy(false);
        }
      }} busy={busy} />}
    </section>
  );
}

function CreateCollectionDialog({ onClose, onCreated, busy }: { onClose: () => void; onCreated: (name: string, description: string, chunkMethod: RagChunkMethod) => void; busy: boolean }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [chunkMethod, setChunkMethod] = useState<RagChunkMethod>('general');
  const method = CHUNK_METHODS.find((item) => item.value === chunkMethod)!;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 p-4" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <form onSubmit={(event) => { event.preventDefault(); onCreated(name, description, chunkMethod); }} className="w-full max-w-md rounded-2xl border border-black/[0.08] bg-white p-5 shadow-[0_24px_70px_rgba(0,0,0,0.18)]" role="dialog" aria-modal="true" aria-labelledby="create-rag-title">
        <h2 id="create-rag-title" className="text-[16px] font-semibold text-[#222]">新建知识库</h2>
        <label className="mt-5 block text-[11px] font-medium text-[#555]">名称<input autoFocus value={name} onChange={(event) => setName(event.target.value)} maxLength={80} placeholder="例如：公司制度" className="mt-1.5 h-9 w-full rounded-xl border border-[#ddd] px-3 font-normal outline-none focus:border-[#aaa] focus:ring-2 focus:ring-black/[0.06]" /></label>
        <label className="mt-4 block text-[11px] font-medium text-[#555]">说明<textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={500} rows={3} placeholder="这个知识库包含什么资料" className="mt-1.5 w-full resize-none rounded-xl border border-[#ddd] px-3 py-2 font-normal leading-5 outline-none focus:border-[#aaa] focus:ring-2 focus:ring-black/[0.06]" /></label>
        <label className="mt-4 block text-[11px] font-medium text-[#555]">文档处理模板
          <select value={chunkMethod} onChange={(event) => setChunkMethod(event.target.value as RagChunkMethod)} className="mt-1.5 h-10 w-full cursor-pointer rounded-xl border border-[#ddd] bg-white px-3 font-normal text-[#333] outline-none focus:border-[#aaa] focus:ring-2 focus:ring-black/[0.06]">
            {CHUNK_METHODS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        <p className="mt-1.5 text-[10px] leading-4 text-[#888]">{method.description}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="cursor-pointer rounded-lg px-3 py-2 text-[11px] text-[#666] hover:bg-[#f4f4f4]">取消</button>
          <button type="submit" disabled={busy || !name.trim()} className="cursor-pointer rounded-lg bg-[#171717] px-4 py-2 text-[11px] font-medium text-white hover:bg-[#333] disabled:cursor-not-allowed disabled:opacity-35">创建</button>
        </div>
      </form>
    </div>
  );
}

function messageOf(reason: unknown): string { return reason instanceof Error ? reason.message : String(reason); }
function methodLabel(method: RagChunkMethod): string { return CHUNK_METHODS.find((item) => item.value === method)?.label ?? '通用文档'; }
function formatSize(bytes: number): string { return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`; }
function DatabaseIcon() { return <svg viewBox="0 0 24 24" width="28" height="28" fill="none" className="mx-auto text-[#888]" aria-hidden="true"><ellipse cx="12" cy="5.5" rx="7.5" ry="3" stroke="currentColor" strokeWidth="1.6"/><path d="M4.5 5.5v6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-6m-15 6v6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-6" stroke="currentColor" strokeWidth="1.6"/></svg>; }
function UploadIcon() { return <svg viewBox="0 0 24 24" width="22" height="22" fill="none" className="text-[#777]" aria-hidden="true"><path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M5 15.5v3A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5v-3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>; }
function DocumentIcon() { return <svg viewBox="0 0 24 24" width="17" height="17" fill="none" aria-hidden="true"><path d="M6.5 3.5h7l4 4v13h-11v-17Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/><path d="M13.5 3.5v4h4M9 12h6m-6 3.5h6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>; }

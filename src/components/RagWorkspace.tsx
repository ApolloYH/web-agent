import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import LightRagGraphCanvas from './LightRagGraphCanvas';
import WordView from './WordView';
import {
  createRagCollection,
  deleteRagCollection,
  deleteRagDocument,
  getRagCollectionStats,
  getRagDocumentChunks,
  getRagGraph,
  listRagCollections,
  listRagDocuments,
  retryRagDocument,
  ragDocumentSourceUrl,
  searchRag,
  updateRagCollection,
  uploadRagDocuments,
  type RagCollection,
  type RagCollectionPatch,
  type RagCollectionStats,
  type RagChunkStrategy,
  type RagChunkPreview,
  type RagDocument,
  type RagEngineReport,
  type RagGraph,
  type RagHit,
} from '@/lib/rag';

type DetailTab = 'documents' | 'graph' | 'testing' | 'settings';

export default function RagWorkspace() {
  const [collections, setCollections] = useState<RagCollection[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [documents, setDocuments] = useState<RagDocument[]>([]);
  const [tab, setTab] = useState<DetailTab>('documents');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('');
  const selected = collections.find((item) => item.id === selectedId);
  const hasPendingDocuments = documents.some((item) => item.status === 'pending');

  const refreshCollections = async (preferredId?: string) => {
    const next = await listRagCollections();
    setCollections(next);
    if (preferredId) setSelectedId(preferredId);
    else setSelectedId((current) => next.some((item) => item.id === current) ? current : '');
  };

  useEffect(() => { refreshCollections().catch((reason) => setError(messageOf(reason))).finally(() => setLoading(false)); }, []);
  useEffect(() => {
    if (!selectedId) return setDocuments([]);
    let cancelled = false;
    setLoading(true);
    listRagDocuments(selectedId).then((items) => { if (!cancelled) setDocuments(items); }).catch((reason) => { if (!cancelled) setError(messageOf(reason)); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [selectedId]);
  useEffect(() => {
    if (!selectedId || !hasPendingDocuments) return;
    let running = false;
    const timer = window.setInterval(() => {
      if (running) return;
      running = true;
      listRagDocuments(selectedId).then(setDocuments).catch(() => undefined).finally(() => { running = false; });
    }, 4_000);
    return () => window.clearInterval(timer);
  }, [selectedId, hasPendingDocuments]);

  const updateSelected = async (patch: RagCollectionPatch): Promise<boolean> => {
    if (!selected) return false;
    setBusy(true); setError('');
    try {
      const next = await updateRagCollection(selected.id, patch);
      setCollections((items) => items.map((item) => item.id === next.id ? next : item));
      return true;
    } catch (reason) { setError(messageOf(reason)); return false; }
    finally { setBusy(false); }
  };

  if (selected) return <CollectionDetail collection={selected} documents={documents} tab={tab} loading={loading} busy={busy} error={error} onTab={setTab} onBack={() => { setSelectedId(''); setError(''); }} onRefresh={async () => { await Promise.all([refreshCollections(selected.id), listRagDocuments(selected.id).then(setDocuments)]); }} onBusy={setBusy} onError={setError} onUpdate={updateSelected} onDelete={async () => {
    setBusy(true);
    try { await deleteRagCollection(selected.id); setSelectedId(''); await refreshCollections(); }
    catch (reason) { setError(messageOf(reason)); }
    finally { setBusy(false); }
  }} />;

  const visible = collections.filter((item) => `${item.name} ${item.description}`.toLowerCase().includes(filter.trim().toLowerCase()));
  return <section className="min-h-0 flex-1 overflow-y-auto bg-[#f7f8fa] px-4 pb-10 pt-7 grayscale md:px-9 md:pt-9">
    <div className="mx-auto w-full max-w-7xl">
      <header className="flex items-center justify-between gap-4"><div><h1 className="text-[24px] font-semibold tracking-[-0.04em] text-[#171717]">知识库</h1><p className="mt-1 text-[11px] text-[#60646c]">WeKnora 向量检索 + LightRAG 知识图谱。</p></div><button type="button" onClick={() => setCreating(true)} className="h-9 cursor-pointer rounded-md bg-black px-4 text-[11px] font-medium text-white transition-colors duration-200 hover:bg-[#333] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black">新建知识库</button></header>
      <label className="mt-7 flex max-w-lg items-center px-1"><span className="sr-only">搜索知识库</span><SearchIcon /><input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="搜索知识库" className="h-10 min-w-0 flex-1 bg-transparent px-2 text-[11px] outline-none" /></label>
      {error && <div role="alert" className="mt-4 border-l-2 border-black px-3.5 py-2.5 text-[11px] font-medium text-black">{error}</div>}
      {loading && !collections.length ? <p className="py-24 text-center text-[11px] text-[#666]">正在读取…</p> : visible.length ? <div className="mt-6 space-y-1">{visible.map((collection) => <CollectionCard key={collection.id} collection={collection} onOpen={() => { setSelectedId(collection.id); setTab('documents'); }} />)}</div> : <div className="mt-6 flex min-h-[420px] flex-col items-center justify-center text-center"><DatabaseIcon /><p className="mt-4 text-[13px] font-semibold text-[#333]">{collections.length ? '没有匹配的知识库' : '还没有知识库'}</p><p className="mt-1.5 text-[10px] text-[#60646c]">新建后即可上传文档并生成知识图谱。</p>{!collections.length && <button type="button" onClick={() => setCreating(true)} className="mt-4 cursor-pointer rounded-md bg-[#171717] px-4 py-2 text-[11px] text-white hover:bg-[#343434]">创建知识库</button>}</div>}
    </div>
    {creating && <CreateCollectionDialog busy={busy} onClose={() => setCreating(false)} onCreated={async (name, description) => {
      setBusy(true); setError('');
      try { const collection = await createRagCollection(name, description); await refreshCollections(collection.id); setCreating(false); setTab('documents'); }
      catch (reason) { setError(messageOf(reason)); }
      finally { setBusy(false); }
    }} />}
  </section>;
}

function CollectionCard({ collection, onOpen }: { collection: RagCollection; onOpen: () => void }) {
  return <button type="button" onClick={onOpen} className="grid min-h-20 w-full cursor-pointer grid-cols-[36px_minmax(0,1fr)_auto] items-center gap-3 px-2 py-3 text-left transition-colors duration-200 hover:bg-black/[0.025] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black sm:grid-cols-[36px_minmax(0,1fr)_80px]">
    <span className="flex size-8 items-center justify-center text-black"><DatabaseIcon small /></span>
    <span className="min-w-0"><span className="block truncate text-[12px] font-semibold text-[#252525]">{collection.name}</span><span className="mt-1 block truncate text-[9px] text-[#60646c]">{collection.description || '未填写知识库说明'}</span></span>
    <span className="text-right text-[9px] text-[#60646c]">{collection.documentCount} 个文档</span>
  </button>;
}

function CollectionDetail({ collection, documents, tab, loading, busy, error, onTab, onBack, onRefresh, onBusy, onError, onUpdate, onDelete }: {
  collection: RagCollection; documents: RagDocument[]; tab: DetailTab; loading: boolean; busy: boolean; error: string; onTab: (tab: DetailTab) => void; onBack: () => void; onRefresh: () => Promise<void>; onBusy: (busy: boolean) => void; onError: (error: string) => void; onUpdate: (patch: RagCollectionPatch) => Promise<boolean>; onDelete: () => Promise<void>;
}) {
  return <section className="flex min-h-0 flex-1 flex-col bg-[#f7f8fa] grayscale">
    <header className="shrink-0 bg-white px-4 pt-3 md:px-7"><div className="flex items-center gap-3"><button type="button" onClick={onBack} aria-label="返回知识库" className="flex size-8 cursor-pointer items-center justify-center text-[#555] hover:text-black"><BackIcon /></button><span className="flex size-8 items-center justify-center text-black"><DatabaseIcon small /></span><h1 className="min-w-0 truncate text-[14px] font-semibold text-[#252525]">{collection.name}</h1></div>
      <nav className="mt-3 flex gap-5" aria-label="知识库功能">{([['documents', '文档'], ['graph', '知识图谱'], ['testing', '召回测试'], ['settings', '设置']] as Array<[DetailTab, string]>).map(([value, label]) => { const disabled = value === 'testing' && !documents.length; return <button type="button" key={value} disabled={disabled} title={disabled ? '处理至少一个文档后才能测试召回' : undefined} onClick={() => onTab(value)} className={`cursor-pointer border-b-2 px-1 pb-2.5 text-[11px] font-medium disabled:cursor-not-allowed disabled:text-black/25 ${tab === value ? 'border-black text-black' : 'border-transparent text-[#60646c] hover:text-black'}`}>{label}</button>; })}</nav>
    </header>
    <div key={tab} className="app-view-motion min-h-0 flex-1 overflow-y-auto p-4 md:p-7">{error && <div role="alert" className="mx-auto mb-4 max-w-6xl border-l-2 border-black px-3.5 py-2.5 text-[11px] font-medium text-black">{error}</div>}{tab === 'documents' ? <DocumentsPanel collection={collection} documents={documents} loading={loading} busy={busy} onRefresh={onRefresh} onBusy={onBusy} onError={onError} onUpdate={onUpdate} /> : tab === 'graph' ? <GraphPanel collection={collection} documents={documents} /> : tab === 'testing' ? <TestingPanel collection={collection} /> : <CollectionSettings collection={collection} busy={busy} hasDocuments={Boolean(documents.length)} onUpdate={onUpdate} onDelete={onDelete} />}</div>
  </section>;
}

type UploadStep = 1 | 2 | 3 | 4;
type ChunkPreview = { fileName: string; index: number; content: string; estimated: boolean };

const chunkStrategies: Array<{ value: RagChunkStrategy; name: string; description: string }> = [
  { value: 'automatic', name: '自动推荐', description: '由 WeKnora 检测文档特征并自动选择。' },
  { value: 'structured', name: '标题结构', description: '按 Markdown 标题切分并保留章节路径。' },
  { value: 'heuristic', name: '版面结构', description: '识别分页、章节编号和视觉分隔线。' },
  { value: 'recursive', name: '递归切段', description: '使用 WeKnora 经典递归分隔器。' },
  { value: 'custom', name: '自定义分段', description: '按自定义分隔符逐级拆分。' },
];

const fieldClass = 'mt-1.5 w-full rounded-md bg-black/[0.035] px-3 text-[10px] outline-none transition-colors focus:bg-white focus:ring-1 focus:ring-black/20 disabled:cursor-not-allowed disabled:opacity-45';

function DocumentsPanel({ collection, documents, loading, busy, onRefresh, onBusy, onError, onUpdate }: {
  collection: RagCollection; documents: RagDocument[]; loading: boolean; busy: boolean; onRefresh: () => Promise<void>;
  onBusy: (busy: boolean) => void; onError: (error: string) => void; onUpdate: (patch: RagCollectionPatch) => Promise<boolean>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [step, setStep] = useState<UploadStep>(1);
  const [files, setFiles] = useState<File[]>([]);
  const [submittedFiles, setSubmittedFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<ChunkPreview[]>([]);
  const [previewFileName, setPreviewFileName] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [parser, setParser] = useState(collection.parser);
  const [strategy, setStrategy] = useState(collection.chunkStrategy);
  const [chunkSize, setChunkSize] = useState(collection.chunkSize);
  const [chunkOverlap, setChunkOverlap] = useState(collection.chunkOverlap);
  const [chunkSeparators, setChunkSeparators] = useState(collection.chunkSeparators);
  const [parentChild, setParentChild] = useState(collection.parentChild);
  const [weknoraRecallCount, setWeKnoraRecallCount] = useState(collection.weknoraRecallCount);
  const [weknoraRetrievalMode, setWeKnoraRetrievalMode] = useState(collection.weknoraRetrievalMode);
  const [weknoraSimilarityThreshold, setWeKnoraSimilarityThreshold] = useState(collection.weknoraSimilarityThreshold);
  const [lightRagMode, setLightRagMode] = useState(collection.lightRagMode);
  const [graphDepth, setGraphDepth] = useState(collection.graphDepth);
  const [lightRagTopK, setLightRagTopK] = useState(collection.lightRagTopK);
  const [chunkPreview, setChunkPreview] = useState<{ document: RagDocument; chunks: RagChunkPreview[]; total: number } | null>(null);
  const [chunkPreviewLoading, setChunkPreviewLoading] = useState('');

  useEffect(() => {
    setWizardOpen(false); setStep(1); setFiles([]); setPreviews([]);
  }, [collection.id]);
  useEffect(() => {
    setParser(collection.parser); setStrategy(collection.chunkStrategy); setChunkSize(collection.chunkSize);
    setChunkOverlap(collection.chunkOverlap); setChunkSeparators(collection.chunkSeparators); setParentChild(collection.parentChild);
    setWeKnoraRecallCount(collection.weknoraRecallCount); setWeKnoraRetrievalMode(collection.weknoraRetrievalMode);
    setWeKnoraSimilarityThreshold(collection.weknoraSimilarityThreshold); setLightRagMode(collection.lightRagMode);
    setGraphDepth(collection.graphDepth); setLightRagTopK(collection.lightRagTopK);
  }, [collection.id, collection.parser, collection.chunkStrategy, collection.chunkSize, collection.chunkOverlap, collection.chunkSeparators, collection.parentChild,
    collection.weknoraRecallCount, collection.weknoraRetrievalMode, collection.weknoraSimilarityThreshold,
    collection.lightRagMode, collection.graphDepth, collection.lightRagTopK]);
  const saveStrategy = async () => {
    const saved = await onUpdate({
      parser, chunkStrategy: strategy, chunkSize, chunkOverlap, chunkSeparators, parentChild,
      weknoraRecallCount, weknoraRetrievalMode, weknoraSimilarityThreshold, lightRagMode, graphDepth, lightRagTopK,
    });
    if (saved) setStep(2);
  };
  const selectFiles = (selected: File[]) => {
    const next = selected.slice(0, 8);
    setFiles(next); setPreviews([]); setPreviewFileName(next[0]?.name || '');
  };
  const buildPreview = async () => {
    setPreviewLoading(true); onError('');
    try {
      const next = (await Promise.all(files.map(async (file) => {
        try {
          const extracted = await previewText(file);
          if (extracted === null) return [{ fileName: file.name, index: 0, content: `${file.name} 需要由 ${parser === 'mineru' || /\.doc$/i.test(file.name) ? 'MinerU' : '本地解析器'}提取内容，处理完成后可在文档列表查看实际切片。`, estimated: true }];
          const text = extracted.trim();
          if (!text) return [{ fileName: file.name, index: 0, content: `${file.name} 没有读取到可预览文字；如果是扫描件，处理后由解析器识别。`, estimated: true }];
          return splitPreviewText(text, chunkSize, chunkOverlap, chunkSeparators).slice(0, 24).map((content, index) => ({ fileName: file.name, index, content, estimated: !['recursive', 'custom'].includes(strategy) }));
        } catch (reason) {
          return [{ fileName: file.name, index: 0, content: `${file.name} 预览读取失败：${messageOf(reason)}`, estimated: true }];
        }
      }))).flat();
      setPreviews(next);
      setPreviewFileName(files[0]?.name || '');
      setStep(3);
    } finally { setPreviewLoading(false); }
  };
  const processFiles = async () => {
    const submitted = [...files];
    setSubmittedFiles(submitted);
    setWizardOpen(false);
    onBusy(true); onError('');
    try {
      await uploadRagDocuments(collection.id, submitted);
      await onRefresh();
      setFiles([]); setPreviews([]); setStep(1);
      if (input.current) input.current.value = '';
    } catch (reason) { onError(messageOf(reason)); }
    finally { setSubmittedFiles([]); onBusy(false); }
  };
  const remove = async (document: RagDocument) => { if (!window.confirm(`删除文档“${document.name}”？`)) return; onBusy(true); onError(''); try { await deleteRagDocument(document.id); await onRefresh(); } catch (reason) { onError(messageOf(reason)); } finally { onBusy(false); } };
  const retry = async (document: RagDocument) => { onBusy(true); onError(''); try { await retryRagDocument(document.id); await onRefresh(); } catch (reason) { onError(messageOf(reason)); } finally { onBusy(false); } };
  const showChunks = async (document: RagDocument) => {
    setChunkPreviewLoading(document.id); onError('');
    try { const result = await getRagDocumentChunks(document.id); setChunkPreview({ document, ...result }); }
    catch (reason) { onError(messageOf(reason)); }
    finally { setChunkPreviewLoading(''); }
  };
  const cancelWizard = () => { setFiles([]); setPreviews([]); setStep(1); setWizardOpen(false); };
  const listedDocuments: Array<RagDocument & { optimistic?: boolean }> = [
    ...submittedFiles.map((file, index) => ({
      id: `pending-upload-${index}-${file.name}`,
      collectionId: collection.id,
      name: file.name,
      size: file.size,
      status: 'pending' as const,
      weknoraStatus: 'pending' as const,
      lightRagStatus: 'pending' as const,
      weknoraProgress: { stage: 'pending', current: null, total: null, percent: null },
      lightRagProgress: { stage: 'pending', current: null, total: null, percent: null },
      weknoraError: '',
      lightRagError: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      optimistic: true,
    })),
    ...documents,
  ];

  if (chunkPreview) return <ChunkWorkspace preview={chunkPreview} onClose={() => setChunkPreview(null)} />;

  return <div className="mx-auto max-w-6xl">
    {!wizardOpen ? <div className="flex justify-end"><button type="button" disabled={busy} onClick={() => { setWizardOpen(true); setStep(1); }} className="cursor-pointer rounded-md bg-black px-3.5 py-2 text-[10px] font-medium text-white hover:bg-[#333] disabled:cursor-not-allowed disabled:opacity-35">添加文档</button></div> : null}
    {wizardOpen ? <section className="mt-2">
      <ol className="relative grid grid-cols-4" aria-label="文档处理步骤"><span aria-hidden="true" className="absolute left-[12.5%] right-[12.5%] top-3 h-px bg-black/15" /><span aria-hidden="true" className="absolute left-[12.5%] top-3 h-px bg-black transition-all duration-300" style={{ width: `${(step - 1) * 25}%` }} />{(['配置参数', '上传文件', '切片预览', '开始处理'] as const).map((label, index) => { const value = (index + 1) as UploadStep; const active = value === step; const done = value < step; return <li key={label} className={`relative z-10 flex flex-col items-center gap-2 text-center text-[9px] ${active ? 'font-semibold text-black' : 'font-medium text-black/40'}`}><span className={`flex size-6 items-center justify-center rounded-full border text-[8px] tabular-nums ${done ? 'border-black bg-black text-white' : active ? 'border-black bg-[#f7f8fa] text-black' : 'border-black/15 bg-[#f7f8fa] text-black/40'}`}>{done ? '✓' : value}</span><span>{label}</span></li>; })}</ol>
      <div className="pt-6">
        {step === 1 ? <div>
          <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-[14px] font-semibold text-[#252525]">文档解析</h3><p className="mt-1 text-[9px] text-[#666]">本地解析时两个引擎各自处理；MinerU 时共用提取文本。</p></div><fieldset><legend className="sr-only">解析方式</legend><div className="flex flex-wrap gap-x-6 gap-y-2">{([['native', '本地解析'], ['mineru', 'MinerU 高精度']] as const).map(([value, label]) => <label key={value} className="flex cursor-pointer items-center gap-2 text-[10px] font-medium text-[#444]"><input type="radio" name="parser" value={value} checked={parser === value} onChange={() => setParser(value)} className="size-4 accent-black" />{label}</label>)}</div></fieldset></div>
          <div className="mt-7"><h3 className="text-[14px] font-semibold text-[#252525]">向量检索配置</h3><p className="mt-1 text-[9px] text-[#666]">由 WeKnora 负责切片和常规检索。</p></div>
          <div className="mt-4 grid sm:grid-cols-2 lg:grid-cols-5">
            {chunkStrategies.map((item, index) => <label key={item.value} className={'relative min-h-24 cursor-pointer px-4 py-4 transition-colors lg:border-t-0 ' + (index >= 2 ? 'sm:border-t sm:border-black/[0.08] ' : '') + (index % 2 ? 'sm:border-l sm:border-black/[0.08] ' : '') + (index ? 'lg:border-l lg:border-black/[0.08] ' : '') + (strategy === item.value ? 'bg-black/[0.035]' : 'hover:bg-black/[0.018]')}>
              <input type="radio" name="chunk-strategy" value={item.value} checked={strategy === item.value} onChange={() => setStrategy(item.value)} className="sr-only" />
              {strategy === item.value ? <span aria-hidden="true" className="absolute inset-y-3 left-0 w-1 bg-black" /> : null}
              <span className="flex items-start gap-3"><ChunkStrategyIcon strategy={item.value} /><span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-3"><span className="text-[12px] font-semibold text-[#252525]">{item.name}</span><span aria-hidden="true" className={'size-4 shrink-0 rounded-full border ' + (strategy === item.value ? 'border-[4px] border-black bg-white' : 'border-black/25')} /></span><span className="mt-2 block text-[9px] leading-4 text-[#666]">{item.description}</span></span></span>
            </label>)}
          </div>
          <div className="mt-6">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <NumberField label="分段长度（上限）" value={chunkSize} min={100} max={4000} onChange={setChunkSize} />
              <NumberField label="重叠长度（保留上文）" value={chunkOverlap} min={0} max={500} onChange={setChunkOverlap} />
              <label className="flex cursor-pointer items-center gap-2 self-end pb-2 text-[10px] font-medium text-[#555]"><input type="checkbox" checked={parentChild} onChange={(event) => setParentChild(event.target.checked)} className="size-4 accent-black" />父子分段</label>
              <SelectField label="检索方式" value={weknoraRetrievalMode} onChange={(value) => setWeKnoraRetrievalMode(value as RagCollection['weknoraRetrievalMode'])} options={[['hybrid', '混合检索'], ['vector', '向量检索'], ['keyword', '关键词检索']]} />
              <NumberField label="召回数量" value={weknoraRecallCount} min={1} max={50} onChange={setWeKnoraRecallCount} />
              <NumberField label="相似度阈值" value={weknoraSimilarityThreshold} min={0} max={1} step={0.05} onChange={setWeKnoraSimilarityThreshold} />
            </div>
            {strategy === 'custom' ? <label className="mt-5 block text-[9px] font-medium text-[#555]">自定义分隔符（每行一个，换行写作 <code>\n</code>）<textarea value={chunkSeparators} onChange={(event) => setChunkSeparators(event.target.value)} rows={3} className="mt-1.5 w-full resize-y rounded-md border border-black/15 bg-white px-3 py-2 font-mono text-[10px] leading-4 outline-none focus:border-black" /></label> : null}
          </div>
          <div className="mt-8 border-t border-black/[0.08] pt-6"><h3 className="text-[14px] font-semibold text-[#252525]">知识图谱配置</h3><p className="mt-1 text-[9px] text-[#666]">由 LightRAG 独立构建图谱；不使用上面的切段策略。</p><div className="mt-4 grid gap-4 sm:grid-cols-3"><SelectField label="查询模式" value={lightRagMode} onChange={(value) => setLightRagMode(value as RagCollection['lightRagMode'])} options={[['local', 'Local'], ['global', 'Global'], ['hybrid', 'Hybrid'], ['mix', 'Mix']]} /><NumberField label="图谱展示深度" value={graphDepth} min={1} max={4} onChange={setGraphDepth} /><NumberField label="图谱召回数量" value={lightRagTopK} min={1} max={100} onChange={setLightRagTopK} /></div></div>
          <WizardActions onCancel={cancelWizard} nextLabel="下一步" nextDisabled={busy} onNext={() => { void saveStrategy(); }} />
        </div> : null}
        {step === 2 ? <div><h3 className="text-[14px] font-semibold text-[#252525]">上传待处理文件</h3><p className="mt-1 text-[9px] text-[#60646c]">最多 8 个文件，单个不超过 20MB；文件在确认处理前不会写入知识库。</p><button type="button" onClick={() => input.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); selectFiles([...event.dataTransfer.files]); }} className="mt-4 flex min-h-40 w-full cursor-pointer flex-col items-center justify-center border-y border-dashed border-black/25 text-center transition-colors hover:border-black hover:bg-black/[0.02]"><UploadIcon /><span className="mt-3 text-[11px] font-medium text-[#333]">拖拽文件到这里，或点击选择</span><span className="mt-1 text-[9px] text-[#666]">PDF、Office、图片、Markdown、文本等</span></button><input ref={input} type="file" multiple accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.png,.jpg,.jpeg,.webp,.txt,.md,.markdown,.csv,.html,.htm,.json" onChange={(event) => selectFiles([...(event.target.files || [])])} className="sr-only" />{files.length ? <div className="mt-4"><div className="flex items-center justify-between px-1 py-2 text-[9px] font-medium text-[#666]"><span>已选择文件</span><span>{files.length} 个</span></div>{files.map((file) => <div key={`${file.name}-${file.size}`} className="flex items-center gap-3 border-b border-black/[0.06] px-1 py-2.5"><span className="min-w-0 flex-1 truncate text-[10px] font-medium text-[#333]">{file.name}</span><span className="text-[9px] text-[#777]">{formatSize(file.size)}</span><button type="button" aria-label={`移除 ${file.name}`} onClick={() => setFiles((items) => items.filter((item) => item !== file))} className="cursor-pointer rounded-md px-2 py-1 text-[9px] text-[#555] hover:bg-black/[0.04] hover:text-black">移除</button></div>)}</div> : null}<WizardActions onBack={() => setStep(1)} nextLabel={previewLoading ? '正在生成…' : '生成切片预览'} nextDisabled={!files.length || previewLoading} onNext={() => { void buildPreview(); }} /></div> : null}
        {step === 3 ? <div><h3 className="text-[14px] font-semibold text-[#252525]">切片预览</h3><UploadChunkWorkspace files={files} previews={previews} activeFileName={previewFileName} onActiveFile={setPreviewFileName} /><WizardActions onBack={() => setStep(2)} nextLabel="下一步" onNext={() => setStep(4)} /></div> : null}
        {step === 4 ? <div className="py-3"><div className="text-center"><span className="mx-auto flex size-10 items-center justify-center text-black"><DatabaseIcon small /></span><h3 className="mt-3 text-[14px] font-semibold text-[#252525]">准备提交到索引库</h3><p className="mt-1 text-[9px] text-[#666]">共 {files.length} 个文件，提交后会在文档列表持续显示处理状态。</p></div><div className="mt-7 overflow-hidden border-y border-black/[0.1]"><div className="grid grid-cols-[minmax(0,1fr)_80px_90px_90px] gap-4 px-3 py-3 text-[9px] font-semibold text-[#555]"><span>文件名</span><span>类型</span><span>大小</span><span>状态</span></div>{files.map((file) => <div key={`${file.name}-${file.size}`} className="grid min-h-16 grid-cols-[minmax(0,1fr)_80px_90px_90px] items-center gap-4 border-t border-black/[0.07] px-3 py-3"><span className="flex min-w-0 items-center gap-3"><FileIcon /><span className="truncate text-[10px] font-medium text-[#292929]">{file.name}</span></span><span className="text-[9px] text-[#555]">{fileType(file.name)}</span><span className="text-[9px] text-[#555]">{formatSize(file.size)}</span><span className="text-[9px] font-medium text-[#444]">待处理</span></div>)}</div><WizardActions onBack={() => setStep(3)} nextLabel="开始处理" nextDisabled={busy} onNext={() => { void processFiles(); }} /></div> : null}
      </div>
    </section> : null}
    {!wizardOpen ? <div className="mt-7 overflow-x-auto">
      <div className="min-w-[920px]">
        <div className="grid grid-cols-[minmax(260px,1.7fr)_80px_90px_150px_minmax(250px,1.25fr)_150px] gap-4 border-b border-black/[0.1] px-3 py-3 text-[9px] font-semibold text-[#555]"><span>文件名</span><span>类型</span><span>大小</span><span>上传时间</span><span>状态</span><span>操作</span></div>
        {loading && !listedDocuments.length ? <p className="py-16 text-center text-[11px] text-[#666]">正在读取…</p> : listedDocuments.length ? listedDocuments.map((document) => <div key={document.id} className="group grid min-h-24 grid-cols-[minmax(260px,1.7fr)_80px_90px_150px_minmax(250px,1.25fr)_150px] items-center gap-4 border-b border-black/[0.07] px-3 py-4 transition-colors hover:bg-white">
          <span className="flex min-w-0 items-center gap-3"><FileIcon /><span className="min-w-0"><span className="block truncate text-[11px] font-medium text-[#292929]">{document.name}</span><span className="mt-1 block text-[8px] text-[#888]">更新于 {formatUploadedAt(document.updatedAt)}</span></span></span>
          <span className="text-[10px] text-[#555]">{fileType(document.name)}</span>
          <span className="text-[10px] text-[#555]">{formatSize(document.size)}</span>
          <span className="text-[9px] leading-4 text-[#555]">{formatUploadedAt(document.createdAt)}</span>
          <span className="min-w-0" role={document.status === 'pending' ? 'status' : undefined}>
            <span className="block text-[10px] font-semibold text-[#333]">{document.optimistic ? '正在提交' : documentStatusLabel(document.status)}</span>
            {document.optimistic ? <span className="mt-1 block text-[8px] text-[#666]">文件已加入处理队列</span> : <span className="mt-1 block space-y-1.5">
              <EngineProgress engine="WeKnora" status={document.weknoraStatus} progress={document.weknoraProgress} />
              <EngineProgress engine="LightRAG" status={document.lightRagStatus} progress={document.lightRagProgress} />
            </span>}
            {document.weknoraError ? <span className="mt-1 block line-clamp-2 text-[8px] leading-3.5 text-black" title={document.weknoraError}>WeKnora：{document.weknoraError}</span> : null}
            {document.lightRagError ? <span className="mt-1 block line-clamp-2 text-[8px] leading-3.5 text-black" title={document.lightRagError}>LightRAG：{document.lightRagError}</span> : null}
          </span>
          <span className="flex items-center gap-1">{!document.optimistic ? <>
            {document.weknoraStatus === 'ready' ? <button type="button" disabled={chunkPreviewLoading === document.id} onClick={() => { void showChunks(document); }} aria-label={`查看 ${document.name} 切片`} title="查看切片" className="flex size-8 cursor-pointer items-center justify-center rounded-full text-[#555] hover:bg-black/[0.06] hover:text-black disabled:opacity-40">{chunkPreviewLoading === document.id ? <span className="text-[8px]">读取</span> : <EyeIcon />}</button> : null}
            {document.weknoraStatus === 'ready' ? <a href={ragDocumentSourceUrl(document.id)} download={document.name} aria-label={`下载 ${document.name}`} title="下载原文" className="flex size-8 cursor-pointer items-center justify-center rounded-full text-[#555] hover:bg-black/[0.06] hover:text-black"><DownloadIcon /></a> : null}
            {['failed', 'unconfigured'].includes(document.weknoraStatus) || ['failed', 'unconfigured'].includes(document.lightRagStatus) ? <button type="button" disabled={busy} onClick={() => { void retry(document); }} aria-label={`重试 ${document.name}`} title="重试" className="flex size-8 cursor-pointer items-center justify-center rounded-full text-[#555] hover:bg-black/[0.06] hover:text-black disabled:opacity-40"><RefreshIcon /></button> : null}
            <button type="button" disabled={busy} onClick={() => { void remove(document); }} aria-label={`删除 ${document.name}`} title="删除" className="flex size-8 cursor-pointer items-center justify-center rounded-full text-[#777] opacity-0 hover:bg-black/[0.06] hover:text-black group-hover:opacity-100 focus:opacity-100"><TrashIcon /></button></> : null}
          </span>
        </div>) : <p className="py-14 text-center text-[10px] text-[#737b86]">还没有已处理文档。</p>}
      </div>
    </div> : null}
  </div>;
}

function ChunkWorkspace({ preview, onClose }: { preview: { document: RagDocument; chunks: RagChunkPreview[]; total: number }; onClose: () => void }) {
  const sourceUrl = ragDocumentSourceUrl(preview.document.id);
  return <div className="mx-auto flex h-[calc(100vh-190px)] min-h-[640px] max-w-[1500px] flex-col overflow-hidden bg-white">
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-black/[0.08] px-4"><div className="min-w-0"><h2 className="truncate text-[12px] font-semibold text-[#222]">{preview.document.name}</h2><p className="mt-0.5 text-[9px] text-[#777]">原文与 WeKnora 实际切片对照</p></div><button type="button" onClick={onClose} className="cursor-pointer rounded-md px-3 py-2 text-[10px] text-[#555] hover:bg-black/[0.04] hover:text-black">返回文档</button></header>
    <ChunkComparison fileName={preview.document.name} sourceUrl={sourceUrl} chunks={preview.chunks} total={preview.total} stateLabel="已索引" className="min-h-0 flex-1" />
  </div>;
}

function UploadChunkWorkspace({ files, previews, activeFileName, onActiveFile }: {
  files: File[]; previews: ChunkPreview[]; activeFileName: string; onActiveFile: (name: string) => void;
}) {
  const file = files.find((item) => item.name === activeFileName) || files[0];
  const sourceUrl = useObjectUrl(file);
  const chunks = previews.filter((item) => item.fileName === file?.name).map((item) => ({ id: `${item.fileName}-${item.index}`, index: item.index, content: item.content }));
  return <div className="mt-4">
    {files.length > 1 ? <label className="mb-3 block max-w-sm text-[9px] font-medium text-[#555]">预览文件<select value={file?.name || ''} onChange={(event) => onActiveFile(event.target.value)} className={`${fieldClass} h-10 cursor-pointer`}>{files.map((item) => <option key={`${item.name}-${item.size}`} value={item.name}>{item.name}</option>)}</select></label> : null}
    <ChunkComparison fileName={file?.name || ''} sourceUrl={sourceUrl} sourceFile={file} chunks={chunks} total={chunks.length} stateLabel="预估切片" className="h-[520px] border-y border-black/[0.08]" />
  </div>;
}

function ChunkComparison({ fileName, sourceUrl, sourceFile, chunks, total, stateLabel, className }: {
  fileName: string; sourceUrl: string; sourceFile?: Blob; chunks: RagChunkPreview[]; total: number; stateLabel: string; className: string;
}) {
  const [query, setQuery] = useState('');
  const visibleChunks = chunks.filter((chunk) => chunk.content.toLowerCase().includes(query.trim().toLowerCase()));
  const isWord = /\.docx$/i.test(fileName);
  const browserPreviewable = /\.(docx|pdf|png|jpe?g|webp|txt|md|markdown|csv|json|html|htm)$/i.test(fileName);
  return <div className={`grid min-h-0 lg:grid-cols-[minmax(0,1fr)_minmax(420px,0.95fr)] ${className}`}>
    <section className="flex min-h-[300px] min-w-0 flex-col border-b border-black/[0.08] lg:border-b-0 lg:border-r"><div className="flex h-12 shrink-0 items-center justify-between px-4"><h3 className="text-[10px] font-semibold text-[#444]">文件预览</h3><a href={sourceUrl} download={fileName} className="text-[9px] text-[#666] hover:text-black">下载原文</a></div><div className="min-h-0 flex-1 overflow-hidden bg-[#f5f5f5]">{isWord ? <WordView url={sourceUrl} file={sourceFile} fileName={fileName} /> : browserPreviewable ? <iframe title={`${fileName} 原文预览`} src={sourceUrl} className="h-full w-full border-0 bg-white" /> : <p className="flex h-full items-center justify-center px-6 text-center text-[10px] text-[#666]">该格式无法在浏览器直接显示，提交后仍会正常解析。</p>}</div></section>
    <section className="flex min-h-0 min-w-0 flex-col"><div className="shrink-0 border-b border-black/[0.08] px-4 py-3"><div className="flex items-center justify-between gap-3"><div><h3 className="text-[10px] font-semibold text-[#444]">文本切片</h3><p className="mt-0.5 text-[8px] text-[#888]">{stateLabel} {total} 个</p></div><label className="flex h-9 w-56 max-w-[55%] items-center rounded-md bg-black/[0.035] px-3"><span className="sr-only">搜索切片内容</span><SearchIcon /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索切片内容" className="min-w-0 flex-1 bg-transparent px-2 text-[9px] outline-none" /></label></div></div><div className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-[#fafafa] p-4">{visibleChunks.length ? visibleChunks.map((chunk) => <article key={chunk.id} className="bg-white px-4 py-4"><div className="flex items-center justify-between gap-3"><p className="text-[9px] font-semibold text-[#555]">#{chunk.index + 1}</p><span className="text-[8px] text-[#777]">{chunk.content.length} 字 · {stateLabel}</span></div><p className="mt-3 whitespace-pre-wrap text-[10px] leading-5 text-[#333]">{chunk.content}</p></article>) : <p className="flex h-full items-center justify-center text-[10px] text-[#777]">没有匹配的切片</p>}</div></section>
  </div>;
}

function GraphPanel({ collection, documents }: { collection: RagCollection; documents: RagDocument[] }) {
  const [graph, setGraph] = useState<RagGraph | null>(null);
  const [activeNode, setActiveNode] = useState<RagGraph['nodes'][number] | null>(null);
  const [loading, setLoading] = useState(true);
  const [slow, setSlow] = useState(false);
  const [error, setError] = useState('');
  const loadVersion = useRef(0);
  const load = async (label = '') => {
    const version = ++loadVersion.current;
    setLoading(true); setSlow(false); setError('');
    const timer = window.setTimeout(() => { if (version === loadVersion.current) setSlow(true); }, 8_000);
    try {
      const next = await getRagGraph(collection.id, label);
      if (version !== loadVersion.current) return;
      setGraph(next);
      setActiveNode(next.nodes.find((item) => item.id === next.label) ?? next.nodes[0] ?? null);
    } catch (reason) {
      if (version === loadVersion.current) {
        const message = messageOf(reason);
        setError(/timed out|timeout/i.test(message) ? '知识图谱启动超时，请重试。' : message);
      }
    } finally {
      window.clearTimeout(timer);
      if (version === loadVersion.current) setLoading(false);
    }
  };
  const graphVersion = documents.map((item) => item.lightRagStatus).join(',');
  const graphPending = documents.some((item) => item.lightRagStatus === 'pending');
  const graphFailed = documents.some((item) => item.lightRagStatus === 'failed');
  useEffect(() => { void load(); }, [collection.id, graphVersion]);
  const degrees = useMemo(() => {
    const result = new Map<string, number>();
    for (const edge of graph?.edges ?? []) {
      result.set(edge.source, (result.get(edge.source) ?? 0) + 1);
      result.set(edge.target, (result.get(edge.target) ?? 0) + 1);
    }
    return result;
  }, [graph]);
  const relations = useMemo(() => activeNode && graph ? graph.edges.flatMap((edge) => {
    if (edge.source === activeNode.id) return [{ id: edge.id, entity: edge.target, type: edge.type }];
    if (edge.target === activeNode.id) return [{ id: edge.id, entity: edge.source, type: edge.type }];
    return [];
  }) : [], [activeNode, graph]);
  return <div className="mx-auto flex h-full min-h-[620px] max-w-[1500px] flex-col">
    {graph?.labels.length ? <div className="flex items-end justify-between gap-4"><p className="text-[9px] text-[#777]">{graph.nodes.length} 个实体 · {graph.edges.length} 条关系</p><label htmlFor="graph-root" className="text-[9px] font-medium text-[#555]">中心实体<select id="graph-root" value={graph.label} onChange={(event) => { void load(event.target.value); }} className="mt-1 block h-9 max-w-64 cursor-pointer rounded-md bg-black/[0.035] px-3 text-[10px] text-[#333] outline-none focus:bg-white focus:ring-1 focus:ring-black/20"><option value="">选择实体</option>{graph.labels.map((label) => <option key={label} value={label}>{label}</option>)}</select></label></div> : null}
    <div aria-live="polite" className="mt-4 grid min-h-0 flex-1 overflow-hidden bg-white lg:grid-cols-[minmax(0,1fr)_300px]">{loading ? <div className="flex min-h-[540px] flex-col items-center justify-center text-center"><p className="text-[11px] text-[#60646c]">{slow ? '正在启动知识图谱服务…' : '正在读取 LightRAG 图谱…'}</p>{slow ? <p className="mt-1 text-[9px] text-[#888]">首次加载约需 1–2 分钟，完成后会自动显示。</p> : null}</div> : error ? <div className="flex min-h-[540px] flex-col items-center justify-center p-6 text-center"><p className="text-[11px] font-medium text-black">{error}</p><button type="button" onClick={() => { void load(graph?.label || ''); }} aria-label="重试加载知识图谱" title="重试" className="mt-3 flex size-9 cursor-pointer items-center justify-center rounded-full text-[#555] hover:bg-black/[0.06] hover:text-black"><RefreshIcon /></button></div> : graph?.nodes.length ? <div className="min-h-[540px] min-w-0"><LightRagGraphCanvas graph={graph} activeId={activeNode?.id ?? ''} onNodeSelect={(id) => setActiveNode(graph.nodes.find((item) => item.id === id) ?? null)} /></div> : <div className="flex min-h-[540px] flex-col items-center justify-center p-6 text-center"><GraphIcon /><p className="mt-3 text-[12px] font-medium text-[#444]">{graphPending ? '知识图谱正在构建' : graphFailed ? '知识图谱构建失败' : documents.length ? '未提取到实体关系' : '尚未上传文档'}</p><p className="mt-1 text-[10px] text-[#60646c]">{graphPending ? 'LightRAG 完成后会自动显示。' : graphFailed ? '请回到文档页点击重试。' : documents.length ? '当前文档没有生成可展示的图谱。' : '上传并处理文档后生成知识图谱。'}</p></div>}<aside className="border-t border-black/[0.07] p-5 lg:border-l lg:border-t-0">{activeNode ? <><div className="flex items-center justify-between gap-3"><span className="text-[9px] font-medium text-black">{textProperty(activeNode.properties.entity_type) || activeNode.labels[0] || '实体'}</span><span className="text-[9px] text-[#777]">连接 {degrees.get(activeNode.id) ?? 0}</span></div><h3 className="mt-3 break-words text-[13px] font-semibold text-[#222]">{activeNode.id}</h3><p className="mt-3 whitespace-pre-wrap text-[10px] leading-5 text-[#555]">{textProperty(activeNode.properties.description) || '暂无实体说明。'}</p>{activeNode.id !== graph?.label && <button type="button" onClick={() => { void load(activeNode.id); }} className="mt-4 h-8 rounded-md bg-black px-3 text-[9px] font-medium text-white hover:bg-[#333]">以此为中心</button>}<div className="mt-6 border-t border-black/[0.07] pt-4"><h4 className="text-[9px] font-semibold text-[#333]">当前关系</h4><div className="mt-2 max-h-64 space-y-2 overflow-y-auto">{relations.length ? relations.map((relation) => <button type="button" key={relation.id} onClick={() => setActiveNode(graph?.nodes.find((item) => item.id === relation.entity) ?? null)} className="block w-full cursor-pointer rounded-md px-2 py-1.5 text-left hover:bg-black/[0.035]"><span className="block truncate text-[10px] font-medium text-[#333]">{relation.entity}</span><span className="text-[8px] text-[#777]">{relation.type === 'DIRECTED' ? '关联' : relation.type}</span></button>) : <p className="text-[9px] text-[#777]">暂无相邻关系</p>}</div></div></> : <div className="flex h-full min-h-32 flex-col items-center justify-center text-center"><GraphIcon /><p className="mt-3 text-[10px] text-[#60646c]">点击实体查看说明</p></div>}</aside></div>
  </div>;
}

function TestingPanel({ collection }: { collection: RagCollection }) {
  const [query, setQuery] = useState(''); const [hits, setHits] = useState<RagHit[]>([]); const [engines, setEngines] = useState<RagEngineReport[]>([]); const [busy, setBusy] = useState(false); const [searched, setSearched] = useState(false); const [error, setError] = useState('');
  const run = async () => { if (!query.trim()) return; setBusy(true); setError(''); try { const result = await searchRag(query.trim(), collection.id); setHits(result.hits); setEngines(result.engines); setSearched(true); } catch (reason) { setError(messageOf(reason)); } finally { setBusy(false); } };
  return <div className="mx-auto max-w-4xl"><h2 className="text-[18px] font-semibold text-[#222]">双路召回测试</h2><p className="mt-1 text-[10px] text-[#60646c]">WeKnora 常规检索与 LightRAG 图谱检索并行执行，再统一融合和重排。</p><form onSubmit={(event) => { event.preventDefault(); void run(); }} className="mt-5 flex gap-2"><label className="sr-only" htmlFor="rag-query">召回测试问题</label><input id="rag-query" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="例如：公司的报销标准是什么？" className="h-10 min-w-0 flex-1 rounded-md bg-white px-3 text-[11px] outline-none focus:ring-1 focus:ring-black/20" /><button type="submit" disabled={busy || !query.trim()} className="cursor-pointer rounded-md bg-black px-5 text-[11px] font-medium text-white hover:bg-[#333] disabled:cursor-not-allowed disabled:opacity-35">{busy ? '双路检索中…' : '检索'}</button></form>{error && <p role="alert" className="mt-3 border-l-2 border-black pl-3 text-[10px] font-medium text-black">{error}</p>}{searched && <><div className="mt-5 flex flex-wrap gap-x-6 gap-y-2">{engines.map((item) => <div key={item.engine}><p className="text-[10px] font-semibold text-[#444]">{engineLabel(item.engine)} · {reportStatusLabel(item.status)}</p><p className={`mt-1 text-[9px] ${item.status === 'error' ? 'font-medium text-black' : 'text-[#666]'}`}>{item.status === 'ok' ? `${item.hitCount} 条 · ${item.latencyMs}ms` : item.error}</p></div>)}</div><div className="mt-5 space-y-2">{hits.length ? hits.map((hit, index) => <article key={hit.id} className="px-1 py-3"><p className="text-[10px] font-medium text-[#555]">{index + 1}. {hit.documentName} · {engineLabel(hit.engine)} · 分段 {hit.position + 1}</p><p className="mt-2 line-clamp-6 whitespace-pre-wrap text-[11px] leading-5 text-[#333]">{hit.content}</p></article>) : <p className="py-14 text-center text-[11px] text-[#60646c]">没有召回相关内容；请检查两个引擎的状态。</p>}</div></>}</div>;
}

function CollectionSettings({ collection, busy, hasDocuments, onUpdate, onDelete }: { collection: RagCollection; busy: boolean; hasDocuments: boolean; onUpdate: (patch: RagCollectionPatch) => Promise<boolean>; onDelete: () => Promise<void> }) {
  const [draft, setDraft] = useState(collection);
  const [stats, setStats] = useState<RagCollectionStats>();
  const [statsError, setStatsError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  useEffect(() => { setDraft(collection); setNotice(''); }, [collection.id, collection.updatedAt]);
  useEffect(() => {
    let cancelled = false;
    setStats(undefined); setStatsError('');
    getRagCollectionStats(collection.id).then((value) => { if (!cancelled) setStats(value); }).catch((reason) => { if (!cancelled) setStatsError(messageOf(reason)); });
    return () => { cancelled = true; };
  }, [collection.id, collection.updatedAt]);
  const patch = <K extends keyof RagCollection>(key: K, value: RagCollection[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const save = async () => {
    const saved = await onUpdate({
      name: draft.name, description: draft.description, parser: draft.parser, chunkStrategy: draft.chunkStrategy,
      chunkSize: draft.chunkSize, chunkOverlap: draft.chunkOverlap, chunkSeparators: draft.chunkSeparators,
      parentChild: draft.parentChild, weknoraParentChunkSize: draft.weknoraParentChunkSize,
      weknoraChildChunkSize: draft.weknoraChildChunkSize, weknoraRecallCount: draft.weknoraRecallCount,
      weknoraRetrievalMode: draft.weknoraRetrievalMode, weknoraSimilarityThreshold: draft.weknoraSimilarityThreshold,
      weknoraContextEnrichment: draft.weknoraContextEnrichment, lightRagMode: draft.lightRagMode,
      graphDepth: draft.graphDepth, lightRagTopK: draft.lightRagTopK, lightRagEntityTypes: draft.lightRagEntityTypes,
      lightRagMaxExtractionEntities: draft.lightRagMaxExtractionEntities, lightRagRelationConfig: draft.lightRagRelationConfig,
      lightRagMaxEntityTokens: draft.lightRagMaxEntityTokens, lightRagMaxRelationTokens: draft.lightRagMaxRelationTokens,
      lightRagMaxTotalTokens: draft.lightRagMaxTotalTokens, finalCount: draft.finalCount,
      rerankEnabled: draft.rerankEnabled, rerankerModel: draft.rerankerModel,
    });
    if (saved) setNotice('设置已保存');
  };
  return <div className="mx-auto max-w-4xl"><div className="flex items-end justify-between gap-3"><div><h2 className="text-[18px] font-semibold text-[#222]">知识库设置</h2><p className="mt-1 text-[10px] text-[#60646c]">处理参数决定如何入库，检索参数可随时调整。</p></div>{notice ? <span role="status" className="text-[9px] font-medium text-black">{notice}</span> : null}</div>
    <div className="mt-8">
      <SettingsSection title="基本信息" description="用于识别和说明这个知识库。"><div className="grid gap-4 sm:grid-cols-2"><TextField label="名称" value={draft.name} onChange={(value) => patch('name', value)} maxLength={80} /><label className="block text-[9px] font-medium text-[#555] sm:col-span-2">说明<textarea value={draft.description} onChange={(event) => patch('description', event.target.value)} maxLength={500} rows={3} className={`${fieldClass} resize-y py-2 leading-5`} /></label></div></SettingsSection>
      <SettingsSection title="容量统计" description="按已完成的实际切片估算，便于评估知识库规模。"><div aria-live="polite">{stats ? <><p className="text-[22px] font-semibold tracking-[-0.03em] text-[#252525]">约 {formatCount(stats.tokenCount)} Token</p><p className="mt-1 text-[9px] text-[#6b7280]">{formatCount(stats.chunkCount)} 个切片 · 已统计 {stats.countedDocumentCount}/{stats.documentCount} 个文档{stats.countedDocumentCount < stats.documentCount ? '，其余处理完成后更新' : ''}</p></> : <p className={`text-[10px] ${statsError ? 'text-red-600' : 'text-[#6b7280]'}`}>{statsError || '正在统计…'}</p>}</div></SettingsSection>
      <SettingsSection title="文档解析" description={hasDocuments ? '已有文档，解析方式已锁定。' : '本地解析时两个引擎各自处理；MinerU 时共用提取文本。'}><fieldset disabled={hasDocuments || busy}><SelectField label="解析方式" value={draft.parser} onChange={(value) => patch('parser', value as RagCollection['parser'])} options={[['native', '本地解析'], ['mineru', 'MinerU 高精度']]} /></fieldset></SettingsSection>
      <SettingsSection title="向量检索配置" description={hasDocuments ? 'WeKnora 已有文档，建库和切片参数已锁定。' : '由 WeKnora 负责切片、向量与关键词检索。'}>
        <div className="space-y-5">
          <fieldset disabled={hasDocuments || busy} className="grid gap-4 disabled:opacity-55 sm:grid-cols-2 lg:grid-cols-3">
            <SelectField label="切段策略" value={draft.chunkStrategy} onChange={(value) => patch('chunkStrategy', value as RagChunkStrategy)} options={chunkStrategies.map((item) => [item.value, item.name])} />
            <label className="flex cursor-pointer items-center gap-2 self-end pb-2 text-[10px] font-medium text-[#555]"><input type="checkbox" checked={draft.parentChild} onChange={(event) => patch('parentChild', event.target.checked)} className="size-4 accent-black" />父子分段</label>
            <NumberField label="分段长度" value={draft.chunkSize} min={100} max={4000} onChange={(value) => patch('chunkSize', value)} />
            <NumberField label="重叠长度" value={draft.chunkOverlap} min={0} max={500} onChange={(value) => patch('chunkOverlap', value)} />
            {draft.chunkStrategy === 'custom' ? <label className="block text-[9px] font-medium text-[#555] sm:col-span-2 lg:col-span-3">自定义分隔符（每行一个，换行写作 <code>\n</code>）<textarea value={draft.chunkSeparators} onChange={(event) => patch('chunkSeparators', event.target.value)} rows={2} className={`${fieldClass} resize-y py-2 font-mono leading-4`} /></label> : null}
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <SelectField label="检索方式" value={draft.weknoraRetrievalMode} onChange={(value) => patch('weknoraRetrievalMode', value as RagCollection['weknoraRetrievalMode'])} options={[['hybrid', '混合检索'], ['vector', '向量检索'], ['keyword', '关键词检索']]} />
            <NumberField label="召回数量" value={draft.weknoraRecallCount} min={1} max={50} onChange={(value) => patch('weknoraRecallCount', value)} />
            <NumberField label="相似度阈值" value={draft.weknoraSimilarityThreshold} min={0} max={1} step={0.05} onChange={(value) => patch('weknoraSimilarityThreshold', value)} />
          </div>
        </div>
      </SettingsSection>
      <SettingsSection title="知识图谱配置" description={hasDocuments ? '查询参数可调整；实体与关系抽取参数需清空文档后修改。' : '由 LightRAG 负责实体关系抽取与图谱检索。'}>
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <SelectField label="查询模式" value={draft.lightRagMode} onChange={(value) => patch('lightRagMode', value as RagCollection['lightRagMode'])} options={[['local', 'Local'], ['global', 'Global'], ['hybrid', 'Hybrid'], ['mix', 'Mix']]} />
            <NumberField label="图谱深度" value={draft.graphDepth} min={1} max={4} onChange={(value) => patch('graphDepth', value)} />
            <NumberField label="图谱召回数量" value={draft.lightRagTopK} min={1} max={100} onChange={(value) => patch('lightRagTopK', value)} />
          </div>
          <fieldset disabled={hasDocuments || busy} className="grid gap-4 disabled:opacity-55 sm:grid-cols-2">
            <label className="block text-[9px] font-medium text-[#555]">实体类型（每行一个，留空使用默认）<textarea value={draft.lightRagEntityTypes} onChange={(event) => patch('lightRagEntityTypes', event.target.value)} rows={3} maxLength={1000} placeholder={'人物\n组织\n地点\n事件'} className={`${fieldClass} resize-y py-2 leading-5`} /></label>
            <NumberField label="实体抽取上限（0 为默认）" value={draft.lightRagMaxExtractionEntities} min={0} max={500} onChange={(value) => patch('lightRagMaxExtractionEntities', value)} />
            <label className="block text-[9px] font-medium text-[#555] sm:col-span-2">关系抽取配置（留空使用默认）<textarea value={draft.lightRagRelationConfig} onChange={(event) => patch('lightRagRelationConfig', event.target.value)} rows={3} maxLength={4000} placeholder="例如：重点提取责任、依赖、审批和归属关系" className={`${fieldClass} resize-y py-2 leading-5`} /></label>
          </fieldset>
        </div>
      </SettingsSection>
      <details className="group py-6">
        <summary className="flex cursor-pointer list-none items-center justify-between text-[11px] font-semibold text-[#30343a] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black">高级选项<span aria-hidden="true" className="text-[14px] font-normal text-[#777] transition-transform group-open:rotate-45 motion-reduce:transform-none">＋</span></summary>
        <p className="mt-1 text-[9px] text-[#6b7280]">不配置时使用两个引擎与 Apollo 的默认值。</p>
        <div className="mt-5 space-y-6 md:pl-[202px]">
          <div><h4 className="text-[10px] font-semibold text-[#444]">WeKnora</h4><div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3"><fieldset disabled={hasDocuments || busy} className="contents"><NumberField label="父段长度" value={draft.weknoraParentChunkSize} min={256} max={32000} onChange={(value) => patch('weknoraParentChunkSize', value)} /><NumberField label="子段长度" value={draft.weknoraChildChunkSize} min={64} max={4000} onChange={(value) => patch('weknoraChildChunkSize', value)} /></fieldset><label className="flex cursor-pointer items-center gap-2 self-end pb-2 text-[10px] font-medium text-[#555]"><input type="checkbox" checked={draft.weknoraContextEnrichment} onChange={(event) => patch('weknoraContextEnrichment', event.target.checked)} className="size-4 accent-black" />扩展相邻上下文</label></div></div>
          <div><h4 className="text-[10px] font-semibold text-[#444]">LightRAG 查询预算</h4><div className="mt-3 grid gap-4 sm:grid-cols-3"><NumberField label="实体上下文 Token（0 为默认）" value={draft.lightRagMaxEntityTokens} min={0} max={100000} onChange={(value) => patch('lightRagMaxEntityTokens', value)} /><NumberField label="关系上下文 Token（0 为默认）" value={draft.lightRagMaxRelationTokens} min={0} max={100000} onChange={(value) => patch('lightRagMaxRelationTokens', value)} /><NumberField label="总上下文 Token（0 为默认）" value={draft.lightRagMaxTotalTokens} min={0} max={100000} onChange={(value) => patch('lightRagMaxTotalTokens', value)} /></div></div>
          <div><h4 className="text-[10px] font-semibold text-[#444]">结果处理</h4><div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3"><NumberField label="最终返回数" value={draft.finalCount} min={1} max={20} onChange={(value) => patch('finalCount', value)} /><label className="flex cursor-pointer items-center gap-2 self-end pb-2 text-[10px] font-medium text-[#555]"><input type="checkbox" checked={draft.rerankEnabled} onChange={(event) => patch('rerankEnabled', event.target.checked)} className="size-4 accent-black" />启用统一重排</label><TextField label="重排模型" value={draft.rerankerModel} onChange={(value) => patch('rerankerModel', value)} maxLength={160} disabled={!draft.rerankEnabled} /></div></div>
        </div>
      </details>
      <div className="flex justify-end py-5"><button type="button" disabled={busy || !draft.name.trim()} onClick={() => { setNotice(''); void save(); }} className="cursor-pointer rounded-md bg-[#24272d] px-4 py-2.5 text-[10px] font-medium text-white hover:bg-[#101216] disabled:cursor-not-allowed disabled:opacity-40">{busy ? '保存中…' : '保存全部设置'}</button></div>
      <section className="mt-4 border-t border-black/[0.09] py-6"><div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-[11px] font-semibold text-[#333]">删除知识库</h3><p className="mt-1 text-[9px] text-[#666]">删除两个引擎中的文档和索引，此操作无法撤销。</p></div>{!confirmingDelete ? <button type="button" disabled={busy} onClick={() => setConfirmingDelete(true)} className="cursor-pointer rounded-md px-2 py-2 text-[9px] font-medium text-black hover:bg-black/[0.04] disabled:opacity-40">删除知识库</button> : <div className="flex items-center gap-2"><span className="text-[9px] font-medium text-black">确认永久删除？</span><button type="button" onClick={() => setConfirmingDelete(false)} className="cursor-pointer rounded-md px-3 py-2 text-[9px] text-[#555] hover:bg-black/[0.04]">取消</button><button type="button" disabled={busy} onClick={() => { void onDelete(); }} className="cursor-pointer rounded-md bg-black px-3 py-2 text-[9px] font-medium text-white hover:bg-[#333] disabled:opacity-40">确认删除</button></div>}</div></section>
    </div>
  </div>;
}

function CreateCollectionDialog({ onClose, onCreated, busy }: { onClose: () => void; onCreated: (name: string, description: string) => void; busy: boolean }) {
  const [name, setName] = useState(''); const [description, setDescription] = useState('');
  return <div className="app-overlay-motion fixed inset-0 z-50 flex items-center justify-center bg-black/25 p-4" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><form onSubmit={(event) => { event.preventDefault(); onCreated(name, description); }} role="dialog" aria-modal="true" aria-labelledby="create-rag-title" className="app-dialog-motion w-full max-w-lg border border-black/15 bg-white p-5 shadow-[0_24px_70px_rgba(0,0,0,0.18)]"><div className="flex items-start justify-between"><div><h2 id="create-rag-title" className="text-[18px] font-semibold text-[#222]">创建知识库</h2><p className="mt-1 text-[10px] text-[#666]">默认同时使用 WeKnora 与 LightRAG。</p></div><button type="button" onClick={onClose} aria-label="关闭" className="flex size-8 cursor-pointer items-center justify-center text-xl text-[#777] hover:text-black focus-visible:outline-2 focus-visible:outline-black">×</button></div><div className="mt-5 space-y-4"><label className="block text-[10px] font-medium text-[#555]">名称<input autoFocus value={name} onChange={(event) => setName(event.target.value)} maxLength={80} placeholder="例如：公司制度" className={`${fieldClass} h-10 text-[11px]`} /></label><label className="block text-[10px] font-medium text-[#555]">说明<input value={description} onChange={(event) => setDescription(event.target.value)} maxLength={500} placeholder="这个知识库包含什么资料" className={`${fieldClass} h-10 text-[11px]`} /></label></div><div className="mt-6 flex justify-end gap-2"><button type="button" onClick={onClose} className="cursor-pointer rounded-md px-3 py-2 text-[11px] text-[#555] hover:bg-black/[0.04]">取消</button><button type="submit" disabled={busy || !name.trim()} className="cursor-pointer rounded-md bg-black px-5 py-2 text-[11px] font-medium text-white hover:bg-[#333] disabled:cursor-not-allowed disabled:opacity-35">{busy ? '创建中…' : '创建'}</button></div></form></div>;
}

function WizardActions({ onBack, onCancel, onNext, nextLabel, nextDisabled = false }: { onBack?: () => void; onCancel?: () => void; onNext: () => void; nextLabel: string; nextDisabled?: boolean }) {
  return <div className="mt-8 flex items-center justify-between gap-2">{onCancel ? <button type="button" onClick={onCancel} className="inline-flex h-9 w-24 cursor-pointer items-center justify-center rounded-md bg-black/[0.04] text-[10px] font-medium text-[#555] transition-colors hover:bg-black/[0.08] hover:text-black">取消</button> : null}{onBack ? <button type="button" onClick={onBack} className="inline-flex h-9 w-24 cursor-pointer items-center justify-center rounded-md text-[10px] font-medium text-[#555] transition-colors hover:bg-black/[0.04]">上一步</button> : null}<button type="button" disabled={nextDisabled} onClick={onNext} className={'group inline-flex h-9 cursor-pointer items-center gap-2 rounded-md bg-black text-[10px] font-medium text-white transition-colors hover:bg-[#333] disabled:cursor-not-allowed disabled:opacity-35 ' + (onCancel ? 'w-24 justify-center' : 'px-5')}>{nextLabel}<span aria-hidden="true" className="transition-transform group-hover:translate-x-0.5 motion-reduce:transform-none">→</span></button></div>;
}

function SettingsSection({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return <section className="grid gap-4 py-7 md:grid-cols-[170px_minmax(0,1fr)] md:gap-8"><div><h3 className="text-[11px] font-semibold text-[#30343a]">{title}</h3><p className="mt-1 text-[9px] leading-4 text-[#6b7280]">{description}</p></div><div>{children}</div></section>;
}

function TextField({ label, value, onChange, maxLength, disabled = false }: { label: string; value: string; onChange: (value: string) => void; maxLength?: number; disabled?: boolean }) {
  return <label className="block text-[9px] font-medium text-[#555]">{label}<input type="text" value={value} onChange={(event) => onChange(event.target.value)} maxLength={maxLength} disabled={disabled} className={`${fieldClass} h-10`} /></label>;
}

function NumberField({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step?: number; onChange: (value: number) => void }) {
  return <label className="block text-[9px] font-medium text-[#555]">{label}<input type="number" value={value} min={min} max={max} step={step} onChange={(event) => onChange(Number(event.target.value))} className={`${fieldClass} h-10`} /></label>;
}

function SelectField({ label, value, options, onChange }: { label: string; value: string; options: Array<readonly [string, string]>; onChange: (value: string) => void }) {
  return <label className="block text-[9px] font-medium text-[#555]">{label}<select value={value} onChange={(event) => onChange(event.target.value)} className={`${fieldClass} h-10 cursor-pointer`}>{options.map(([optionValue, optionLabel]) => <option key={optionValue} value={optionValue}>{optionLabel}</option>)}</select></label>;
}

function useObjectUrl(file?: Blob): string {
  const [url, setUrl] = useState('');
  useEffect(() => {
    if (!file) return setUrl('');
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  return url;
}

async function previewText(file: File): Promise<string | null> {
  if (/\.(txt|md|markdown|csv|json|html|htm)$/i.test(file.name)) return file.text();
  if (/\.docx$/i.test(file.name)) return import('@/lib/docxText').then(({ extractDocxText }) => extractDocxText(file));
  if (/\.pdf$/i.test(file.name)) return import('@/lib/pdfText').then(({ extractPdfText }) => extractPdfText(file, 250_000)).then((result) => result.content);
  return null;
}

function splitPreviewText(text: string, chunkSize: number, overlap: number, separators: string): string[] {
  if (!text) return ['文件没有可预览的文本内容。'];
  const size = Math.max(1, chunkSize);
  const safeOverlap = Math.min(Math.max(0, overlap), size - 1);
  const separatorList = separators.split('\n').map((value) => value.replaceAll('\\n', '\n').replaceAll('\\t', '\t')).filter(Boolean);
  const pattern = separatorList.length ? new RegExp(separatorList.map(escapeRegExp).join('|'), 'g') : /\n+/g;
  const pieces = text.split(pattern).map((value) => value.trim()).filter(Boolean);
  if (!pieces.length) return splitFixed(text, size, safeOverlap);

  const chunks: string[] = [];
  let current = '';
  for (const piece of pieces) {
    if (current && current.length + piece.length + 1 > size) {
      chunks.push(current);
      current = safeOverlap ? `${current.slice(-safeOverlap)}\n${piece}` : piece;
    } else current = current ? `${current}\n${piece}` : piece;
    while (current.length > size) {
      chunks.push(current.slice(0, size));
      current = current.slice(size - safeOverlap);
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function splitFixed(text: string, size: number, overlap: number): string[] {
  const chunks: string[] = [];
  const step = Math.max(1, size - overlap);
  for (let start = 0; start < text.length; start += step) chunks.push(text.slice(start, start + size));
  return chunks;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function textProperty(value: unknown): string { return typeof value === 'string' ? value : ''; }
function formatCount(value: number): string { return new Intl.NumberFormat('zh-CN').format(value); }

function messageOf(reason: unknown): string { return reason instanceof Error ? reason.message : String(reason); }
function formatSize(bytes: number): string { return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`; }
function fileType(name: string): string { return name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toUpperCase() : '文件'; }
function formatUploadedAt(value: string): string { return new Date(value).toLocaleString('zh-CN', { hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }); }
function EngineProgress({ engine, status, progress }: { engine: 'WeKnora' | 'LightRAG'; status: RagDocument['weknoraStatus']; progress: RagDocument['weknoraProgress'] }) {
  const detail = progress.percent !== null
    ? `${progress.current !== null && progress.total !== null ? `${progress.current}/${progress.total} · ` : ''}${progress.percent}%`
    : progress.total !== null ? `共 ${progress.total} 个切片` : '';
  return <span className="block text-[8px] text-[#666]">
    <span className="flex items-center justify-between gap-2"><span>{engine} {engineProgressLabel(engine, status, progress.stage)}</span>{detail ? <span className="shrink-0 tabular-nums">{detail}</span> : null}</span>
    {status === 'pending' ? <span role="progressbar" aria-label={`${engine} 处理进度`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percent ?? undefined} className="mt-1 block h-1 overflow-hidden rounded-full bg-black/10"><span className={`block h-full rounded-full bg-black ${progress.percent === null ? 'w-1/3 animate-pulse' : ''}`} style={progress.percent === null ? undefined : { width: `${progress.percent}%` }} /></span> : null}
  </span>;
}

function engineProgressLabel(engine: 'WeKnora' | 'LightRAG', status: RagDocument['weknoraStatus'], stage: string): string {
  const labels: Record<string, string> = engine === 'WeKnora' ? {
    pending: '排队中', docreader: '文档解析中', chunking: '切片中', embedding: '向量化中', multimodal: '多模态处理中', postprocess: '索引收尾中', completed: '完成', failed: '失败', unconfigured: '未配置',
  } : {
    pending: '排队中', parsing: '文档解析中', analyzing: '多模态分析中', processing: '实体关系抽取中', processed: '完成', completed: '完成', failed: '失败', unconfigured: '未配置',
  };
  return labels[stage] || engineStatusLabel(status);
}

function documentStatusLabel(status: RagDocument['status']): string { return status === 'ready' ? '已完成' : status === 'pending' ? '处理中' : status === 'partial' ? '部分完成' : status === 'failed' ? '索引失败' : '未配置'; }
function engineStatusLabel(status: RagDocument['weknoraStatus']): string { return status === 'ready' ? '完成' : status === 'pending' ? '处理中' : status === 'failed' ? '失败' : '未配置'; }
function engineLabel(engine?: RagEngineReport['engine'] | RagHit['engine']): string { return engine === 'weknora' ? 'WeKnora' : engine === 'lightrag' ? 'LightRAG' : engine === 'reranker' ? 'Apollo 重排' : '未知引擎'; }
function reportStatusLabel(status: RagEngineReport['status']): string { return status === 'ok' ? '正常' : status === 'partial' ? '部分可用' : status === 'error' ? '失败' : '未配置'; }
function ChunkStrategyIcon({ strategy }: { strategy: RagChunkStrategy }) {
  return <svg viewBox="0 0 24 24" width="19" height="19" fill="none" className="mt-0.5 shrink-0 text-black" aria-hidden="true">{strategy === 'automatic' ? <><path d="M12 3c.6 3.1 2.3 4.8 5.5 5.5-3.2.6-4.9 2.3-5.5 5.5-.6-3.2-2.3-4.9-5.5-5.5C9.7 7.8 11.4 6.1 12 3Z" stroke="currentColor" strokeWidth="1.5"/><path d="M18.5 14.5c.3 1.7 1.3 2.7 3 3-1.7.3-2.7 1.3-3 3-.3-1.7-1.3-2.7-3-3 1.7-.3 2.7-1.3 3-3Z" stroke="currentColor" strokeWidth="1.4"/></> : strategy === 'structured' ? <><rect x="3.5" y="3.5" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.6"/><rect x="14.5" y="3.5" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.6"/><rect x="3.5" y="14.5" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.6"/><rect x="14.5" y="14.5" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.6"/></> : strategy === 'recursive' ? <><path d="M9 7H6.5A2.5 2.5 0 0 0 4 9.5v5A2.5 2.5 0 0 0 6.5 17H9m6-10h2.5A2.5 2.5 0 0 1 20 9.5v5a2.5 2.5 0 0 1-2.5 2.5H15" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/><path d="M8 12h8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/></> : strategy === 'custom' ? <><path d="M4 20h4l11-11-4-4L4 16v4Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/><path d="m13 7 4 4M4 12V5a1 1 0 0 1 1-1h7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></> : strategy === 'heuristic' ? <><rect x="3.5" y="4.5" width="17" height="15" rx="2" stroke="currentColor" strokeWidth="1.6"/><path d="M7 15V9m0 3h3m0-3v6m4-6v6m0-3h3m0-3v6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></> : <><path d="M5 18 18 5l2 2L7 20l-2-2Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/><path d="m9 16-2-2m5-1-2-2m5-1-2-2m5-1-2-2" stroke="currentColor" strokeWidth="1.4"/></>}</svg>;
}
function DatabaseIcon({ small = false }: { small?: boolean }) { return <svg viewBox="0 0 24 24" width={small ? 20 : 30} height={small ? 20 : 30} fill="none" aria-hidden="true"><ellipse cx="12" cy="5.5" rx="7.5" ry="3" stroke="currentColor" strokeWidth="1.6"/><path d="M4.5 5.5v6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-6m-15 6v6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-6" stroke="currentColor" strokeWidth="1.6"/></svg>; }
function UploadIcon() { return <svg viewBox="0 0 24 24" width="24" height="24" fill="none" className="text-[#777]" aria-hidden="true"><path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M5 15.5v3A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5v-3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>; }
function BackIcon() { return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true"><path d="m14.5 5-7 7 7 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>; }
function SearchIcon() { return <svg viewBox="0 0 24 24" width="16" height="16" fill="none" className="text-[#777]" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6" stroke="currentColor" strokeWidth="1.7"/><path d="m15 15 4 4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/></svg>; }
function RefreshIcon() { return <svg viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true"><path d="M19 7v4h-4M5 17v-4h4M7.4 8.2A6 6 0 0 1 17.8 10M16.6 15.8A6 6 0 0 1 6.2 14" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>; }
function FileIcon() { return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" className="shrink-0 text-[#555]" aria-hidden="true"><path d="M6 3.5h7l5 5v12H6v-17Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/><path d="M13 3.5v5h5" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/></svg>; }
function EyeIcon() { return <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true"><path d="M3 12s3.3-5 9-5 9 5 9 5-3.3 5-9 5-9-5-9-5Z" stroke="currentColor" strokeWidth="1.6"/><circle cx="12" cy="12" r="2.3" stroke="currentColor" strokeWidth="1.6"/></svg>; }
function DownloadIcon() { return <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true"><path d="M12 4v11m0 0-4-4m4 4 4-4M5 19h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>; }
function TrashIcon() { return <svg viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true"><path d="M5 7h14M9 7V4h6v3m2 0-1 13H8L7 7m3 4v5m4-5v5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>; }
function GraphIcon() { return <svg viewBox="0 0 24 24" width="24" height="24" fill="none" className="text-[#666]" aria-hidden="true"><circle cx="6" cy="6" r="2" stroke="currentColor" strokeWidth="1.6"/><circle cx="18" cy="8" r="2" stroke="currentColor" strokeWidth="1.6"/><circle cx="8" cy="18" r="2" stroke="currentColor" strokeWidth="1.6"/><circle cx="18" cy="17" r="2" stroke="currentColor" strokeWidth="1.6"/><path d="m8 6.4 8 1.2M7 8l1 8m2-9 7 9M10 18h6" stroke="currentColor" strokeWidth="1.5"/></svg>; }

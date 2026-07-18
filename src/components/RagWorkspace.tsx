import { useEffect, useRef, useState } from 'react';
import ReactFlow, {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  addEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
} from 'reactflow';
import 'reactflow/dist/style.css';
import {
  createRagCollection,
  deleteRagCollection,
  deleteRagDocument,
  listRagCollections,
  listRagDocuments,
  searchRag,
  updateRagCollection,
  uploadRagDocuments,
  type RagChunkMethod,
  type RagCollection,
  type RagDocument,
  type RagHit,
  type RagPipelineTemplate,
  type RagPipelineGraph,
} from '@/lib/rag';

const CHUNK_METHODS: Array<{ value: RagChunkMethod; label: string; description: string }> = [
  { value: 'general', label: '通用文档', description: '按语义边界切分，适合大多数资料' },
  { value: 'qa', label: '问答对', description: '保持问题与答案在同一分段' },
  { value: 'manual', label: '操作手册', description: '按标题和编号章节组织内容' },
  { value: 'table', label: '表格 / 清单', description: '逐行保留表格和清单语义' },
  { value: 'paper', label: '学术论文', description: '识别摘要、章节、结论和参考文献' },
  { value: 'book', label: '书籍章节', description: '按章、节、卷组织长文档' },
  { value: 'laws', label: '法规条款', description: '按条款拆分并保留上下文' },
  { value: 'presentation', label: '演示文稿', description: '按页面和页面标题切分' },
  { value: 'one', label: '整篇文档', description: '全文作为一个分段，适合短文' },
];

type PipelineNode = { id: string; label: string; caption: string; description: string };
type PipelineDefinition = { label: string; category: string; description: string; method: RagChunkMethod; nodes: PipelineNode[] };
const node = (id: string, label: string, caption: string, description: string): PipelineNode => ({ id, label, caption, description });
const PIPELINES: Record<RagPipelineTemplate, PipelineDefinition> = {
  custom: { label: '自定义模式', category: '自定义', description: '从一条可执行的基础流水线开始，按需替换或增加处理节点。', method: 'general', nodes: [node('source', '数据源', '输入', '接收待处理文档。'), node('extract', '内容提取', '正文与结构', '提取文档正文与结构。'), node('chunk', '通用切段', '语义边界', '按语义边界切分正文。'), node('index', '知识索引', '输出', '写入可检索知识库。')] },
  general: { label: 'General Mode', category: '通用', description: '标准文本提取、语义分段与知识索引。', method: 'general', nodes: [node('source', '数据源', '上传文件', '接收用户上传的文档。'), node('extract', '内容提取', '本地解析 + MinerU', '优先本地解析，无法本地读取时交给 MinerU。'), node('chunk', '语义分段', '通用模板', '沿语义边界切分并保留重叠上下文。'), node('index', '知识索引', '全文 + 可用时向量', '始终写入全文索引，向量服务可用时同步写入向量索引。')] },
  parent_child: { label: 'Parent-child HQ', category: '父子', description: '用细粒度子块召回，命中后返回所属章节父块。', method: 'manual', nodes: [node('source', '数据源', '长文档', '接收具有标题层级的长文档。'), node('extract', '结构提取', '标题与章节', '识别标题、章节和段落边界。'), node('chunk', '父子分段', '父块 + 子块', '子块写入检索索引，命中后返回所属父块。'), node('index', '知识索引', '全文 + 可用时向量', '对子块建立索引，并保留父块返回关系。')] },
  qa: { label: 'Simple Q&A', category: '问答', description: '识别已有问题与答案，形成可直接召回的问答分段。', method: 'qa', nodes: [node('source', '数据源', 'FAQ / 表格', '导入已有问答资料。'), node('extract', '字段提取', '问题与答案', '识别问题和对应答案。'), node('chunk', '问答分段', '一问一答', '保持每组问答完整。'), node('index', '知识索引', '问答检索', '针对用户问题建立索引。')] },
  contextual: { label: 'Contextual Enrichment', category: '增强', description: '为每个分段补充来源文档名称，减少脱离语境的召回。', method: 'general', nodes: [node('source', '数据源', '混合文档', '导入需要上下文增强的资料。'), node('extract', '内容提取', '正文与元信息', '提取正文和来源名称。'), node('chunk', '语义分段', '通用分段', '沿语义边界切分正文。'), node('enrich', '上下文增强', '来源注入', '把来源文档名称写入每个分段。'), node('index', '知识索引', '全文 + 可用时向量', '写入全文索引，并在向量服务可用时写入向量索引。')] },
  llm_qa: { label: 'LLM Generated Q&A', category: '问答', description: '使用已配置的 GLM 从资料中生成问答对，再建立索引。', method: 'qa', nodes: [node('source', '数据源', '原始资料', '导入需要转成问答的资料。'), node('extract', '内容提取', '正文', '清理并提取可读正文。'), node('generate', '生成问答', 'GLM', '只根据原文生成关键问答对。'), node('chunk', '问答分段', '一问一答', '整理生成的问答对。'), node('index', '知识索引', '问答检索', '针对自然语言问题建立索引。')] },
  complex_pdf: { label: 'Complex PDF', category: '父子', description: '强制使用 MinerU 解析复杂 PDF、图片和表格，再进行父子分段。', method: 'paper', nodes: [node('source', '数据源', '复杂 PDF', '接收扫描件、图表和复杂排版 PDF。'), node('mineru', '版面解析', 'MinerU VLM', '识别正文、标题、图片和表格。'), node('chunk', '父子分段', '父块 + 子块', '子块用于检索，命中后返回所属章节父块。'), node('index', '知识索引', '全文 + 可用时向量', '对子块建立索引，并保留父块返回关系。')] },
};

type DetailTab = 'documents' | 'pipeline' | 'testing' | 'settings';

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

  const updateSelected = async (patch: Partial<Pick<RagCollection, 'name' | 'description' | 'chunkMethod' | 'pipelineTemplate' | 'pipelineGraph'>>): Promise<boolean> => {
    if (!selected) return false;
    setBusy(true);
    setError('');
    try {
      const next = await updateRagCollection(selected.id, patch);
      setCollections((items) => items.map((item) => item.id === next.id ? next : item));
      return true;
    } catch (reason) { setError(messageOf(reason)); return false; }
    finally { setBusy(false); }
  };

  if (selected) return <CollectionDetail collection={selected} documents={documents} tab={tab} loading={loading} busy={busy} error={error} onTab={setTab} onBack={() => { setSelectedId(''); setError(''); }} onRefresh={async () => { await Promise.all([refreshCollections(selected.id), listRagDocuments(selected.id).then(setDocuments)]); }} onBusy={setBusy} onError={setError} onUpdate={updateSelected} onDelete={async () => {
    if (!window.confirm(`删除知识库“${selected.name}”及其中所有文档？`)) return;
    setBusy(true);
    try { await deleteRagCollection(selected.id); setSelectedId(''); await refreshCollections(); }
    catch (reason) { setError(messageOf(reason)); }
    finally { setBusy(false); }
  }} />;

  const visible = collections.filter((item) => `${item.name} ${item.description}`.toLowerCase().includes(filter.trim().toLowerCase()));
  return (
    <section className="min-h-0 flex-1 overflow-y-auto bg-[#f7f8fa] px-4 pb-10 pt-7 md:px-9 md:pt-9">
      <div className="mx-auto w-full max-w-7xl">
        <header className="flex items-center justify-between gap-4"><div><h1 className="text-[24px] font-semibold tracking-[-0.04em] text-[#171717]">知识库</h1><p className="mt-1 text-[11px] text-[#707070]">管理 Apollo 可检索、可引用的私人知识。</p></div><button type="button" onClick={() => setCreating(true)} className="h-9 rounded-xl bg-[#155eef] px-4 text-[11px] font-medium text-white hover:bg-[#004eeb]">新建知识库</button></header>
        <div className="mt-7 flex max-w-lg items-center rounded-xl border border-black/[0.07] bg-white px-3 shadow-sm"><SearchIcon /><input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="搜索知识库" aria-label="搜索知识库" className="h-10 min-w-0 flex-1 border-0 bg-transparent px-2 text-[11px] outline-none" /></div>
        {error && <div role="alert" className="mt-4 rounded-xl bg-red-50 px-3.5 py-2.5 text-[11px] text-red-700">{error}</div>}
        {loading && !collections.length ? <p className="py-24 text-center text-[11px] text-[#888]">正在读取…</p> : visible.length ? (
          <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{visible.map((collection) => <CollectionCard key={collection.id} collection={collection} onOpen={() => { setSelectedId(collection.id); setTab('documents'); }} onDelete={async () => {
            if (!window.confirm(`删除知识库“${collection.name}”及其中所有文档？`)) return;
            setBusy(true); setError('');
            try { await deleteRagCollection(collection.id); await refreshCollections(); }
            catch (reason) { setError(messageOf(reason)); }
            finally { setBusy(false); }
          }} />)}</div>
        ) : (
          <div className="mt-6 flex min-h-[420px] flex-col items-center justify-center rounded-2xl border border-dashed border-[#d8dce4] bg-white text-center"><DatabaseIcon /><p className="mt-4 text-[13px] font-semibold text-[#333]">{collections.length ? '没有匹配的知识库' : '还没有知识库'}</p><p className="mt-1.5 text-[10px] text-[#777]">选择处理模板，或从可执行的基础流水线开始。</p>{!collections.length && <button type="button" onClick={() => setCreating(true)} className="mt-4 cursor-pointer rounded-lg bg-[#171717] px-4 py-2 text-[11px] text-white transition-colors duration-200 hover:bg-[#343434] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#171717]">创建知识库</button>}</div>
        )}
      </div>
      {creating && <CreateCollectionDialog busy={busy} onClose={() => setCreating(false)} onCreated={async (name, description, template) => {
        setBusy(true); setError('');
        try { const collection = await createRagCollection(name, description, PIPELINES[template].method, template); await refreshCollections(collection.id); setCreating(false); setTab(template === 'custom' ? 'pipeline' : 'documents'); }
        catch (reason) { setError(messageOf(reason)); }
        finally { setBusy(false); }
      }} />}
    </section>
  );
}

function CollectionCard({ collection, onOpen, onDelete }: { collection: RagCollection; onOpen: () => void; onDelete: () => Promise<void> }) {
  return <article className="group relative min-h-48 rounded-2xl border border-black/[0.07] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.02)] transition-[border-color,box-shadow,transform] hover:-translate-y-0.5 hover:border-black/[0.14] hover:shadow-[0_10px_30px_rgba(0,0,0,0.07)]">
    <button type="button" onClick={onOpen} className="h-full min-h-48 w-full p-5 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#155eef]">
    <span className="flex size-11 items-center justify-center rounded-xl bg-[#eef4ff] text-[#155eef]"><DatabaseIcon small /></span>
    <span className="mt-4 block truncate text-[14px] font-semibold text-[#252525]">{collection.name}</span>
    <span className="mt-1.5 line-clamp-2 min-h-8 text-[10px] leading-4 text-[#777]">{collection.description || '未填写知识库说明'}</span>
    <span className="mt-5 flex items-center justify-between border-t border-black/[0.05] pt-3 text-[9px] text-[#999]"><span>切段模板 · {methodLabel(collection.chunkMethod)}</span><span>{collection.documentCount} 文档 · {collection.chunkCount} 分段</span></span>
    </button>
    <button type="button" onClick={(event) => { event.stopPropagation(); void onDelete(); }} aria-label={`删除知识库 ${collection.name}`} className="absolute right-3 top-3 flex size-8 items-center justify-center rounded-lg text-[#aaa] opacity-0 hover:bg-red-50 hover:text-red-600 group-hover:opacity-100 focus:opacity-100"><TrashIcon /></button>
  </article>;
}

function CollectionDetail({ collection, documents, tab, loading, busy, error, onTab, onBack, onRefresh, onBusy, onError, onUpdate, onDelete }: {
  collection: RagCollection; documents: RagDocument[]; tab: DetailTab; loading: boolean; busy: boolean; error: string; onTab: (tab: DetailTab) => void; onBack: () => void; onRefresh: () => Promise<void>; onBusy: (busy: boolean) => void; onError: (error: string) => void; onUpdate: (patch: Partial<Pick<RagCollection, 'name' | 'description' | 'chunkMethod' | 'pipelineTemplate' | 'pipelineGraph'>>) => Promise<boolean>; onDelete: () => Promise<void>;
}) {
  return <section className="flex min-h-0 flex-1 flex-col bg-[#f7f8fa]">
    <header className="shrink-0 border-b border-black/[0.06] bg-white px-4 pt-3 md:px-7"><div className="flex items-center gap-3"><button type="button" onClick={onBack} aria-label="返回知识库" className="flex size-8 items-center justify-center rounded-lg text-[#666] hover:bg-[#f3f3f3]"><BackIcon /></button><span className="flex size-8 items-center justify-center rounded-lg bg-[#eef4ff] text-[#155eef]"><DatabaseIcon small /></span><div className="min-w-0"><h1 className="truncate text-[14px] font-semibold text-[#252525]">{collection.name}</h1><p className="truncate text-[9px] text-[#999]">{PIPELINES[collection.pipelineTemplate]?.label ?? 'General Mode'} · {collection.documentCount} 个文档</p></div></div>
      <nav className="mt-3 flex gap-5" aria-label="知识库功能">{([['documents', '文档'], ['pipeline', '流水线'], ['testing', '召回测试'], ['settings', '设置']] as Array<[DetailTab, string]>).map(([value, label]) => <button type="button" key={value} onClick={() => onTab(value)} className={`border-b-2 px-1 pb-2.5 text-[11px] font-medium ${tab === value ? 'border-[#155eef] text-[#155eef]' : 'border-transparent text-[#777] hover:text-[#333]'}`}>{label}</button>)}</nav>
    </header>
    <div key={tab} className="app-view-motion min-h-0 flex-1 overflow-y-auto p-4 md:p-7">{error && <div role="alert" className="mx-auto mb-4 max-w-6xl rounded-xl bg-red-50 px-3.5 py-2.5 text-[11px] text-red-700">{error}</div>}{tab === 'documents' ? <DocumentsPanel collection={collection} documents={documents} loading={loading} busy={busy} onRefresh={onRefresh} onBusy={onBusy} onError={onError} /> : tab === 'pipeline' ? <PipelinePanel collection={collection} busy={busy} onUpdate={onUpdate} /> : tab === 'testing' ? <TestingPanel collection={collection} /> : <CollectionSettings collection={collection} busy={busy} onUpdate={onUpdate} onDelete={onDelete} />}</div>
  </section>;
}

function DocumentsPanel({ collection, documents, loading, busy, onRefresh, onBusy, onError }: { collection: RagCollection; documents: RagDocument[]; loading: boolean; busy: boolean; onRefresh: () => Promise<void>; onBusy: (busy: boolean) => void; onError: (error: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const upload = async (files: FileList | null) => { if (!files?.length) return; onBusy(true); onError(''); try { await uploadRagDocuments(collection.id, [...files]); } catch (reason) { onError(messageOf(reason)); } finally { await onRefresh().catch((reason) => onError(messageOf(reason))); onBusy(false); if (input.current) input.current.value = ''; } };
  const remove = async (document: RagDocument) => { if (!window.confirm(`从知识库删除“${document.name}”？`)) return; onBusy(true); try { await deleteRagDocument(document.id); await onRefresh(); } catch (reason) { onError(messageOf(reason)); } finally { onBusy(false); } };
  return <div className="mx-auto max-w-6xl"><div className="flex items-end justify-between"><div><h2 className="text-[18px] font-semibold text-[#222]">文档</h2><p className="mt-1 text-[10px] text-[#888]">上传后按当前流水线自动解析和索引。</p></div><button type="button" disabled={busy} onClick={() => input.current?.click()} className="rounded-lg bg-[#155eef] px-4 py-2 text-[11px] font-medium text-white hover:bg-[#004eeb] disabled:opacity-40">上传文档</button></div><input ref={input} type="file" multiple accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.png,.jpg,.jpeg,.webp,.txt,.md,.markdown,.csv,.html,.htm,.json" onChange={(event) => { void upload(event.target.files); }} className="sr-only" />
    <div className="mt-5 overflow-hidden rounded-2xl border border-black/[0.07] bg-white"><div className="grid grid-cols-[minmax(0,1fr)_100px_100px_44px] gap-3 border-b border-black/[0.06] bg-[#fafafa] px-4 py-2.5 text-[9px] font-medium text-[#888]"><span>名称</span><span>分段</span><span>大小</span><span /></div>{loading ? <p className="py-16 text-center text-[11px] text-[#999]">正在读取…</p> : documents.length ? documents.map((document) => <div key={document.id} className="app-state-motion group grid min-h-14 grid-cols-[minmax(0,1fr)_100px_100px_44px] items-center gap-3 border-b border-black/[0.05] px-4 last:border-0"><span className="flex min-w-0 items-center gap-3"><span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[#f3f4f6] text-[#666]"><DocumentIcon /></span><span className="truncate text-[11px] font-medium text-[#333]">{document.name}</span></span><span className="text-[10px] text-[#777]">{document.chunkCount}</span><span className="text-[10px] text-[#777]">{formatSize(document.size)}</span><button type="button" disabled={busy} onClick={() => { void remove(document); }} aria-label={`删除 ${document.name}`} className="rounded-lg py-1 text-[10px] text-[#aaa] opacity-0 hover:bg-red-50 hover:text-red-600 group-hover:opacity-100 focus:opacity-100">删除</button></div>) : <div className="flex min-h-64 flex-col items-center justify-center text-center"><UploadIcon /><p className="mt-3 text-[12px] font-medium text-[#555]">上传第一份资料</p><p className="mt-1 text-[10px] text-[#999]">支持 PDF、Office、图片、Markdown 等格式，单个不超过 20MB。</p></div>}</div>
  </div>;
}

type PipelineNodeData = { executionType: string; label: string; description: string; required?: boolean };
const NODE_CATALOG: Array<{ type: string; label: string; description: string }> = [
  { type: 'extract', label: '内容提取', description: '提取文档正文与结构。' },
  { type: 'mineru', label: 'MinerU 解析', description: '解析复杂 PDF、图片和表格。' },
  { type: 'chunk', label: '通用切段', description: '使用当前切段模板处理正文。' },
  { type: 'parent_child', label: '父子切段', description: '保留章节父级上下文和子块。' },
  { type: 'qa', label: '问答切段', description: '保持问题与答案完整对应。' },
  { type: 'contextual', label: '上下文增强', description: '为分段注入来源文档上下文。' },
  { type: 'llm_qa', label: 'LLM 生成问答', description: '使用 GLM 根据原文生成问答对。' },
];
const pipelineNodeTypes = { pipeline: PipelineFlowNode };

function PipelinePanel({ collection, busy, onUpdate }: { collection: RagCollection; busy: boolean; onUpdate: (patch: Partial<Pick<RagCollection, 'chunkMethod' | 'pipelineTemplate' | 'pipelineGraph'>>) => Promise<boolean> }) {
  const initial = collection.pipelineGraph ?? graphForTemplate(collection.pipelineTemplate);
  const locked = collection.configurationLocked;
  const [nodes, setNodes, onNodesChange] = useNodesState<PipelineNodeData>(flowNodes(initial));
  const [edges, setEdges, onEdgesChange] = useEdgesState(flowEdges(initial));
  const [selectedId, setSelectedId] = useState('');
  const [dirty, setDirty] = useState(false);
  const instance = useRef<ReactFlowInstance<PipelineNodeData> | null>(null);
  const active = nodes.find((item) => item.id === selectedId);

  useEffect(() => {
    const graph = collection.pipelineGraph ?? graphForTemplate(collection.pipelineTemplate);
    setNodes(flowNodes(graph)); setEdges(flowEdges(graph)); setSelectedId(''); setDirty(false);
  }, [collection.id, collection.pipelineGraph, collection.pipelineTemplate, setEdges, setNodes]);

  const connect = (connection: Connection) => { if (locked) return; setEdges((items) => addEdge({ ...connection, type: 'smoothstep', markerEnd: { type: MarkerType.ArrowClosed, color: '#7b9de5' }, style: { stroke: '#7b9de5' } }, items)); setDirty(true); };
  const addNode = (type: string) => {
    if (locked) return;
    const item = NODE_CATALOG.find((entry) => entry.type === type); if (!item) return;
    const id = `${type}-${Date.now()}`;
    setNodes((items) => [...items, { id, type: 'pipeline', position: { x: 160 + items.length * 28, y: 120 + items.length * 24 }, data: { executionType: item.type, label: item.label, description: item.description } }]);
    setSelectedId(id); setDirty(true);
  };
  const updateActive = (patch: Partial<PipelineNodeData>) => { if (locked) return; setNodes((items) => items.map((item) => item.id === selectedId ? { ...item, data: { ...item.data, ...patch } } : item)); setDirty(true); };
  const removeActive = () => {
    if (locked || !active || active.data.required) return;
    setNodes((items) => items.filter((item) => item.id !== active.id));
    setEdges((items) => items.filter((edge) => edge.source !== active.id && edge.target !== active.id));
    setSelectedId(''); setDirty(true);
  };
  const save = async () => {
    if (locked) return;
    const viewport = instance.current?.getViewport();
    const saved = await onUpdate({ pipelineGraph: { nodes: nodes.map((item) => ({ id: item.id, type: item.data.executionType, label: item.data.label, description: item.data.description, position: item.position })), edges: edges.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target })), ...(viewport ? { viewport } : {}) } });
    if (saved) setDirty(false);
  };
  return <div className="mx-auto flex h-full min-h-[640px] max-w-[1600px] flex-col"><div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-[18px] font-semibold text-[#222]">知识流水线</h2><p className="mt-1 text-[10px] text-[#777]">{locked ? '处理配置已锁定；画布仍可缩放、平移和查看。' : '当前执行器要求一条完整路径：数据源 → 内容提取 → 切段 → 知识索引。保存时会校验每条连线。'}</p></div><div className="flex items-center gap-2"><span title="模板在创建知识库时确定" className="inline-flex h-9 items-center rounded-lg bg-[#f3f3f3] px-3 text-[10px] font-medium text-[#666]">模板 · {PIPELINES[collection.pipelineTemplate].label}</span><label className="sr-only" htmlFor="pipeline-add-node">添加节点</label><select id="pipeline-add-node" disabled={locked} value="" onChange={(event) => addNode(event.target.value)} className="h-9 cursor-pointer rounded-lg border border-[#d8d8d8] bg-white px-3 text-[10px] text-[#555] outline-none focus-visible:ring-2 focus-visible:ring-[#155eef]/30 disabled:cursor-not-allowed disabled:bg-[#f3f3f3]"><option value="">＋ 添加节点</option>{NODE_CATALOG.map((item) => <option key={item.type} value={item.type}>{item.label}</option>)}</select><button type="button" disabled={busy || locked || !dirty} onClick={() => { void save(); }} className="h-9 cursor-pointer rounded-lg bg-[#155eef] px-4 text-[10px] font-medium text-white transition-colors duration-200 hover:bg-[#004eeb] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#155eef] disabled:cursor-not-allowed disabled:opacity-35">{locked ? '已锁定' : busy ? '保存中…' : dirty ? '保存流水线' : '已保存'}</button></div></div>
    <div className="mt-4 grid min-h-0 flex-1 overflow-hidden rounded-2xl border border-black/[0.07] bg-white lg:grid-cols-[minmax(0,1fr)_300px]"><div className="min-h-[560px] min-w-0"><ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={pipelineNodeTypes}
      onInit={(flow) => { instance.current = flow; }}
      onNodesChange={(changes) => { onNodesChange(changes); if (!locked && changes.some((change) => change.type !== 'select')) setDirty(true); }}
      onEdgesChange={(changes) => { onEdgesChange(changes); if (!locked && changes.some((change) => change.type !== 'select')) setDirty(true); }}
      onConnect={connect}
      onSelectionChange={({ nodes: selected }) => setSelectedId(selected[0]?.id ?? '')}
      onMoveEnd={() => { if (!locked) setDirty(true); }}
      defaultViewport={initial.viewport ?? { x: 80, y: 120, zoom: 0.9 }}
      minZoom={0.2}
      maxZoom={2.5}
      fitView={!initial.viewport}
      fitViewOptions={{ padding: 0.25 }}
      panOnDrag
      zoomOnScroll
      zoomOnPinch
      nodesDraggable={!locked}
      nodesConnectable={!locked}
      edgesUpdatable={!locked}
      deleteKeyCode={locked ? null : ['Backspace', 'Delete']}
      selectionOnDrag={false}
      proOptions={{ hideAttribution: true }}
    ><Background color="#cbd5e1" gap={20} size={1} /><Controls position="bottom-left" showInteractive /><MiniMap position="bottom-right" pannable zoomable nodeColor={(item) => item.selected ? '#155eef' : '#b9c7df'} maskColor="rgba(248,250,252,.72)" /></ReactFlow></div><aside className="min-h-0 overflow-y-auto border-t border-black/[0.07] bg-white p-5 lg:border-l lg:border-t-0">{active ? <><div className="flex items-center justify-between"><span className="inline-flex rounded-full bg-[#eef4ff] px-2 py-1 text-[9px] font-medium text-[#155eef]">节点设置</span>{!locked && !active.data.required && <button type="button" onClick={removeActive} className="rounded-lg px-2 py-1 text-[9px] text-red-600 hover:bg-red-50">删除节点</button>}</div><label className="mt-5 block text-[10px] font-medium text-[#555]">节点名称<input disabled={locked} value={active.data.label} onChange={(event) => updateActive({ label: event.target.value })} maxLength={80} className="mt-1.5 h-9 w-full rounded-lg border border-[#ddd] px-2.5 text-[10px] outline-none focus:border-[#999] disabled:bg-[#f5f5f5] disabled:text-[#888]" /></label><label className="mt-4 block text-[10px] font-medium text-[#555]">处理类型<select disabled={locked || active.data.required} value={active.data.executionType} onChange={(event) => { const next = NODE_CATALOG.find((item) => item.type === event.target.value); updateActive({ executionType: event.target.value, ...(next ? { label: next.label, description: next.description } : {}) }); }} className="mt-1.5 h-9 w-full rounded-lg border border-[#ddd] bg-white px-2.5 text-[10px] outline-none disabled:bg-[#f5f5f5] disabled:text-[#888]">{active.data.required && <option value={active.data.executionType}>{active.data.executionType === 'source' ? '数据源' : '知识索引'}</option>}{NODE_CATALOG.map((item) => <option key={item.type} value={item.type}>{item.label}</option>)}</select></label><label className="mt-4 block text-[10px] font-medium text-[#555]">说明<textarea disabled={locked} value={active.data.description} onChange={(event) => updateActive({ description: event.target.value })} maxLength={500} rows={5} className="mt-1.5 w-full resize-none rounded-lg border border-[#ddd] px-2.5 py-2 text-[10px] leading-4 outline-none focus:border-[#999] disabled:bg-[#f5f5f5] disabled:text-[#888]" /></label><p className="mt-4 text-[9px] leading-4 text-[#999]">{locked ? '首份文档开始处理后，节点和连线保持只读，避免同一知识库出现不同处理规则。' : '从节点两侧的圆点拖动即可建立连接。数据源和知识索引是必需节点，不能删除。'}</p></> : <div className="flex h-full min-h-48 flex-col items-center justify-center text-center"><NodeIcon /><p className="mt-3 text-[11px] font-medium text-[#555]">选择一个节点</p><p className="mt-1 text-[9px] leading-4 text-[#999]">{locked ? '流水线已锁定，可选择节点查看配置。' : '在这里编辑名称、类型和处理说明。'}</p></div>}{locked && <p role="status" className="mt-5 rounded-xl bg-amber-50 p-3 text-[9px] leading-4 text-amber-700">处理配置已锁定。名称和说明仍可修改；如需另一套处理规则，请新建知识库。</p>}</aside></div>
  </div>;
}

function PipelineFlowNode({ data, selected }: NodeProps<PipelineNodeData>) {
  return <div className={`w-[196px] rounded-2xl border bg-white p-4 shadow-[0_8px_24px_rgba(25,40,72,0.08)] transition-[border-color,box-shadow] ${selected ? 'border-[#155eef] shadow-[0_0_0_3px_rgba(21,94,239,0.12)]' : 'border-black/[0.09]'}`}><Handle type="target" position={Position.Left} className="!size-3 !border-2 !border-white !bg-[#7b9de5]" /><span className="flex size-8 items-center justify-center rounded-lg bg-[#eef4ff] text-[#155eef]"><NodeIcon /></span><p className="mt-3 truncate text-[11px] font-semibold text-[#303030]">{data.label}</p><p className="mt-1 truncate text-[9px] text-[#888]">{data.description}</p><Handle type="source" position={Position.Right} className="!size-3 !border-2 !border-white !bg-[#155eef]" /></div>;
}

function graphForTemplate(template: RagPipelineTemplate): RagPipelineGraph {
  const definition = PIPELINES[template] ?? PIPELINES.general;
  const nodes = definition.nodes.map((item, index) => ({ id: item.id, type: executionType(template, item.id), label: item.label, description: item.description, position: { x: index * 270, y: 120 } }));
  return { nodes, edges: nodes.slice(1).map((item, index) => ({ id: `edge-${nodes[index]!.id}-${item.id}`, source: nodes[index]!.id, target: item.id })) };
}

function executionType(template: RagPipelineTemplate, id: string): string {
  if (id === 'source' || id === 'index' || id === 'mineru') return id;
  if (id === 'enrich') return 'contextual';
  if (id === 'generate') return 'llm_qa';
  if (id === 'chunk') return template === 'parent_child' || template === 'complex_pdf' ? 'parent_child' : template === 'qa' || template === 'llm_qa' ? 'qa' : 'chunk';
  return 'extract';
}

function flowNodes(graph: RagPipelineGraph): Array<Node<PipelineNodeData>> {
  return graph.nodes.map((item) => ({ id: item.id, type: 'pipeline', position: item.position, deletable: !['source', 'index'].includes(item.type), data: { executionType: item.type, label: item.label, description: item.description, required: ['source', 'index'].includes(item.type) } }));
}

function flowEdges(graph: RagPipelineGraph): Edge[] {
  return graph.edges.map((item) => ({ ...item, type: 'smoothstep', markerEnd: { type: MarkerType.ArrowClosed, color: '#7b9de5' }, style: { stroke: '#7b9de5' } }));
}

function TestingPanel({ collection }: { collection: RagCollection }) {
  const [query, setQuery] = useState(''); const [hits, setHits] = useState<RagHit[]>([]); const [busy, setBusy] = useState(false); const [searched, setSearched] = useState(false); const [error, setError] = useState('');
  const run = async () => { if (!query.trim()) return; setBusy(true); setError(''); try { setHits(await searchRag(query.trim(), collection.id)); setSearched(true); } catch (reason) { setError(messageOf(reason)); } finally { setBusy(false); } };
  return <div className="mx-auto max-w-4xl"><h2 className="text-[18px] font-semibold text-[#222]">召回测试</h2><p className="mt-1 text-[10px] text-[#888]">输入真实问题，检查 Apollo 会引用哪些原文。</p><form onSubmit={(event) => { event.preventDefault(); void run(); }} className="mt-5 flex gap-2 rounded-2xl border border-black/[0.07] bg-white p-2 shadow-sm"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="例如：公司的报销标准是什么？" aria-label="召回测试问题" className="h-10 min-w-0 flex-1 rounded-xl px-3 text-[11px] outline-none" /><button type="submit" disabled={busy || !query.trim()} className="rounded-xl bg-[#155eef] px-5 text-[11px] font-medium text-white disabled:opacity-35">{busy ? '检索中…' : '检索'}</button></form>{error && <p role="alert" className="mt-3 text-[10px] text-red-600">{error}</p>}{searched && <div className="mt-5 space-y-3">{hits.length ? hits.map((hit, index) => <article key={hit.id} className="app-state-motion rounded-2xl border border-black/[0.06] bg-white p-4"><p className="text-[10px] font-medium text-[#666]">{index + 1}. {hit.documentName} · 分段 {hit.position + 1}</p><p className="mt-2 line-clamp-6 whitespace-pre-wrap text-[11px] leading-5 text-[#333]">{hit.content}</p></article>) : <p className="rounded-2xl bg-white py-14 text-center text-[11px] text-[#888]">没有召回相关内容</p>}</div>}</div>;
}

function CollectionSettings({ collection, busy, onUpdate, onDelete }: { collection: RagCollection; busy: boolean; onUpdate: (patch: Partial<Pick<RagCollection, 'name' | 'description'>>) => Promise<boolean>; onDelete: () => Promise<void> }) {
  const [name, setName] = useState(collection.name); const [description, setDescription] = useState(collection.description);
  const locked = collection.configurationLocked;
  return <div className="mx-auto max-w-3xl"><h2 className="text-[18px] font-semibold text-[#222]">知识库设置</h2><div className="mt-5 space-y-5 rounded-2xl border border-black/[0.07] bg-white p-5"><label className="block text-[10px] font-medium text-[#555]">名称<input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} className="mt-2 h-10 w-full rounded-xl border border-[#ddd] px-3 text-[11px] outline-none focus:border-[#999]" /></label><label className="block text-[10px] font-medium text-[#555]">说明<textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={500} rows={3} className="mt-2 w-full resize-none rounded-xl border border-[#ddd] px-3 py-2 text-[11px] leading-5 outline-none focus:border-[#999]" /></label><div><p className="text-[10px] font-medium text-[#555]">初始化模板</p><div className="mt-2 rounded-xl border border-black/[0.07] bg-[#f7f8fa] p-3"><span className="block text-[10px] font-medium text-[#333]">{PIPELINES[collection.pipelineTemplate].label} · {methodLabel(collection.chunkMethod)}</span><span className="mt-1 block text-[9px] leading-4 text-[#888]">创建后不可更换；如需其他处理规则，请新建知识库。</span></div></div>{locked && <p role="status" className="rounded-xl bg-amber-50 px-3 py-2.5 text-[9px] leading-4 text-amber-700">首份文档已经开始处理，流水线已锁定。如需更换规则，请新建知识库。</p>}<div className="flex justify-end"><button type="button" disabled={busy || !name.trim()} onClick={() => { void onUpdate({ name, description }); }} className="rounded-lg bg-[#171717] px-4 py-2 text-[11px] font-medium text-white disabled:opacity-40">保存设置</button></div></div><div className="mt-5 flex items-center justify-between rounded-2xl border border-red-100 bg-white p-5"><div><p className="text-[11px] font-medium text-[#333]">删除知识库</p><p className="mt-1 text-[9px] text-[#999]">会永久删除全部文档和索引。</p></div><button type="button" disabled={busy} onClick={() => { void onDelete(); }} className="rounded-lg px-3 py-2 text-[10px] text-red-600 hover:bg-red-50">删除</button></div></div>;
}

function CreateCollectionDialog({ onClose, onCreated, busy }: { onClose: () => void; onCreated: (name: string, description: string, template: RagPipelineTemplate) => void; busy: boolean }) {
  const [name, setName] = useState(''); const [description, setDescription] = useState(''); const [template, setTemplate] = useState<RagPipelineTemplate>('custom');
  return <div className="app-overlay-motion fixed inset-0 z-50 flex items-center justify-center bg-black/25 p-4" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><form onSubmit={(event) => { event.preventDefault(); onCreated(name, description, template); }} role="dialog" aria-modal="true" aria-labelledby="create-rag-title" className="app-dialog-motion max-h-[calc(100dvh-2rem)] w-full max-w-5xl overflow-y-auto rounded-2xl border border-black/[0.08] bg-[#f8f9fb] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.18)]"><div className="flex items-start justify-between"><div><h2 id="create-rag-title" className="text-[18px] font-semibold text-[#222]">创建知识库</h2><p className="mt-1 text-[10px] text-[#888]">处理模板仅可在创建时选择；流水线在首份文档开始处理后锁定。</p></div><button type="button" onClick={onClose} aria-label="关闭" className="flex size-8 cursor-pointer items-center justify-center rounded-lg text-xl text-[#999] transition-colors duration-200 hover:bg-black/5 focus-visible:outline-2 focus-visible:outline-[#155eef]">×</button></div><div className="mt-5 grid gap-2 md:grid-cols-2"><label className="text-[10px] font-medium text-[#555]">名称<input autoFocus value={name} onChange={(event) => setName(event.target.value)} maxLength={80} placeholder="例如：公司制度" className="mt-1.5 h-10 w-full rounded-xl border border-[#ddd] bg-white px-3 text-[11px] outline-none focus:border-[#999]" /></label><label className="text-[10px] font-medium text-[#555]">说明<input value={description} onChange={(event) => setDescription(event.target.value)} maxLength={500} placeholder="这个知识库包含什么资料" className="mt-1.5 h-10 w-full rounded-xl border border-[#ddd] bg-white px-3 text-[11px] outline-none focus:border-[#999]" /></label></div><fieldset className="mt-6"><legend className="text-[11px] font-semibold text-[#444]">知识流水线模板</legend><div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><button type="button" onClick={() => setTemplate('custom')} className={`min-h-40 cursor-pointer rounded-2xl border border-dashed p-4 text-left transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#155eef] ${template === 'custom' ? 'border-[#155eef] bg-[#f2f6ff] ring-2 ring-[#155eef]/10' : 'border-[#ccd3df] bg-white hover:border-[#9ba7b8]'}`}><span className="flex size-9 items-center justify-center rounded-xl bg-[#eef4ff] text-[#155eef]"><PlusPipelineIcon /></span><span className="mt-3 block text-[11px] font-semibold text-[#333]">自定义模式</span><span className="mt-2 block text-[9px] leading-4 text-[#777]">从数据源、内容提取、通用切段和知识索引组成的可执行基础流程开始。</span></button>{(Object.entries(PIPELINES) as Array<[RagPipelineTemplate, PipelineDefinition]>).filter(([value]) => value !== 'custom').map(([value, item]) => <button type="button" key={value} onClick={() => setTemplate(value)} className={`min-h-40 cursor-pointer rounded-2xl border p-4 text-left transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#155eef] ${template === value ? 'border-[#155eef] bg-[#f2f6ff] ring-2 ring-[#155eef]/10' : 'border-black/[0.07] bg-white hover:border-black/[0.16]'}`}><span className="flex size-9 items-center justify-center rounded-xl bg-[#eef4ff] text-[#155eef]"><NodeIcon /></span><span className="mt-3 block truncate text-[11px] font-semibold text-[#333]">{item.label}</span><span className="mt-1 block text-[9px] font-medium text-[#155eef]">{item.category}</span><span className="mt-2 line-clamp-3 text-[9px] leading-4 text-[#777]">{item.description}</span></button>)}</div></fieldset><div className="mt-6 flex justify-end gap-2"><button type="button" onClick={onClose} className="cursor-pointer rounded-lg px-3 py-2 text-[11px] text-[#666] transition-colors duration-200 hover:bg-black/5">取消</button><button type="submit" disabled={busy || !name.trim()} className="cursor-pointer rounded-lg bg-[#155eef] px-5 py-2 text-[11px] font-medium text-white transition-colors duration-200 hover:bg-[#004eeb] disabled:cursor-not-allowed disabled:opacity-35">{busy ? '创建中…' : '创建'}</button></div></form></div>;
}

function messageOf(reason: unknown): string { return reason instanceof Error ? reason.message : String(reason); }
function methodLabel(method: RagChunkMethod): string { return CHUNK_METHODS.find((item) => item.value === method)?.label ?? '通用文档'; }
function formatSize(bytes: number): string { return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`; }
function DatabaseIcon({ small = false }: { small?: boolean }) { return <svg viewBox="0 0 24 24" width={small ? 20 : 30} height={small ? 20 : 30} fill="none" className={small ? '' : 'text-[#888]'} aria-hidden="true"><ellipse cx="12" cy="5.5" rx="7.5" ry="3" stroke="currentColor" strokeWidth="1.6"/><path d="M4.5 5.5v6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-6m-15 6v6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-6" stroke="currentColor" strokeWidth="1.6"/></svg>; }
function UploadIcon() { return <svg viewBox="0 0 24 24" width="24" height="24" fill="none" className="text-[#888]" aria-hidden="true"><path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M5 15.5v3A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5v-3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>; }
function DocumentIcon() { return <svg viewBox="0 0 24 24" width="17" height="17" fill="none" aria-hidden="true"><path d="M6.5 3.5h7l4 4v13h-11v-17Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/><path d="M13.5 3.5v4h4M9 12h6m-6 3.5h6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>; }
function SearchIcon() { return <svg viewBox="0 0 24 24" width="16" height="16" fill="none" className="text-[#999]" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6" stroke="currentColor" strokeWidth="1.7"/><path d="m15 15 4 4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/></svg>; }
function BackIcon() { return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true"><path d="m14.5 5-7 7 7 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>; }
function NodeIcon() { return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true"><circle cx="6" cy="6" r="2" stroke="currentColor" strokeWidth="1.6"/><circle cx="18" cy="12" r="2" stroke="currentColor" strokeWidth="1.6"/><circle cx="6" cy="18" r="2" stroke="currentColor" strokeWidth="1.6"/><path d="M8 6h3a3 3 0 0 1 3 3v0a3 3 0 0 0 3 3M8 18h3a3 3 0 0 0 3-3v0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>; }
function PlusPipelineIcon() { return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.6"/><path d="M12 8v8m-4-4h8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>; }
function TrashIcon() { return <svg viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true"><path d="M5 7h14M9 7V4.5h6V7m2 0-.7 12H7.7L7 7m3 3v6m4-6v6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>; }

import { useDeferredValue, useMemo, useState } from 'react';
import type { LibraryFile } from '@/lib/documentFiles';

const filters = [
  ['all', '全部'],
  ['word', 'Word'],
  ['pdf', 'PDF'],
  ['image', '图片'],
  ['markdown', 'Markdown'],
  ['json', 'JSON'],
] as const;
const FILTER_STORAGE_KEY = 'apollo:library-filter';
type FilterKind = (typeof filters)[number][0];

export default function FileLibrary({ files, localFiles, loading, localFolderName, source, onSourceChange, onOpen, onConnectFolder, onRefreshFolder }: {
  files: LibraryFile[];
  localFiles: LibraryFile[];
  loading: boolean;
  localFolderName: string;
  source: 'server' | 'local';
  onSourceChange: (source: 'server' | 'local') => void;
  onOpen: (file: LibraryFile) => void;
  onConnectFolder: () => void;
  onRefreshFolder: () => void;
}) {
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<FilterKind>(readStoredFilter);
  const deferredQuery = useDeferredValue(query);
  const sourceFiles = source === 'server' ? files : localFiles;
  const visibleFiles = useMemo(() => {
    const normalized = deferredQuery.trim().toLowerCase();
    return sourceFiles.filter((file) =>
      (kind === 'all' || file.kind === kind) && (!normalized || file.title.toLowerCase().includes(normalized)),
    );
  }, [deferredQuery, sourceFiles, kind]);

  return (
    <section className="min-h-0 flex-1 overflow-y-auto bg-white px-5 pb-10 pt-8 md:px-10 md:pt-10">
      <div className="mx-auto w-full max-w-5xl">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-[22px] font-semibold tracking-[-0.035em] text-[#171717]">文件库</h1>
            <div className="mt-3 inline-flex rounded-xl bg-[#f2f2f2] p-0.5" aria-label="文件来源">
              <button type="button" onClick={() => onSourceChange('server')} aria-pressed={source === 'server'} className={`rounded-[10px] px-3 py-1.5 text-[11px] transition-colors ${source === 'server' ? 'bg-white text-[#171717] shadow-sm' : 'text-[#666] hover:text-[#222]'}`}>网站文件</button>
              <button type="button" onClick={() => onSourceChange('local')} aria-pressed={source === 'local'} className={`rounded-[10px] px-3 py-1.5 text-[11px] transition-colors ${source === 'local' ? 'bg-white text-[#171717] shadow-sm' : 'text-[#666] hover:text-[#222]'}`}>本地文件夹</button>
            </div>
          </div>
          <label className="flex h-9 w-full items-center gap-2 rounded-full bg-[#f4f4f4] px-3.5 sm:w-64">
            <SearchIcon />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索文件" aria-label="搜索文件" className="min-w-0 flex-1 border-0 bg-transparent text-[12px] outline-none placeholder:text-[#999]" />
          </label>
        </div>

        {source === 'local' && (
          <div className="app-state-motion mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#e8e8e8] bg-[#fafafa] px-4 py-3">
            <div className="min-w-0">
              <p className="truncate text-[11px] font-medium text-[#303030]">{localFolderName || '尚未连接本地文件夹'}</p>
              <p className="mt-0.5 text-[10px] text-[#777]">打开和手动编辑不上传；向云端 Apollo 提问或修改时，相关文档文字会发送给模型。仅桌面版 Chrome / Edge 支持。</p>
            </div>
            <div className="flex gap-2">
              {localFolderName && <button type="button" onClick={onRefreshFolder} className="rounded-lg px-3 py-1.5 text-[11px] text-[#555] hover:bg-[#ededed] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#171717]">刷新</button>}
              <button type="button" onClick={onConnectFolder} className="rounded-lg bg-[#171717] px-3 py-1.5 text-[11px] text-white hover:bg-[#303030] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#171717]">{localFolderName ? '重新连接' : '连接文件夹'}</button>
            </div>
          </div>
        )}

        <div className="mt-8 flex flex-wrap gap-1.5">
          {filters.map(([value, label]) => (
            <button key={value} type="button" onClick={() => { setKind(value); sessionStorage.setItem(FILTER_STORAGE_KEY, value); }} className={`rounded-full px-3.5 py-1.5 text-[11px] transition-colors ${kind === value ? 'bg-[#171717] text-white' : 'bg-[#f4f4f4] text-[#666] hover:bg-[#e9e9e9]'}`}>
              {label}
            </button>
          ))}
        </div>

        <div key={`${source}:${kind}`} className="app-state-motion mt-8">
          <div className="grid grid-cols-[minmax(0,1fr)_100px] gap-4 px-3 pb-2 text-[10px] text-[#999] sm:grid-cols-[minmax(0,1fr)_120px_90px]">
            <span>名称</span><span>修改时间</span><span className="hidden sm:block">大小</span>
          </div>
          {loading ? (
            <div className="px-3 py-12 text-center text-[12px] text-[#999]">正在读取文件…</div>
          ) : visibleFiles.length ? visibleFiles.map((file) => <FileRow key={file.id} file={file} onOpen={onOpen} />) : (
            <div className="px-3 py-16 text-center text-[12px] text-[#777]">{sourceFiles.length ? '没有匹配的文件' : source === 'local' ? '连接文件夹后会显示可编辑文件' : '生成的文件会保存在这里'}</div>
          )}
        </div>
      </div>
    </section>
  );
}

function readStoredFilter(): FilterKind {
  const stored = sessionStorage.getItem(FILTER_STORAGE_KEY);
  return filters.some(([value]) => value === stored) ? stored as FilterKind : 'all';
}

function FileRow({ file, onOpen }: { file: LibraryFile; onOpen: (file: LibraryFile) => void }) {
  const content = (
    <>
      <span className="flex min-w-0 items-center gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-[#f4f4f4] text-[#555]"><FileTypeIcon /></span>
        <span className="min-w-0">
          <span className="block truncate text-[#303030]">{file.title}</span>
          {file.relativePath && file.relativePath !== file.title && <span className="mt-0.5 block truncate text-[10px] text-[#888]">{file.relativePath}</span>}
        </span>
      </span>
      <span className="text-[11px] text-[#888]">{formatDate(file.modifiedAt)}</span>
      <span className="hidden text-[11px] text-[#888] sm:block">{formatSize(file.size)}</span>
    </>
  );
  const className = 'grid min-h-14 grid-cols-[minmax(0,1fr)_100px] items-center gap-4 rounded-xl px-3 text-[12px] transition-colors hover:bg-[#f7f7f7] sm:grid-cols-[minmax(0,1fr)_120px_90px]';
  return <button type="button" onClick={() => onOpen(file)} className={`${className} w-full cursor-pointer text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#171717]`}>{content}</button>;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  const today = new Date();
  return date.toDateString() === today.toDateString()
    ? '今天'
    : new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(date);
}

function SearchIcon() {
  return <svg viewBox="0 0 24 24" width="15" height="15" fill="none" className="shrink-0 text-[#888]" aria-hidden="true"><circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.8" /><path d="m16 16 4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>;
}

function FileTypeIcon() {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" aria-hidden="true">
      <path d="M6.5 3h7l4 4v14h-11V3Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M13.5 3v5h4M9.5 12h5m-5 4h5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

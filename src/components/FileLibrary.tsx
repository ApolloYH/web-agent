import { useDeferredValue, useMemo, useState } from 'react';
import type { StoredArtifact } from '@/lib/apolloAgent';

const filters = [
  ['all', '全部'],
  ['word', 'Word'],
  ['pdf', 'PDF'],
  ['markdown', 'Markdown'],
  ['json', 'JSON'],
] as const;

export default function FileLibrary({ files, loading }: { files: StoredArtifact[]; loading: boolean }) {
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<(typeof filters)[number][0]>('all');
  const deferredQuery = useDeferredValue(query);
  const visibleFiles = useMemo(() => {
    const normalized = deferredQuery.trim().toLowerCase();
    return files.filter((file) =>
      (kind === 'all' || file.kind === kind) && (!normalized || file.title.toLowerCase().includes(normalized)),
    );
  }, [deferredQuery, files, kind]);

  return (
    <section className="min-h-0 flex-1 overflow-y-auto bg-white px-5 pb-10 pt-8 md:px-10 md:pt-10">
      <div className="mx-auto w-full max-w-5xl">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="text-[22px] font-semibold tracking-[-0.035em] text-[#171717]">文件库</h1>
          <label className="flex h-9 w-full items-center gap-2 rounded-full bg-[#f4f4f4] px-3.5 sm:w-64">
            <SearchIcon />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索文件" aria-label="搜索文件" className="min-w-0 flex-1 border-0 bg-transparent text-[12px] outline-none placeholder:text-[#999]" />
          </label>
        </div>

        <div className="mt-8 flex flex-wrap gap-1.5">
          {filters.map(([value, label]) => (
            <button key={value} type="button" onClick={() => setKind(value)} className={`rounded-full px-3.5 py-1.5 text-[11px] transition-colors ${kind === value ? 'bg-[#171717] text-white' : 'bg-[#f4f4f4] text-[#666] hover:bg-[#e9e9e9]'}`}>
              {label}
            </button>
          ))}
        </div>

        <div className="mt-8">
          <div className="grid grid-cols-[minmax(0,1fr)_100px] gap-4 px-3 pb-2 text-[10px] text-[#999] sm:grid-cols-[minmax(0,1fr)_120px_90px]">
            <span>名称</span><span>修改时间</span><span className="hidden sm:block">大小</span>
          </div>
          {loading ? (
            <div className="px-3 py-12 text-center text-[12px] text-[#999]">正在读取文件…</div>
          ) : visibleFiles.length ? visibleFiles.map((file) => <FileRow key={file.id} file={file} />) : (
            <div className="px-3 py-16 text-center text-[12px] text-[#999]">{files.length ? '没有匹配的文件' : '生成的文件会保存在这里'}</div>
          )}
        </div>
      </div>
    </section>
  );
}

function FileRow({ file }: { file: StoredArtifact }) {
  const href = artifactUrl(file);
  const content = (
    <>
      <span className="flex min-w-0 items-center gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-[#f4f4f4] text-[#555]"><FileTypeIcon /></span>
        <span className="truncate text-[#303030]">{file.title}</span>
      </span>
      <span className="text-[11px] text-[#888]">{formatDate(file.modifiedAt)}</span>
      <span className="hidden text-[11px] text-[#888] sm:block">{formatSize(file.size)}</span>
    </>
  );
  const className = 'grid min-h-14 grid-cols-[minmax(0,1fr)_100px] items-center gap-4 rounded-xl px-3 text-[12px] transition-colors hover:bg-[#f7f7f7] sm:grid-cols-[minmax(0,1fr)_120px_90px]';
  return href ? <a href={href} target="_blank" rel="noreferrer" className={className}>{content}</a> : <div className={className}>{content}</div>;
}

function artifactUrl(file: StoredArtifact): string | undefined {
  if (file.url) return file.url;
  if (!file.content) return undefined;
  const mime = file.kind === 'json' ? 'application/json' : 'text/markdown';
  return `data:${mime};charset=utf-8,${encodeURIComponent(file.content)}`;
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

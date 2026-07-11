import type { Artifact } from '@/types';
import MarkdownView from './MarkdownView';
import JsonView from './JsonView';
import PdfView from './PdfView';
import WordView from './WordView';

const KIND_LABEL: Record<Artifact['kind'], string> = {
  word: 'Word',
  pdf: 'PDF',
  json: 'JSON',
  markdown: 'Markdown',
};

function download(artifact: Artifact) {
  if (!artifact.url) return;
  const link = document.createElement('a');
  link.href = artifact.url;
  link.download = artifact.title;
  link.click();
}

export default function ArtifactPanel({
  artifacts,
  active,
  onSelect,
  onClose,
}: {
  artifacts: Artifact[];
  active: Artifact | null;
  onSelect: (artifact: Artifact) => void;
  onClose: () => void;
}) {
  if (artifacts.length === 0) return null;

  return (
    <section className="flex h-full min-w-0 flex-col bg-white" aria-label="产出物预览">
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-gray-200 px-3 sm:px-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <FileIcon />
          <div className="min-w-0 leading-tight">
            <h2 className="truncate text-[12px] font-medium text-gray-900">
              {active?.title ?? '产出物'}
            </h2>
            {active && <p className="mt-0.5 text-[11px] text-gray-500">{KIND_LABEL[active.kind]}</p>}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {active?.url && (
            <button
              type="button"
              onClick={() => download(active)}
              aria-label={`下载 ${active.title}`}
              title="下载"
              className="flex size-9 cursor-pointer items-center justify-center rounded-lg text-gray-600 transition-colors duration-200 hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2"
            >
              <DownloadIcon />
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭产出物预览"
            title="关闭"
            className="flex size-9 cursor-pointer items-center justify-center rounded-lg text-gray-600 transition-colors duration-200 hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2"
          >
            <CloseIcon />
          </button>
        </div>
      </header>

      <nav className="flex shrink-0 overflow-x-auto border-b border-gray-200 px-2 sm:px-3" aria-label="产出物列表">
        {artifacts.map((artifact) => {
          const selected = active?.id === artifact.id;
          return (
            <button
              key={artifact.id}
              type="button"
              onClick={() => onSelect(artifact)}
              aria-current={selected ? 'page' : undefined}
              className={`-mb-px max-w-48 cursor-pointer truncate border-b-2 px-3 py-2 text-[12px] transition-colors duration-200 focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 ${
                selected
                  ? 'border-gray-900 font-medium text-gray-900'
                  : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-800'
              }`}
              title={artifact.title}
            >
              {artifact.title}
            </button>
          );
        })}
      </nav>

      <div className="min-h-0 flex-1 overflow-hidden">
        {active && <ArtifactBody artifact={active} />}
      </div>
    </section>
  );
}

export function ArtifactBody({ artifact }: { artifact: Artifact }) {
  switch (artifact.kind) {
    case 'markdown':
      return <MarkdownView content={artifact.content ?? ''} />;
    case 'json':
      return <JsonView content={artifact.content ?? ''} />;
    case 'pdf':
      return artifact.url ? <PdfView url={artifact.url} /> : <Empty text="PDF 缺少 url" />;
    case 'word':
      return artifact.url || artifact.content ? (
        <WordView url={artifact.url} content={artifact.content} fileName={artifact.title} />
      ) : (
        <Empty text="Word 缺少 content 或 url" />
      );
    default:
      return <Empty text="未知产出物类型" />;
  }
}

function FileIcon() {
  return (
    <svg className="size-5 shrink-0 text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M14.25 2.75H6.5a2 2 0 0 0-2 2v14.5a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V8m-5.25-5.25L19.5 8m-5.25-5.25V8h5.25M8 12h8m-8 4h8" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v12m0 0 4-4m-4 4-4-4M5 20h14" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
      <path strokeLinecap="round" d="m6 6 12 12M18 6 6 18" />
    </svg>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="flex h-full items-center justify-center px-6 text-center text-[12px] text-gray-500">{text}</div>;
}

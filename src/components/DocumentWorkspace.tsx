import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { createOfficeEditor, type OfficeEditorInstance } from '@agentbridges-ai/onlyoffice-browser';
import MarkdownView from './MarkdownView';
import WordView from './WordView';
import { appendDocxText, extractDocxText, replaceDocxText } from '@/lib/docxText';
import { downloadFile, saveDocument, type OpenDocument } from '@/lib/documentFiles';

export interface DocumentWorkspaceHandle {
  execute(action: string, input: Record<string, unknown>): Promise<Record<string, unknown>>;
}

interface Props {
  document: OpenDocument;
  workspaceLabel: string;
  onWorkspaceToggle: () => void;
  onOpenChat: () => void;
  onBack: () => void;
  onChange: (document: OpenDocument) => void;
}

type SaveStatus = 'ready' | 'dirty' | 'saving' | 'saved' | 'error';

const DocumentWorkspace = forwardRef<DocumentWorkspaceHandle, Props>(function DocumentWorkspace(
  { document, workspaceLabel, onWorkspaceToggle, onOpenChat, onBack, onChange },
  ref,
) {
  const documentRef = useRef(document);
  const editorRef = useRef<OfficeEditorInstance | null>(null);
  const textRef = useRef('');
  const saveTimerRef = useRef<number | null>(null);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const statusRef = useRef<SaveStatus>('ready');
  const closingRef = useRef(false);
  const [text, setText] = useState('');
  const [textReady, setTextReady] = useState(false);
  const [status, setStatus] = useState<SaveStatus>('ready');
  const [error, setError] = useState('');
  const [editorRevision, setEditorRevision] = useState(0);
  const [editingText, setEditingText] = useState(false);

  const updateStatus = useCallback((next: SaveStatus) => {
    statusRef.current = next;
    setStatus(next);
  }, []);

  useEffect(() => { documentRef.current = document; }, [document]);

  useEffect(() => {
    if (document.kind !== 'markdown' && document.kind !== 'json') return;
    let cancelled = false;
    setTextReady(false);
    void document.file.text().then((value) => {
      if (cancelled) return;
      textRef.current = value;
      setText(value);
      setTextReady(true);
      updateStatus('ready');
      setError('');
    });
    return () => { cancelled = true; };
  }, [document.id, document.kind, updateStatus]);

  const persist = useCallback(async (file: File) => {
    updateStatus('saving');
    setError('');
    try {
      const saved = await saveDocument(documentRef.current, file);
      documentRef.current = saved;
      onChange(saved);
      window.dispatchEvent(new CustomEvent('apollo:document-saved', { detail: { id: saved.id, name: saved.name, file: saved.file } }));
      updateStatus('saved');
      return saved;
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setError(message);
      updateStatus('error');
      throw caught;
    }
  }, [onChange, updateStatus]);

  const saveText = useCallback((content = textRef.current) => {
    const save = saveQueueRef.current.then(async () => {
      try {
        if (documentRef.current.kind === 'json') JSON.parse(content);
        const type = documentRef.current.kind === 'json' ? 'application/json' : 'text/markdown';
        const file = new File([content], documentRef.current.name, { type, lastModified: Date.now() });
        await persist(file);
        if (content !== textRef.current) updateStatus('dirty');
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
        updateStatus('error');
        throw caught;
      }
    });
    saveQueueRef.current = save.catch(() => undefined);
    return save;
  }, [persist, updateStatus]);

  const changeText = (value: string) => {
    textRef.current = value;
    setText(value);
    updateStatus('dirty');
    setError('');
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    if (documentRef.current.source === 'temporary') return;
    saveTimerRef.current = window.setTimeout(() => {
      void saveText(value).catch(() => undefined);
    }, 350);
  };

  useEffect(() => () => {
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
  }, []);

  useEffect(() => {
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      if (statusRef.current !== 'dirty' && statusRef.current !== 'saving') return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, []);

  const currentWordFile = useCallback(async () => {
    const editor = editorRef.current;
    if (!editor) return documentRef.current.file;
    return editor.save('DOCX');
  }, []);

  const currentDocumentText = useCallback(async () => documentRef.current.kind === 'word'
    ? extractDocxText(await currentWordFile())
    : textRef.current, [currentWordFile]);

  const closeDocument = useCallback(async () => {
    if (closingRef.current) return;
    closingRef.current = true;
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    try {
      if (statusRef.current === 'dirty' || statusRef.current === 'saving' || statusRef.current === 'error') {
        if (documentRef.current.kind === 'word') await currentWordFile();
        else if (documentRef.current.kind === 'markdown' || documentRef.current.kind === 'json') await saveText(textRef.current);
      }
      await saveQueueRef.current;
      onBack();
    } catch {
      // persist/saveText already exposes the actionable error in the document header.
      closingRef.current = false;
    }
  }, [currentWordFile, onBack, saveText]);

  useImperativeHandle(ref, () => ({
    async execute(action, input) {
      try {
        if (documentRef.current.kind === 'image') {
          if (action === 'get_context') return {
            ok: true,
            name: documentRef.current.name,
            kind: 'image',
            source: documentRef.current.source,
            readOnly: true,
            ...await imageMetadata(documentRef.current.file),
          };
          throw new Error('图片当前支持预览和基础信息读取，不能执行文字编辑');
        }
        if (documentRef.current.kind === 'pdf') {
          const pdf = await import('@/lib/pdfText').then(({ extractPdfText }) => extractPdfText(documentRef.current.file));
          if (action === 'get_context') return {
            ok: true,
            name: documentRef.current.name,
            kind: 'pdf',
            source: documentRef.current.source,
            readOnly: true,
            content: pdf.content.slice(0, 40_000),
            totalCharacters: pdf.content.length,
            pages: pdf.pages,
            pagesRead: pdf.pagesRead,
            truncated: pdf.truncated || pdf.content.length > 40_000,
          };
          if (action === 'search_text') {
            const query = typeof input.query === 'string' ? input.query.trim() : '';
            if (!query) throw new Error('query 不能为空');
            const requestedLimit = typeof input.max_results === 'number' ? Math.trunc(input.max_results) : 10;
            return {
              ok: true,
              query,
              pages: pdf.pages,
              matches: searchText(pdf.content, query, Math.min(Math.max(requestedLimit, 1), 20)),
              extractionTruncated: pdf.truncated,
            };
          }
          throw new Error('PDF 当前支持预览、文本读取和全文搜索，不能执行编辑');
        }
        if (action === 'get_context') {
          const content = await currentDocumentText();
          return {
            ok: true,
            name: documentRef.current.name,
            kind: documentRef.current.kind,
            source: documentRef.current.source,
            content: content.slice(0, 40_000),
            totalCharacters: content.length,
            truncated: content.length > 40_000,
          };
        }

        if (action === 'search_text') {
          const query = typeof input.query === 'string' ? input.query.trim() : '';
          if (!query) throw new Error('query 不能为空');
          const requestedLimit = typeof input.max_results === 'number' ? Math.trunc(input.max_results) : 10;
          const content = await currentDocumentText();
          return {
            ok: true,
            query,
            totalCharacters: content.length,
            matches: searchText(content, query, Math.min(Math.max(requestedLimit, 1), 20)),
          };
        }

        if (action === 'replace_text') {
          const find = typeof input.find === 'string' ? input.find : '';
          const replacement = typeof input.replacement === 'string' ? input.replacement : '';
          const replaceAll = input.replace_all !== false;
          if (!find) throw new Error('find 不能为空');
          if (documentRef.current.kind === 'word') {
            const result = await replaceDocxText(await currentWordFile(), find, replacement, replaceAll);
            await persist(result.file);
            setEditorRevision((value) => value + 1);
            return { ok: true, replacements: result.count, saved: true };
          }
          const current = textRef.current;
          const count = replaceAll ? current.split(find).length - 1 : Number(current.includes(find));
          if (!count) throw new Error(`文档中没有找到“${find}”`);
          const next = replaceAll ? current.split(find).join(replacement) : current.replace(find, replacement);
          textRef.current = next;
          setText(next);
          await saveText(next);
          return { ok: true, replacements: count, saved: true };
        }

        if (action === 'append_text') {
          const value = typeof input.text === 'string' ? input.text : '';
          if (!value.trim()) throw new Error('text 不能为空');
          if (documentRef.current.kind === 'word') {
            const file = await appendDocxText(await currentWordFile(), value);
            await persist(file);
            setEditorRevision((revision) => revision + 1);
            return { ok: true, saved: true };
          }
          const next = `${textRef.current}${textRef.current.endsWith('\n') || !textRef.current ? '' : '\n'}${value}`;
          textRef.current = next;
          setText(next);
          await saveText(next);
          return { ok: true, saved: true };
        }

        if (action === 'set_content') {
          if (documentRef.current.kind === 'word') throw new Error('Word 不支持整篇覆盖，请使用查找替换或追加');
          const content = typeof input.content === 'string' ? input.content : '';
          if (documentRef.current.kind === 'json') JSON.parse(content);
          textRef.current = content;
          setText(content);
          await saveText(content);
          return { ok: true, saved: true };
        }
        throw new Error(`未知编辑操作：${action}`);
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : String(caught);
        setError(message);
        updateStatus('error');
        return { ok: false, error: message };
      }
    },
  }), [currentDocumentText, currentWordFile, persist, saveText, updateStatus]);

  const jsonError = document.kind === 'json' && textReady ? validateJson(text) : '';
  const editableText = document.kind === 'markdown' || document.kind === 'json';
  const readOnlyPreview = document.kind === 'pdf' || document.kind === 'image';
  const handleWordError = useCallback((message: string) => {
    setError(message);
    updateStatus('error');
  }, [updateStatus]);

  return (
    <section className="flex h-full min-w-0 flex-1 flex-col bg-white" aria-label={`${readOnlyPreview ? '预览' : '编辑'} ${document.name}`}>
      <header className="flex h-12 shrink-0 items-center gap-1.5 border-b border-black/[0.06] bg-white px-3 sm:px-5">
        <button type="button" onClick={() => { void closeDocument(); }} className="icon-button" aria-label="保存并返回"><CloseIcon /></button>
        <button type="button" onClick={onWorkspaceToggle} className="icon-button hidden sm:inline-flex" aria-label={`切换工作目录，当前：${workspaceLabel}`} title="切换远端/本地目录"><FolderIcon /></button>
        <span className="hidden max-w-32 truncate text-[10px] font-medium text-[#555] sm:inline" title={`Agent 工作目录：${workspaceLabel}`}>{workspaceLabel}</span>
        <span className="hidden text-[11px] text-[#8b8b8b] sm:inline">文件库</span>
        <span className="hidden text-[11px] text-[#b5b5b5] sm:inline">/</span>
        <h1 className="min-w-0 flex-1 truncate text-[12px] font-medium text-[#2d2d2d]">{document.name}</h1>
        <span className={`hidden max-w-44 truncate text-[10px] sm:inline ${error ? 'text-red-600' : 'text-[#999]'}`} title={error}>{error || statusLabel(status)}</span>
        {editableText && (
          <button type="button" onClick={() => setEditingText((value) => !value)} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[11px] text-[#444] hover:bg-[#f3f3f3]">
            <EditIcon />{editingText ? '完成' : '编辑'}
          </button>
        )}
        {document.kind === 'json' && (
          <button type="button" disabled={Boolean(jsonError)} onClick={() => changeText(JSON.stringify(JSON.parse(text), null, 2))} className="hidden rounded-lg px-2.5 py-1.5 text-[11px] text-[#555] hover:bg-[#f2f2f2] disabled:text-[#bbb] sm:block">格式化</button>
        )}
        <button type="button" onClick={onOpenChat} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[11px] text-[#555] hover:bg-[#f2f2f2]" aria-label="打开关于此文件的问答"><ChatIcon />问答</button>
        <button type="button" onClick={() => downloadFile(documentRef.current.file)} className="icon-button" aria-label="下载" title="下载"><DownloadIcon /></button>
      </header>

      <div className="min-h-0 flex-1 bg-white">
        {document.kind === 'word' ? (
          <div className="h-full overflow-hidden bg-white">
            <WordEditor
              key={`${document.id}-${editorRevision}`}
              document={documentRef.current}
              editorRef={editorRef}
              onSave={persist}
              onStatus={updateStatus}
              onError={handleWordError}
            />
          </div>
        ) : readOnlyPreview ? (
          <MediaPreview key={`${document.id}-${document.file.lastModified}`} document={document} />
        ) : !textReady ? (
          <div className="flex h-full items-center justify-center text-[12px] text-[#777]">正在读取文件…</div>
        ) : (
          <div className="relative h-full min-h-0 overflow-hidden bg-white">
            {editingText ? (
              <label className="block h-full">
                <span className="sr-only">文档内容</span>
                <textarea
                  value={text}
                  onChange={(event) => changeText(event.target.value)}
                  onKeyDown={(event) => {
                    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
                      event.preventDefault();
                      void saveText().catch(() => undefined);
                    }
                  }}
                  spellCheck={document.kind === 'markdown'}
                  className="h-full min-h-0 w-full resize-none border-0 bg-white px-7 py-8 font-mono text-[13px] leading-6 text-[#202020] outline-none sm:px-12 sm:py-10 lg:px-[8%]"
                />
              </label>
            ) : document.kind === 'markdown' ? (
              <MarkdownView content={text} className="prose-chat h-full overflow-auto px-7 py-8 text-[14px] leading-6 text-[#202020] sm:px-14 sm:py-12 lg:px-[8%]" />
            ) : (
              <pre className="h-full overflow-auto bg-white px-7 py-8 font-mono text-[13px] leading-6 text-[#202020] sm:px-12 sm:py-10 lg:px-[8%]"><code>{text}</code></pre>
            )}
            {jsonError && <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-red-50 px-3 py-1.5 text-[11px] text-red-700 shadow-sm">{jsonError}</div>}
          </div>
        )}
      </div>
    </section>
  );
});

function MediaPreview({ document }: { document: OpenDocument }) {
  const [url, setUrl] = useState('');

  useEffect(() => {
    const next = URL.createObjectURL(document.file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [document.file]);

  if (!url) return <div className="flex h-full items-center justify-center text-[12px] text-[#777]">正在读取文件…</div>;
  if (document.kind === 'image') {
    return (
      <div className="flex h-full items-center justify-center overflow-hidden bg-[#f3f3f3] p-4 sm:p-8">
        <img src={url} alt={document.name} className="block max-h-full max-w-full object-contain" />
      </div>
    );
  }
  return <iframe src={url} title={document.name} className="h-full w-full border-0 bg-[#f3f3f3]" />;
}

function WordEditor({ document, editorRef, onSave, onStatus, onError }: {
  document: OpenDocument;
  editorRef: React.MutableRefObject<OfficeEditorInstance | null>;
  onSave: (file: File) => Promise<OpenDocument>;
  onStatus: (status: SaveStatus) => void;
  onError: (message: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState('');
  const [loading, setLoading] = useState(true);
  const [previewVisible, setPreviewVisible] = useState(true);
  const canPreview = document.name.toLowerCase().endsWith('.docx');

  useEffect(() => {
    if (loading) return;
    const timer = window.setTimeout(() => setPreviewVisible(false), 200);
    return () => window.clearTimeout(timer);
  }, [loading]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let disposed = false;
    let instance: OfficeEditorInstance | null = null;
    setLoading(true);
    onStatus('ready');
    const hostUrl = officeHostUrl();
    void (async () => {
      if (disposed) return null;
      return createOfficeEditor(container, {
        hostUrl,
        file: document.file,
        fileName: document.name,
        mode: 'edit',
        lang: 'zh-CN',
        saveBehavior: 'callback',
        onReady: (value) => {
          if (disposed) return;
          instance = value;
          editorRef.current = value;
          setFailed('');
          setLoading(false);
          onStatus('ready');
        },
        onDirtyChange: (dirty) => {
          if (!disposed) onStatus(dirty ? 'dirty' : 'saved');
        },
        onSave: async (file) => {
          if (!disposed) await onSave(file);
        },
        onError: (caught) => {
          if (disposed) return;
          const message = caught.message;
          setLoading(false);
          setFailed(message);
          onError(message);
        },
      });
    })().then((value) => {
      if (!value) return;
      if (disposed) void value.destroy();
      else {
        instance = value;
        editorRef.current = value;
      }
    }).catch((caught) => {
      if (disposed) return;
      const message = caught instanceof Error ? caught.message : String(caught);
      setLoading(false);
      setFailed(message);
      onError(message);
    });
    return () => {
      disposed = true;
      if (editorRef.current === instance) editorRef.current = null;
      void instance?.destroy();
    };
  }, [editorRef, onError, onSave, onStatus]);

  if (failed) {
    return (
      <div className="relative h-full">
        <WordView file={document.file} fileName={document.name} />
        <div className="absolute inset-x-4 bottom-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[11px] leading-5 text-amber-900 shadow-sm">
          {wordFailureMessage(failed)}
        </div>
      </div>
    );
  }
  return (
    <div className="word-editor-surface relative h-full w-full overflow-hidden bg-[#f3f3f3]">
      {previewVisible && canPreview && (
        <div className={`absolute inset-0 transition-opacity duration-200 motion-reduce:transition-none ${loading ? 'opacity-100' : 'pointer-events-none opacity-0'}`}>
          <WordView file={document.file} fileName={document.name} />
        </div>
      )}
      <div ref={containerRef} className={`absolute inset-0 bg-white transition-opacity duration-200 motion-reduce:transition-none ${loading ? 'pointer-events-none opacity-0' : 'opacity-100'}`} />
      {loading && (
        <div
          role="status"
          aria-live="polite"
          aria-label="正在加载 Word 文档"
          className="absolute inset-x-0 top-0 z-10 flex h-9 items-center justify-center gap-2 border-b border-black/[0.06] bg-white/90 text-[#777] backdrop-blur-sm"
        >
          <span
            aria-hidden="true"
            className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-[#dedede] border-t-[#171717] motion-reduce:animate-none"
          />
          <span className="text-[11px]">只读预览 · 正在准备编辑器…</span>
        </div>
      )}
    </div>
  );
}

export function officeHostUrl(): string {
  const configured = import.meta.env.VITE_OFFICE_HOST_URL as string | undefined;
  if (configured) return configured;
  if (window.location.hostname === 'apollo.yh521.top') return 'https://office-cdn.yh521.top/office-host.html';
  return `http://127.0.0.1:${import.meta.env.VITE_OFFICE_HOST_PORT || '5174'}/office-host.html`;
}

function validateJson(value: string): string {
  try { JSON.parse(value); return ''; }
  catch (error) { return error instanceof Error ? error.message : 'JSON 格式无效'; }
}

function searchText(content: string, query: string, limit: number) {
  const matches: Array<{ index: number; context: string }> = [];
  const normalizedContent = content.toLocaleLowerCase();
  const normalizedQuery = query.toLocaleLowerCase();
  for (
    let index = normalizedContent.indexOf(normalizedQuery);
    index >= 0 && matches.length < limit;
    index = normalizedContent.indexOf(normalizedQuery, index + normalizedQuery.length)
  ) {
    const start = Math.max(0, index - 80);
    const end = Math.min(content.length, index + query.length + 120);
    matches.push({ index, context: `${start ? '…' : ''}${content.slice(start, end)}${end < content.length ? '…' : ''}` });
  }
  return matches;
}

async function imageMetadata(file: File) {
  const bitmap = await createImageBitmap(file);
  const metadata = {
    content: `图片：${file.name}，${bitmap.width} × ${bitmap.height} 像素，${file.type || '未知格式'}，${file.size} 字节。当前文档工具不执行图片内容识别。`,
    width: bitmap.width,
    height: bitmap.height,
    mediaType: file.type,
    size: file.size,
    visualAnalysisAvailable: false,
  };
  bitmap.close();
  return metadata;
}

function statusLabel(status: SaveStatus): string {
  if (status === 'dirty') return '未保存';
  if (status === 'saving') return '保存中…';
  if (status === 'saved') return '已保存';
  if (status === 'error') return '保存失败';
  return '已打开';
}

function wordFailureMessage(error: string): string {
  if (/memory access out of bounds/i.test(error)) {
    return '该 Word 的复杂版式或嵌入对象超出浏览器转换器兼容范围，已安全切换为只读预览，原文件没有被修改。可先用桌面 Word 另存为标准 DOCX 后重试编辑。';
  }
  return `Word 在线编辑暂时未连接，当前已切换为只读预览：${error}`;
}

function CloseIcon() { return <svg viewBox="0 0 24 24" width="17" height="17" fill="none" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>; }
function FolderIcon() { return <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true"><path d="M3.5 6.5h6l2 2h9v9.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2V6.5Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /></svg>; }
function ChatIcon() { return <svg viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true"><path d="M5 5.5h14v10H9l-4 3v-13Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /></svg>; }
function EditIcon() { return <svg viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true"><path d="m4 20 4.2-1 10-10a2.1 2.1 0 0 0-3-3l-10 10L4 20Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /></svg>; }
function DownloadIcon() { return <svg viewBox="0 0 24 24" width="17" height="17" fill="none" aria-hidden="true"><path d="M12 3v12m0 0 4-4m-4 4-4-4M5 20h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>; }

export default DocumentWorkspace;

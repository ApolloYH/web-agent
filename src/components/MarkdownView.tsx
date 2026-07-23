import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { isValidElement, useEffect, useRef, useState, type ComponentPropsWithoutRef, type ReactNode } from 'react';
import hljs from 'highlight.js';
import { markdownHtmlPlugins } from '@/lib/markdownHtml';

const LANGUAGE_LABELS: Record<string, string> = {
  bash: 'Bash', css: 'CSS', html: 'HTML', javascript: 'JavaScript', js: 'JavaScript', json: 'JSON',
  markdown: 'Markdown', md: 'Markdown', python: 'Python', py: 'Python', shell: 'Shell', sql: 'SQL',
  ts: 'TypeScript', tsx: 'TSX', typescript: 'TypeScript', jsx: 'JSX', yaml: 'YAML', yml: 'YAML',
};

function CodeBlock({ children }: ComponentPropsWithoutRef<'pre'>) {
  const code = isValidElement<{ className?: string; children?: ReactNode }>(children) ? children : null;
  const language = code?.props.className?.match(/language-([\w-]+)/)?.[1]?.toLowerCase() || '';
  const source = String(code?.props.children ?? '');
  const [copied, setCopied] = useState(false);

  useEffect(() => setCopied(false), [source]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(source.replace(/\n$/, ''));
      setCopied(true);
    } catch {
      window.alert('复制失败，请检查浏览器剪贴板权限');
    }
  };

  return (
    <div className="code-block">
      <div className="code-block-header">
        <span className="code-block-language"><CodeIcon />{LANGUAGE_LABELS[language] || language || '代码'}</span>
        <button type="button" className="code-block-copy" onClick={copy} aria-label="复制代码" title="复制代码">
          <CopyIcon /> <span>{copied ? '已复制' : '复制'}</span>
        </button>
      </div>
      <pre>{children}</pre>
    </div>
  );
}

export default function MarkdownView({ content, className }: { content: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.querySelectorAll('pre code').forEach((el) => {
      hljs.highlightElement(el as HTMLElement);
    });
  }, [content]);

  return (
    <div ref={ref} className={className ?? 'prose-chat h-full overflow-auto p-5 text-[13px] leading-5 text-gray-800'}>
      <ReactMarkdown components={{ pre: CodeBlock }} remarkPlugins={[remarkGfm]} rehypePlugins={markdownHtmlPlugins}>{content}</ReactMarkdown>
    </div>
  );
}

function CodeIcon() {
  return <svg viewBox="0 0 24 24" width="17" height="17" fill="none" aria-hidden="true"><path d="m8.5 7-4 5 4 5M15.5 7l4 5-4 5M13.5 5l-3 14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function CopyIcon() {
  return <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="1.7" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" stroke="currentColor" strokeWidth="1.7" /></svg>;
}

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useEffect, useRef } from 'react';
import hljs from 'highlight.js';
import { markdownHtmlPlugins } from '@/lib/markdownHtml';

export default function MarkdownView({ content, className }: { content: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.querySelectorAll('pre code').forEach((el) => {
      hljs.highlightElement(el as HTMLElement);
    });
  }, [content]);

  return (
    <div ref={ref} className={className ?? 'prose-chat h-full overflow-auto p-5 text-[13px] leading-5 text-gray-800'}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={markdownHtmlPlugins}>{content}</ReactMarkdown>
    </div>
  );
}

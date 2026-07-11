import { useEffect, useRef, useState } from 'react';
import { renderAsync } from 'docx-preview';

interface Props {
  /** 通道 B：后台 docx 下载地址 */
  url?: string;
  /** 通道 A：base64 内联的 docx 字节 */
  content?: string;
  fileName: string;
}

/** base64 → Uint8Array */
function b64ToBytes(b64: string): Uint8Array {
  // 兼容 data URL 前缀
  const pure = b64.includes(',') ? b64.slice(b64.indexOf(',') + 1) : b64;
  const bin = atob(pure);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export default function WordView({ url, content, fileName }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errMsg, setErrMsg] = useState('');

  useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;
    if (!container) return;

    setStatus('loading');
    container.innerHTML = '';

    (async () => {
      try {
        let data: Blob;
        if (content) {
          // 通道 A：内联 base64
          data = new Blob([b64ToBytes(content) as BlobPart], {
            type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          });
        } else if (url) {
          // 通道 B：拉取后台文件
          const resp = await fetch(url);
          if (!resp.ok) throw new Error(`下载文档失败：${resp.status}`);
          data = await resp.blob();
        } else {
          throw new Error('缺少 content 或 url');
        }
        if (cancelled) return;

        await renderAsync(data, container, undefined, {
          className: 'docx',
          inWrapper: true,
          ignoreWidth: false,
          ignoreHeight: false,
          breakPages: true,
          experimental: true,
          useBase64URL: true,
        });
        if (!cancelled) setStatus('ready');
      } catch (e) {
        if (cancelled) return;
        setErrMsg(e instanceof Error ? e.message : String(e));
        setStatus('error');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [url, content, fileName]);

  return (
    <div className="relative h-full w-full overflow-auto bg-gray-100">
      <div ref={containerRef} className="docx-host mx-auto py-4" />
      {status === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/70 text-gray-500">
          正在渲染 Word 文档…
        </div>
      )}
      {status === 'error' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-white/95 p-6 text-center">
          <div className="font-medium text-red-600">Word 预览失败</div>
          <div className="max-w-md text-[12px] text-gray-500">{errMsg}</div>
        </div>
      )}
    </div>
  );
}

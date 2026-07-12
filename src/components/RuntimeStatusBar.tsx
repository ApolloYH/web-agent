import type { RuntimeStatus } from '@/types';
import { useDismissDetails } from '@/lib/useDismissDetails';

const rate = (value: number | null) => value === null ? '暂无' : `${(value * 100).toFixed(1)}%`;

export default function RuntimeStatusBar({ status }: { status: RuntimeStatus | null }) {
  const detailsRef = useDismissDetails();
  return (
    <details ref={detailsRef} className="group absolute right-14 top-2.5 z-20 text-[11px] text-gray-600">
      <summary
        aria-label="查看智能体运行状态"
        className="flex h-9 cursor-pointer list-none items-center gap-2 rounded-lg px-2.5 transition-colors hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2 [&::-webkit-details-marker]:hidden"
      >
        <span className={`h-1.5 w-1.5 rounded-full ${status ? 'bg-emerald-500' : 'animate-pulse bg-gray-400'}`} aria-hidden="true" />
        <span className="hidden max-w-32 truncate sm:inline">{status ? status.model : '正在连接'}</span>
        <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5 text-gray-400 transition-transform group-open:rotate-180">
          <path fillRule="evenodd" d="M5.2 7.2a.75.75 0 0 1 1.1 0L10 10.9l3.7-3.7a.75.75 0 1 1 1.1 1.1l-4.2 4.2a.75.75 0 0 1-1.1 0L5.2 8.3a.75.75 0 0 1 0-1.1Z" clipRule="evenodd" />
        </svg>
      </summary>
      <div className="fixed left-3 right-3 top-14 rounded-2xl border border-black/[0.08] bg-white p-4 shadow-[0_18px_48px_rgba(0,0,0,0.12)] sm:absolute sm:left-auto sm:right-0 sm:top-auto sm:mt-2 sm:w-[min(22rem,calc(100vw-1.5rem))]">
        {!status ? (
          <p className="text-[12px] text-gray-500">正在连接智能体…</p>
        ) : <>
        <div className="mb-3 flex items-start justify-between gap-4 border-b border-gray-100 pb-3">
          <div>
            <p className="font-medium text-gray-900">Apollo {status.version}</p>
            <p className="mt-0.5 text-gray-500">{status.model} · {modeLabel(status.mode)}</p>
          </div>
          <span className="shrink-0 text-right text-gray-500">{status.messages} 条消息</span>
        </div>
        <div className="space-y-2">
        <Status label="运行模式" value={modeLabel(status.mode)} />
        <Status label="Token" value={`${status.inputTokens.toLocaleString()} 输入 / ${status.outputTokens.toLocaleString()} 输出`} />
        <Status label="缓存率" value={`${rate(status.latestHitRate)} 最新 / ${rate(status.cacheHitRate)} 会话`} />
        {status.goal && <Status label="当前目标" value={status.goal} />}
        <Status label="会话" value={status.session ?? '新会话'} />
        </div>
        </>}
      </div>
    </details>
  );
}

function modeLabel(mode: string): string {
  if (mode === 'normal') return '普通';
  if (mode === 'plan') return '计划';
  if (mode === 'goal') return '目标';
  if (mode === 'workflow') return '工作流';
  return mode;
}

function Status({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 gap-2">
      <span className="shrink-0 text-gray-400">{label}</span>
      <span className="truncate text-gray-700" title={value}>{value}</span>
    </div>
  );
}

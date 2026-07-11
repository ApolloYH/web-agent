import { useEffect, useState } from 'react';
import type { FileChange, ProcessStep } from '@/types';

export default function ProcessTimeline({
  steps,
  streaming,
  onRespond,
}: {
  steps: ProcessStep[];
  streaming: boolean;
  onRespond?: (stepId: string, answer: string) => Promise<void>;
}) {
  const visibleSteps = steps.filter(isImportantStep);
  if (!visibleSteps.length) return null;
  return (
    <div className="mb-3 space-y-1">
      {visibleSteps.map((step) => (
        <ProcessStepRow key={step.id} step={step} streaming={streaming} onRespond={onRespond} />
      ))}
    </div>
  );
}

function isImportantStep(step: ProcessStep): boolean {
  if (step.kind === 'approval' || step.kind === 'question' || step.kind === 'goal' || step.kind === 'workflow') return true;
  if (step.kind === 'task' || step.fileChange || step.tone === 'error' || step.tone === 'warning') return true;
  if (step.kind === 'thought') return Boolean(step.pending || step.detail?.trim());
  return step.kind === 'tool_run';
}

function ProcessStepRow({
  step,
  streaming,
  onRespond,
}: {
  step: ProcessStep;
  streaming: boolean;
  onRespond?: (stepId: string, answer: string) => Promise<void>;
}) {
  if (step.kind === 'workflow') return <WorkflowStep step={step} />;
  if (step.kind === 'goal') return <GoalStep step={step} />;
  if (step.kind === 'approval' || step.kind === 'question') {
    return <InteractionStep step={step} onRespond={onRespond} />;
  }

  const autoFold = step.kind === 'thought' || step.kind === 'tool_run' || step.kind === 'task';
  const [open, setOpen] = useState(autoFold && streaming);
  useEffect(() => {
    if (autoFold) setOpen(streaming);
  }, [autoFold, streaming]);
  const detail = step.kind === 'thought'
    ? step.detail?.replace(/\n(?:\s*\n)+/g, '\n')
    : step.detail;
  const hasBody = Boolean(
    detail?.trim() || step.command?.trim() || step.fileChange || step.progress?.length || step.result,
  );
  const duration = step.durationSec === undefined ? '' : ` · ${step.durationSec.toFixed(1)}s`;
  const title = step.kind === 'thought'
    ? step.pending
      ? 'Thinking…'
      : `Thought${step.durationSec === undefined ? '' : ` for ${step.durationSec.toFixed(1)}s`}`
    : step.kind === 'task'
      ? `${step.title}${duration}`
      : step.kind === 'tool_run'
        ? `${step.title}${duration}`
        : step.title;

  return (
    <div className={`text-[12px] leading-[18px] ${step.kind === 'thought' ? 'max-w-[640px]' : ''}`}>
      <button
        type="button"
        onClick={() => hasBody && setOpen((value) => !value)}
        className={`group flex w-full items-center gap-2 rounded-md px-1 py-0.5 text-left ${hasBody ? 'hover:bg-black/[0.03]' : 'cursor-default'}`}
        disabled={!hasBody}
        aria-expanded={open}
      >
        <StatusGlyph step={step} />
        <span className={`min-w-0 flex-1 font-medium ${toneClass(step.tone)}`}>{title}</span>
        {step.risk && step.risk !== 'low' && (
          <span className="rounded bg-amber-100 px-1.5 text-[10px] uppercase text-amber-700">{step.risk}</span>
        )}
        {hasBody && <span className="text-gray-400">{open ? '▾' : '▸'}</span>}
      </button>

      {open && hasBody && (
        <div className="ml-5 mb-2 mt-1 space-y-2 pl-3">
          {step.command && (
            <pre className="max-h-64 overflow-auto rounded-lg bg-[#171717] px-3 py-2 font-mono text-[11px] leading-[18px] text-[#d4d4d4]">
              {step.command}
            </pre>
          )}
          {step.progress?.map((line, index) => (
            <div key={`${index}-${line}`} className="text-gray-500">{line}</div>
          ))}
          {detail?.trim() && <pre className={`max-h-72 overflow-auto whitespace-pre-wrap text-[11px] text-gray-500 ${step.kind === 'thought' ? 'leading-4' : 'leading-[18px]'}`}>{detail}</pre>}
          {step.result && <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-2 text-[11px] leading-[18px] text-gray-600">{step.result}</pre>}
          {step.fileChange && <FileDiff change={step.fileChange} />}
        </div>
      )}
    </div>
  );
}

function StatusGlyph({ step }: { step: ProcessStep }) {
  if (step.pending) return <SpinnerGlyph />;
  const color = step.tone === 'error'
    ? 'text-red-500'
    : step.tone === 'warning'
      ? 'text-amber-500'
      : step.tone === 'success'
        ? 'text-emerald-500'
        : 'text-gray-400';
  return <span className={`w-3 shrink-0 text-[11px] leading-none ${color}`}>●</span>;
}

function SpinnerGlyph() {
  const frames = ['·', '✢', '✳', '✶', '✻', '✽', '✽', '✻', '✶', '✳', '✢'];
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setFrame((value) => (value + 1) % frames.length), 160);
    return () => window.clearInterval(timer);
  }, [frames.length]);
  return <span className="w-3 shrink-0 text-[12px] leading-none text-blue-500">{frames[frame]}</span>;
}

function FileDiff({ change }: { change: FileChange }) {
  let oldLine = 1;
  let newLine = 1;
  const rows = change.lines.flatMap((raw, index) => {
    const hunk = raw.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      return [];
    }
    let number = newLine;
    let marker = ' ';
    let kind = 'context';
    let content = raw;
    if (change.kind === 'create') newLine += 1;
    else if (raw.startsWith('+')) {
      marker = '+';
      kind = 'add';
      content = raw.slice(1);
      newLine += 1;
    } else if (raw.startsWith('-')) {
      number = oldLine;
      marker = '-';
      kind = 'remove';
      content = raw.slice(1);
      oldLine += 1;
    } else {
      content = raw.startsWith(' ') ? raw.slice(1) : raw;
      oldLine += 1;
      newLine += 1;
    }
    return [{ id: index, number, marker, kind, content }];
  });

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
      <div className="flex items-center justify-between border-b border-gray-200 bg-gray-50 px-3 py-1.5">
        <span className="font-medium text-gray-700">{change.kind === 'create' ? 'Write' : 'Update'}({change.path})</span>
        <span className="text-[11px]"><b className="text-emerald-600">+{change.added}</b>{change.kind === 'update' && <b className="ml-2 text-red-500">-{change.removed}</b>}</span>
      </div>
      <div className="max-h-80 overflow-auto font-mono text-[11px] leading-[18px]">
        {rows.map((row) => (
          <div key={row.id} className={`flex ${row.kind === 'add' ? 'bg-emerald-50 text-emerald-900' : row.kind === 'remove' ? 'bg-red-50 text-red-900' : 'text-gray-600'}`}>
            <span className="w-10 shrink-0 select-none border-r border-black/5 pr-2 text-right text-gray-400">{row.number}</span>
            <span className="w-7 shrink-0 select-none text-center">{row.marker}</span>
            <span className="whitespace-pre pr-3">{row.content}</span>
          </div>
        ))}
        {change.omitted > 0 && <div className="px-3 py-1 text-gray-400">… +{change.omitted} lines</div>}
      </div>
    </div>
  );
}

function WorkflowStep({ step }: { step: ProcessStep }) {
  return (
    <div className="rounded-lg border border-blue-100 bg-blue-50/50 p-2.5 text-[12px]">
      <div className="mb-2 font-semibold text-blue-700">Workflow</div>
      <div className="flex flex-wrap items-center gap-2">
        {step.phases?.map((phase, index) => (
          <div key={phase.name} className="contents">
            {index > 0 && <span className="text-gray-300">→</span>}
            <span className={phase.status === 'completed' ? 'text-emerald-600' : phase.status === 'running' ? 'font-semibold text-amber-600' : phase.status === 'failed' ? 'text-red-600' : 'text-gray-400'}>
              {phase.status === 'completed' ? '●' : phase.status === 'running' ? '◉' : '○'} {phase.label}
            </span>
          </div>
        ))}
      </div>
      {step.goal && <div className="mt-2 text-gray-500">goal: {step.goal}</div>}
    </div>
  );
}

function GoalStep({ step }: { step: ProcessStep }) {
  return (
    <div className="rounded-lg border border-violet-100 bg-violet-50/50 p-2.5 text-[12px]">
      <div className="font-semibold text-violet-700">Goal · {step.status} · iter {step.iteration}/{step.maxIterations}</div>
      <div className="mt-1 text-gray-700">{step.goal}</div>
      {step.progress?.length ? (
        <div className="mt-2 space-y-1 text-gray-500">{step.progress.slice(-5).map((line) => <div key={line}>· {line}</div>)}</div>
      ) : null}
    </div>
  );
}

function InteractionStep({
  step,
  onRespond,
}: {
  step: ProcessStep;
  onRespond?: (stepId: string, answer: string) => Promise<void>;
}) {
  const [custom, setCustom] = useState('');
  const [error, setError] = useState('');
  const answer = async (value: string) => {
    if (!step.interactionId || !onRespond) return;
    setError('');
    try {
      await onRespond(step.interactionId, value);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  return (
    <div className={`rounded-lg border p-3 text-[12px] leading-[18px] ${step.kind === 'approval' ? 'border-amber-200 bg-amber-50' : 'border-blue-200 bg-blue-50'}`}>
      <div className="flex items-center gap-2 font-semibold text-gray-800">
        <span>{step.pending ? '?' : '●'}</span>
        <span>{step.kind === 'approval' ? `Approval · ${step.title}` : step.title}</span>
        {step.risk && <span className="rounded bg-white/70 px-1.5 text-[10px] uppercase text-amber-700">{step.risk}</span>}
      </div>
      {step.detail && <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap text-[11px] leading-[18px] text-gray-600">{step.detail}</pre>}
      {step.pending ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {step.kind === 'approval' ? (
            <>
              <ActionButton onClick={() => answer('approve')} primary>批准</ActionButton>
              <ActionButton onClick={() => answer('deny')}>拒绝</ActionButton>
            </>
          ) : (
            <>
              {step.options?.map((option) => <ActionButton key={option} onClick={() => answer(option)}>{option}</ActionButton>)}
              <input value={custom} onChange={(event) => setCustom(event.target.value)} placeholder="自定义回答" className="min-w-40 flex-1 rounded-md border border-blue-200 bg-white px-2 py-1 outline-none focus:border-blue-400" />
              <ActionButton onClick={() => custom.trim() && answer(custom.trim())} primary>提交</ActionButton>
            </>
          )}
        </div>
      ) : <div className="mt-2 text-gray-500">回答：{step.answer}</div>}
      {error && <div className="mt-2 text-red-600">{error}</div>}
    </div>
  );
}

function ActionButton({ children, onClick, primary = false }: { children: React.ReactNode; onClick: () => void; primary?: boolean }) {
  return <button type="button" onClick={onClick} className={`rounded-md border px-3 py-1 ${primary ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'}`}>{children}</button>;
}

function toneClass(tone: ProcessStep['tone']): string {
  if (tone === 'error') return 'text-red-700';
  if (tone === 'warning') return 'text-amber-700';
  if (tone === 'success') return 'text-emerald-700';
  if (tone === 'info') return 'text-blue-700';
  return 'text-gray-700';
}

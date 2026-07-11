import type { TraceEvent } from '../../agent/dist/sdk.js';
import type { ProcessStep } from '@/types';
import type { ApolloEvent } from './apolloAgent';

let sequence = 0;
const nextId = (prefix: string) => `${prefix}-${sequence++}`;

export function applyApolloEvent(steps: ProcessStep[], wireEvent: ApolloEvent): ProcessStep[] {
  if (wireEvent.type === 'interaction') {
    return [
      ...steps,
      {
        id: wireEvent.id,
        kind: wireEvent.kind,
        title: wireEvent.title,
        detail: wireEvent.detail,
        risk: wireEvent.risk,
        options: wireEvent.options,
        interactionId: wireEvent.id,
        pending: true,
        tone: wireEvent.kind === 'approval' ? 'warning' : 'info',
      },
    ];
  }
  if (wireEvent.type !== 'trace') return steps;
  return applyTraceEvent(steps, wireEvent.event);
}

function applyTraceEvent(steps: ProcessStep[], event: TraceEvent): ProcessStep[] {
  switch (event.type) {
    case 'llm_request': {
      const index = findLastIndex(steps, (step) => step.kind === 'thought');
      if (index >= 0 && steps[index]?.pending) {
        return steps.map((step, stepIndex) => stepIndex === index
          ? { ...step, startedAtMs: step.startedAtMs ?? Date.now() }
          : step);
      }
      return [
        ...steps,
        {
          id: nextId('thought'),
          kind: 'thought',
          title: 'Thought',
          pending: true,
          startedAtMs: Date.now(),
        },
      ];
    }
    case 'thinking_delta':
      return updateLast(steps, (step) => step.kind === 'thought' && Boolean(step.pending), (step) => appendThoughtDelta(step, event.text));
    case 'llm_tool_delta':
      return steps;
    case 'llm_response':
      return updateLast(steps, (step) => step.kind === 'thought' && Boolean(step.pending), completeThought);
    case 'assistant_delta':
      return updateLast(steps, (step) => step.kind === 'thought' && Boolean(step.pending), completeThought);
    case 'llm_retry':
      return steps;
    case 'tool_call':
      return [
        ...steps,
        {
          id: nextId(`tool-${event.tool}`),
          kind: 'tool_run',
          title: toolStatus(event.tool, event.input),
          toolName: event.tool,
          risk: event.risk,
          pending: true,
          tone: 'info',
        },
      ];
    case 'tool_result':
      return updateLast(
        steps,
        (step) => step.kind === 'tool_run' && step.toolName === event.tool && Boolean(step.pending),
        (step) => ({
          ...step,
          title: toolResultLabel(event.tool, event.input, event.content, event.isError),
          pending: false,
          detail: toolOutput(event.tool, event.content),
          tone: event.isError ? 'error' : 'success',
          fileChange: event.fileChange,
        }),
      );
    case 'approval_result':
      return updateLast(
        steps,
        (step) => step.kind === 'approval' && step.title === event.tool && Boolean(step.pending),
        (step) => ({ ...step, pending: false, answer: event.approved ? '已批准' : '已拒绝', tone: event.approved ? 'success' : 'error' }),
      );
    case 'context_compaction_start':
      return [
        ...steps,
        {
          id: nextId('compaction'),
          kind: 'notice',
          title: 'Compacting context',
          detail: `${event.beforeChars.toLocaleString()} chars`,
          pending: true,
          tone: 'info',
        },
      ];
    case 'context_compacted':
      return updateLast(steps, (step) => step.kind === 'notice' && step.title === 'Compacting context' && Boolean(step.pending), (step) => ({
        ...step,
        title: 'Context compacted',
        detail: `${event.beforeChars.toLocaleString()} → ${event.afterChars.toLocaleString()} chars`,
        pending: false,
        tone: 'success',
      }));
    case 'context_compaction_failed':
      return updateLast(steps, (step) => step.kind === 'notice' && step.title === 'Compacting context' && Boolean(step.pending), (step) => ({
        ...step,
        title: 'Context compaction failed',
        detail: event.reason,
        pending: false,
        tone: 'error',
      }));
    case 'task_start':
      return [
        ...steps,
        {
          id: `task-${event.id}`,
          kind: 'task',
          title: `Task(${event.subagentType}): ${event.description}`,
          progress: [],
          pending: true,
          tone: 'info',
        },
      ];
    case 'task_progress':
      return updateById(steps, `task-${event.id}`, (step) => ({
        ...step,
        progress: step.progress?.at(-1) === event.message ? step.progress : [...(step.progress ?? []), event.message],
      }));
    case 'task_finish':
      return updateById(steps, `task-${event.id}`, (step) => ({
        ...step,
        pending: false,
        durationSec: event.durationMs / 1000,
        result: event.result,
        tone: 'success',
      }));
    case 'workflow_status':
      return upsertByKind(steps, 'workflow', {
        id: nextId('workflow'),
        kind: 'workflow',
        title: 'Workflow',
        goal: event.goal,
        phases: event.phases,
      });
    case 'goal_status':
      return upsertByKind(steps, 'goal', {
        id: nextId('goal'),
        kind: 'goal',
        title: 'Goal',
        goal: event.goal,
        status: event.status,
        iteration: event.iteration,
        maxIterations: event.maxIterations,
        progress: event.progress,
        tone: event.status === 'completed' ? 'success' : event.status === 'failed' ? 'error' : 'info',
      });
    case 'plan_mode':
      return [
        ...steps,
        {
          id: nextId('plan'),
          kind: 'plan',
          title: event.active ? 'Plan mode ON' : event.approved ? 'Plan approved' : 'Plan mode OFF',
          detail: event.path,
          tone: event.approved ? 'success' : event.active ? 'info' : 'neutral',
        },
      ];
    default:
      return steps;
  }
}

function appendThoughtDelta(step: ProcessStep, text: string): ProcessStep {
  if (!text) return step;
  return { ...step, detail: `${step.detail ?? ''}${text}`.slice(-6000) };
}

function completeThought(step: ProcessStep): ProcessStep {
  return {
    ...step,
    pending: false,
    durationSec: step.startedAtMs ? (Date.now() - step.startedAtMs) / 1000 : step.durationSec,
    startedAtMs: undefined,
    tone: 'success',
  };
}

function updateLast(
  steps: ProcessStep[],
  match: (step: ProcessStep) => boolean,
  update: (step: ProcessStep) => ProcessStep,
): ProcessStep[] {
  const index = findLastIndex(steps, match);
  return index < 0 ? steps : steps.map((step, i) => (i === index ? update(step) : step));
}

function updateById(steps: ProcessStep[], id: string, update: (step: ProcessStep) => ProcessStep): ProcessStep[] {
  return steps.map((step) => (step.id === id ? update(step) : step));
}

function upsertByKind(steps: ProcessStep[], kind: ProcessStep['kind'], next: ProcessStep): ProcessStep[] {
  const index = findLastIndex(steps, (step) => step.kind === kind);
  return index < 0 ? [...steps, next] : steps.map((step, i) => (i === index ? { ...step, ...next, id: step.id } : step));
}

function findLastIndex(steps: ProcessStep[], match: (step: ProcessStep) => boolean): number {
  for (let index = steps.length - 1; index >= 0; index -= 1) if (match(steps[index]!)) return index;
  return -1;
}

function toolLabel(tool: string): string {
  if (tool === 'write_file') return 'Write';
  if (tool === 'edit_file') return 'Edit';
  if (tool === 'shell_exec') return 'Bash';
  return tool.split('_').filter(Boolean).map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`).join(' ');
}

function toolStatus(tool: string, input: Record<string, unknown>): string {
  const key = tool === 'list_files' ? 'directory' : tool === 'web_search' ? 'query' : tool === 'web_fetch' ? 'url' : tool === 'shell_exec' ? 'command' : 'path';
  const detail = input[key];
  return `${toolLabel(tool)}${typeof detail === 'string' && detail.trim() ? `(${compact(detail)})` : ''}`;
}

function toolResultLabel(tool: string, input: Record<string, unknown> | undefined, content: string, isError?: boolean): string {
  const label = toolStatus(tool, input ?? {});
  if (isError) return `${label} failed`;
  if (tool === 'list_files') return `${label} · ${content ? content.split(/\r?\n/).length : 0} entries`;
  if (tool === 'web_search') {
    const count = content.match(/"count"\s*:\s*(\d+)/)?.[1];
    return `${label}${count ? ` · ${count} results` : ''}`;
  }
  return label;
}

function toolOutput(tool: string, content: string): string | undefined {
  if (!content || content === '(no output)') return undefined;
  if (tool === 'web_search') {
    try {
      const results = (JSON.parse(content) as { results?: Array<{ title?: string; url?: string }> }).results ?? [];
      return results.slice(0, 5).map((result) => compact([result.title, result.url].filter(Boolean).join(' — '))).join('\n') || undefined;
    } catch {
      return compact(content);
    }
  }
  const lines = content.split(/\r?\n/);
  const visible = lines.slice(0, 6).map((line) => compact(line));
  if (lines.length > 6) visible.push(`… +${lines.length - 6} lines`);
  return visible.join('\n');
}

function compact(value: string): string {
  const line = value.replace(/\s+/g, ' ').trim();
  return line.length > 72 ? `${line.slice(0, 72)}…` : line;
}

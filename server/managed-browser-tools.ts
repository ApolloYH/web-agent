import { randomUUID } from 'node:crypto';
import type { ToolDefinition } from '@apolloyh/apollo-agent';

export function createManagedBrowserTools(config?: { url: string; token: string; onSession?: (sessionId: string) => void }): ToolDefinition[] {
  if (!config?.url) return [];
  return [{
    name: 'browser_managed_task',
    description: '默认浏览器工具。在 Apollo 自托管的隔离浏览器中执行完整网页任务。除非用户要求使用自己的浏览器，或对话上下文明显表明当前正在继续用户浏览器任务，否则使用本工具；它不包含用户本地 Chrome 的登录状态。',
    risk: 'high',
    input_schema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: '托管浏览器要完成的完整任务，最长 10000 字符' },
        allowed_domains: { type: 'array', items: { type: 'string' }, description: '可选域名白名单，例如 ["*.github.com"]' },
        max_steps: { type: 'number', description: '最大步骤数，默认 30，最大 50' },
      },
      required: ['task'],
    },
    execute: async (input, context) => {
      if (typeof input.task !== 'string' || !input.task.trim() || input.task.length > 10_000) {
        return { content: '托管浏览器 task 无效或过长', isError: true };
      }
      const domains = Array.isArray(input.allowed_domains)
        ? input.allowed_domains.filter((value): value is string => typeof value === 'string').slice(0, 50)
        : [];
      const maxSteps = Number.isInteger(input.max_steps) ? Math.min(50, Math.max(1, Number(input.max_steps))) : 30;
      const sessionId = randomUUID();
      config.onSession?.(sessionId);
      try {
        const response = await fetch(new URL('/run', config.url), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}),
          },
          body: JSON.stringify({ task: input.task.trim(), allowed_domains: domains, max_steps: maxSteps, session_id: sessionId }),
          signal: context.signal,
        });
        const result = await response.json().catch(() => ({ error: `HTTP ${response.status}` })) as Record<string, unknown>;
        return { content: JSON.stringify(result, null, 2), isError: !response.ok || result.ok === false };
      } catch (error) {
        return { content: error instanceof Error ? error.message : String(error), isError: true };
      }
    },
  }];
}

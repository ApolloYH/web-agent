export type RunOwner = { userId: string };

export function agentRunKey(userId: string, channel: 'assistant' | 'entry', conversationId = ''): string {
  return channel === 'assistant' ? `${userId}:assistant` : `${userId}:entry:${conversationId}`;
}

export function capacityReason(
  runs: Iterable<RunOwner>,
  userId: string,
  maxGlobal: number,
  maxPerUser: number,
  auxiliaryJobs = 0,
  auxiliaryUserJobs = 0,
): 'global' | 'user' | null {
  let total = auxiliaryJobs;
  let userTotal = 0;
  for (const run of runs) {
    total += 1;
    if (run.userId === userId) userTotal += 1;
  }
  if (total >= maxGlobal) return 'global';
  if (userTotal + auxiliaryUserJobs >= maxPerUser) return 'user';
  return null;
}

export type RateLimitWindow = { count: number; resetAt: number };

export function consumeFixedWindow(
  windows: Map<string, RateLimitWindow>,
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now(),
): number {
  let window = windows.get(key);
  if (!window || window.resetAt <= now) {
    window = { count: 0, resetAt: now + windowMs };
    windows.set(key, window);
  }
  if (window.count >= limit) return Math.max(1, Math.ceil((window.resetAt - now) / 1000));
  window.count += 1;
  return 0;
}

export function pruneExpiredWindows(windows: Map<string, RateLimitWindow>, now = Date.now()): void {
  for (const [key, window] of windows) if (window.resetAt <= now) windows.delete(key);
}

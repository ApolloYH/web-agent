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
): 'global' | 'user' | null {
  let total = auxiliaryJobs;
  let userTotal = 0;
  for (const run of runs) {
    total += 1;
    if (run.userId === userId) userTotal += 1;
  }
  if (total >= maxGlobal) return 'global';
  if (userTotal >= maxPerUser) return 'user';
  return null;
}

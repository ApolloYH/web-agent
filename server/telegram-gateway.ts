export type TelegramChannelConfig = {
  enabled: boolean;
  token: string;
  allowedUserIds: string[];
  botUsername: string;
  offset: number;
};

type TelegramUpdate = {
  update_id: number;
  message?: {
    text?: string;
    chat?: { id?: number };
    from?: { id?: number };
  };
};

type TelegramResponse<T> = { ok: boolean; result?: T; description?: string };

export type TelegramGatewayStatus = {
  state: 'disconnected' | 'connecting' | 'connected' | 'error';
  error?: string;
};

export class TelegramGateway {
  private readonly channels = new Map<string, { controller: AbortController; status: TelegramGatewayStatus }>();

  constructor(
    private readonly onMessage: (userId: string, text: string) => Promise<string>,
    private readonly onOffset: (userId: string, offset: number) => Promise<void>,
  ) {}

  activate(userId: string, config: TelegramChannelConfig): void {
    this.deactivate(userId);
    if (!config.enabled) return;
    const controller = new AbortController();
    const channel = { controller, status: { state: 'connecting' } as TelegramGatewayStatus };
    this.channels.set(userId, channel);
    void this.poll(userId, config, channel);
  }

  deactivate(userId: string): void {
    this.channels.get(userId)?.controller.abort();
    this.channels.delete(userId);
  }

  status(userId: string): TelegramGatewayStatus {
    return this.channels.get(userId)?.status ?? { state: 'disconnected' };
  }

  close(): void {
    for (const channel of this.channels.values()) channel.controller.abort();
    this.channels.clear();
  }

  private async poll(
    userId: string,
    config: TelegramChannelConfig,
    channel: { controller: AbortController; status: TelegramGatewayStatus },
  ): Promise<void> {
    let offset = config.offset;
    while (!channel.controller.signal.aborted) {
      try {
        const updates = await telegramRequest<TelegramUpdate[]>(config.token, 'getUpdates', {
          offset,
          timeout: 25,
          allowed_updates: ['message'],
        }, channel.controller.signal);
        channel.status = { state: 'connected' };
        const nextOffset = updates.reduce((latest, update) => Math.max(latest, update.update_id + 1), offset);
        if (nextOffset !== offset) {
          offset = nextOffset;
          config.offset = offset;
          await this.onOffset(userId, offset);
        }
        for (const update of updates) {
          const message = update.message;
          const senderId = message?.from?.id?.toString();
          const chatId = message?.chat?.id;
          const text = message?.text?.trim();
          if (!senderId || !chatId || !text || !config.allowedUserIds.includes(senderId)) continue;
          await telegramRequest(config.token, 'sendChatAction', { chat_id: chatId, action: 'typing' }, channel.controller.signal).catch(() => undefined);
          let reply: string;
          try {
            reply = await this.onMessage(userId, text);
          } catch (error) {
            reply = error instanceof Error ? `Apollo 暂时无法处理：${error.message}` : 'Apollo 暂时无法处理这条消息';
          }
          for (const part of splitMessage(reply || '任务已完成。')) {
            await telegramRequest(config.token, 'sendMessage', { chat_id: chatId, text: part }, channel.controller.signal);
          }
        }
      } catch (error) {
        if (channel.controller.signal.aborted) return;
        channel.status = { state: 'error', error: readableError(error) };
        await delay(3_000, channel.controller.signal);
      }
    }
  }
}

export async function inspectTelegramBot(token: string, signal?: AbortSignal): Promise<{ username: string; name: string }> {
  const bot = await telegramRequest<{ username?: string; first_name?: string }>(token, 'getMe', {}, signal ?? AbortSignal.timeout(10_000));
  return { username: bot.username ?? '', name: bot.first_name ?? bot.username ?? 'Telegram Bot' };
}

async function telegramRequest<T = true>(token: string, method: string, body: object, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  const payload = await response.json().catch(() => null) as TelegramResponse<T> | null;
  if (!response.ok || !payload?.ok) throw new Error(payload?.description || `Telegram 请求失败 ${response.status}`);
  return payload.result as T;
}

function splitMessage(text: string): string[] {
  const parts: string[] = [];
  for (let start = 0; start < text.length; start += 4_000) parts.push(text.slice(start, start + 4_000));
  return parts.length ? parts : ['任务已完成。'];
}

function readableError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/bot\d+:[^/\s]+/g, 'bot***').slice(0, 240);
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

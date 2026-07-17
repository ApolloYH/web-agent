import { randomBytes, randomUUID } from 'node:crypto';
import * as Lark from '@larksuiteoapi/node-sdk';
import AiBot, { generateReqId, type TextMessage, type WsFrame } from '@wecom/aibot-node-sdk';
import { DWClient, TOPIC_ROBOT, type DWClientDownStream, type RobotTextMessage } from 'dingtalk-stream';
import QRCode from 'qrcode';

export type ImGatewayStatus = {
  state: 'disconnected' | 'connecting' | 'connected' | 'error';
  error?: string;
};

export type FeishuChannelConfig = {
  enabled: boolean;
  appId: string;
  appSecret: string;
  allowedUserIds: string[];
};

export type WecomChannelConfig = {
  enabled: boolean;
  botId: string;
  secret: string;
  allowedUserIds: string[];
};

export type DingtalkChannelConfig = {
  enabled: boolean;
  clientId: string;
  clientSecret: string;
  allowedUserIds: string[];
};

export type WeixinChannelConfig = {
  enabled: boolean;
  botToken: string;
  accountId: string;
  baseUrl: string;
  allowedUserIds: string[];
  getUpdatesBuf: string;
};

type MessageHandler = (userId: string, text: string) => Promise<string>;
type Channel<T> = { client: T; status: ImGatewayStatus };

export class FeishuGateway {
  private readonly channels = new Map<string, Channel<Lark.LarkChannel>>();

  constructor(private readonly onMessage: MessageHandler) {}

  activate(userId: string, config: FeishuChannelConfig): void {
    this.deactivate(userId);
    if (!config.enabled) return;
    const client = Lark.createLarkChannel({
      appId: config.appId,
      appSecret: config.appSecret,
      transport: 'websocket',
      policy: { dmMode: 'open', requireMention: true },
      source: 'apollo',
      handshakeTimeoutMs: 15_000,
    });
    const channel = { client, status: { state: 'connecting' } as ImGatewayStatus };
    this.channels.set(userId, channel);
    client.on('message', (message) => {
      if (!config.allowedUserIds.includes(message.senderId) || !message.content.trim()) return;
      void this.respond(userId, client, message.chatId, message.messageId, message.content.trim());
    });
    client.on('error', (error) => { channel.status = { state: 'error', error: readableError(error) }; });
    client.on('reconnecting', () => { channel.status = { state: 'connecting' }; });
    client.on('reconnected', () => { channel.status = { state: 'connected' }; });
    void client.connect()
      .then(() => { channel.status = { state: 'connected' }; })
      .catch((error) => { channel.status = { state: 'error', error: readableError(error) }; });
  }

  deactivate(userId: string): void {
    const channel = this.channels.get(userId);
    this.channels.delete(userId);
    if (channel) void channel.client.disconnect().catch(() => undefined);
  }

  status(userId: string): ImGatewayStatus {
    return this.channels.get(userId)?.status ?? { state: 'disconnected' };
  }

  close(): void {
    for (const userId of [...this.channels.keys()]) this.deactivate(userId);
  }

  private async respond(userId: string, client: Lark.LarkChannel, chatId: string, messageId: string, text: string): Promise<void> {
    const reply = await safeReply(() => this.onMessage(userId, text));
    for (const part of splitMessage(reply, 10_000)) {
      await client.send(chatId, { markdown: part }, { replyTo: messageId });
    }
  }
}

export class WecomGateway {
  private readonly channels = new Map<string, Channel<InstanceType<typeof AiBot.WSClient>>>();

  constructor(private readonly onMessage: MessageHandler) {}

  activate(userId: string, config: WecomChannelConfig): void {
    this.deactivate(userId);
    if (!config.enabled) return;
    const client = new AiBot.WSClient({ botId: config.botId, secret: config.secret });
    const channel = { client, status: { state: 'connecting' } as ImGatewayStatus };
    this.channels.set(userId, channel);
    client.on('authenticated', () => { channel.status = { state: 'connected' }; });
    client.on('reconnecting', () => { channel.status = { state: 'connecting' }; });
    client.on('disconnected', (reason) => { channel.status = { state: 'error', error: reason.slice(0, 240) }; });
    client.on('error', (error) => { channel.status = { state: 'error', error: readableError(error) }; });
    client.on('message.text', (frame: WsFrame<TextMessage>) => {
      const senderId = frame.body?.from.userid;
      const text = frame.body?.text.content.trim();
      if (!senderId || !text || !config.allowedUserIds.includes(senderId)) return;
      void this.respond(userId, client, frame, text);
    });
    client.connect();
  }

  deactivate(userId: string): void {
    this.channels.get(userId)?.client.disconnect();
    this.channels.delete(userId);
  }

  status(userId: string): ImGatewayStatus {
    return this.channels.get(userId)?.status ?? { state: 'disconnected' };
  }

  close(): void {
    for (const userId of [...this.channels.keys()]) this.deactivate(userId);
  }

  private async respond(userId: string, client: InstanceType<typeof AiBot.WSClient>, frame: WsFrame<TextMessage>, text: string): Promise<void> {
    const streamId = generateReqId('apollo');
    await client.replyStream(frame, streamId, 'Apollo 正在处理…', false).catch(() => undefined);
    const reply = await safeReply(() => this.onMessage(userId, text));
    await client.replyStream(frame, streamId, reply.slice(0, 20_000), true);
  }
}

export class DingtalkGateway {
  private readonly channels = new Map<string, Channel<DWClient>>();

  constructor(private readonly onMessage: MessageHandler) {}

  activate(userId: string, config: DingtalkChannelConfig): void {
    this.deactivate(userId);
    if (!config.enabled) return;
    const client = new DWClient({ clientId: config.clientId, clientSecret: config.clientSecret, keepAlive: true });
    const channel = { client, status: { state: 'connecting' } as ImGatewayStatus };
    this.channels.set(userId, channel);
    client.registerCallbackListener(TOPIC_ROBOT, (event) => {
      client.socketCallBackResponse(event.headers.messageId, { status: 'SUCCESS' });
      const message = parseDingtalkMessage(event);
      if (!message || !config.allowedUserIds.includes(message.senderStaffId)) return;
      void this.respond(userId, message);
    });
    void client.connect()
      .then(() => { channel.status = client.connected ? { state: 'connected' } : { state: 'error', error: '钉钉长连接建立失败' }; })
      .catch((error) => { channel.status = { state: 'error', error: readableError(error) }; });
  }

  deactivate(userId: string): void {
    this.channels.get(userId)?.client.disconnect();
    this.channels.delete(userId);
  }

  status(userId: string): ImGatewayStatus {
    const channel = this.channels.get(userId);
    if (channel?.client.connected && channel.status.state !== 'connected') channel.status = { state: 'connected' };
    return channel?.status ?? { state: 'disconnected' };
  }

  close(): void {
    for (const userId of [...this.channels.keys()]) this.deactivate(userId);
  }

  private async respond(userId: string, message: RobotTextMessage): Promise<void> {
    const reply = await safeReply(() => this.onMessage(userId, message.text.content.trim()));
    for (const part of splitMessage(reply, 10_000)) {
      const response = await fetch(message.sessionWebhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ msgtype: 'text', text: { content: part } }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`钉钉回复失败 ${response.status}`);
    }
  }
}

type WeixinMessage = {
  message_id?: number;
  from_user_id?: string;
  message_type?: number;
  context_token?: string;
  item_list?: Array<{ type?: number; text_item?: { text?: string } }>;
};

type WeixinUpdates = {
  ret?: number;
  errcode?: number;
  errmsg?: string;
  msgs?: WeixinMessage[];
  get_updates_buf?: string;
};

type WeixinLogin = {
  qrcode: string;
  qrcodeUrl: string;
  qrDataUrl: string;
  baseUrl: string;
  startedAt: number;
  status: string;
  verifyCode?: string;
};

export type WeixinLoginResult = {
  status: string;
  qrDataUrl?: string;
  message: string;
  credentials?: { botToken: string; accountId: string; baseUrl: string; userId: string };
};

const WEIXIN_BASE_URL = 'https://ilinkai.weixin.qq.com';
const WEIXIN_HEADERS = { 'iLink-App-Id': 'bot', 'iLink-App-ClientVersion': '132102' };
const WEIXIN_BASE_INFO = { channel_version: '2.4.6', bot_agent: 'Apollo/0.1.0' };

export class WeixinGateway {
  private readonly channels = new Map<string, { controller: AbortController; status: ImGatewayStatus; seen: Set<number> }>();
  private readonly logins = new Map<string, WeixinLogin>();

  constructor(
    private readonly onMessage: MessageHandler,
    private readonly onBuffer: (userId: string, buffer: string) => Promise<void>,
  ) {}

  activate(userId: string, config: WeixinChannelConfig): void {
    this.deactivate(userId);
    if (!config.enabled) return;
    const channel = { controller: new AbortController(), status: { state: 'connecting' } as ImGatewayStatus, seen: new Set<number>() };
    this.channels.set(userId, channel);
    void this.poll(userId, config, channel);
  }

  deactivate(userId: string): void {
    this.channels.get(userId)?.controller.abort();
    this.channels.delete(userId);
  }

  status(userId: string): ImGatewayStatus {
    return this.channels.get(userId)?.status ?? { state: 'disconnected' };
  }

  close(): void {
    for (const userId of [...this.channels.keys()]) this.deactivate(userId);
    this.logins.clear();
  }

  async startLogin(userId: string, localTokens: string[]): Promise<WeixinLoginResult> {
    const payload = await weixinRequest<{ qrcode: string; qrcode_img_content: string }>(
      WEIXIN_BASE_URL,
      'ilink/bot/get_bot_qrcode?bot_type=3',
      { local_token_list: localTokens.slice(-10) },
    );
    if (!payload.qrcode || !payload.qrcode_img_content) throw new Error('微信没有返回登录二维码');
    const login: WeixinLogin = {
      qrcode: payload.qrcode,
      qrcodeUrl: payload.qrcode_img_content,
      qrDataUrl: await QRCode.toDataURL(payload.qrcode_img_content, { width: 256, margin: 1, errorCorrectionLevel: 'M' }),
      baseUrl: WEIXIN_BASE_URL,
      startedAt: Date.now(),
      status: 'wait',
    };
    this.logins.set(userId, login);
    return { status: login.status, qrDataUrl: login.qrDataUrl, message: '请用手机微信扫码并确认连接' };
  }

  submitVerifyCode(userId: string, code: string): void {
    const login = this.logins.get(userId);
    if (!login) throw new Error('微信登录已失效，请重新获取二维码');
    if (!/^\d{4,8}$/.test(code)) throw new Error('配对码应为 4–8 位数字');
    login.verifyCode = code;
  }

  async pollLogin(userId: string): Promise<WeixinLoginResult> {
    const login = this.logins.get(userId);
    if (!login || Date.now() - login.startedAt > 5 * 60_000) {
      this.logins.delete(userId);
      return { status: 'expired', message: '二维码已过期，请重新获取' };
    }
    let endpoint = `ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(login.qrcode)}`;
    if (login.verifyCode) endpoint += `&verify_code=${encodeURIComponent(login.verifyCode)}`;
    let result: {
      status: string;
      bot_token?: string;
      ilink_bot_id?: string;
      ilink_user_id?: string;
      baseurl?: string;
      redirect_host?: string;
    };
    try {
      result = await weixinGet(login.baseUrl, endpoint, 38_000);
    } catch (error) {
      if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
        return { status: login.status, qrDataUrl: login.qrDataUrl, message: '等待扫码' };
      }
      throw error;
    }
    login.status = result.status;
    if (result.status === 'scaned_but_redirect' && result.redirect_host) login.baseUrl = `https://${result.redirect_host}`;
    if (result.status === 'confirmed') {
      this.logins.delete(userId);
      if (!result.bot_token || !result.ilink_bot_id || !result.ilink_user_id) throw new Error('微信登录成功，但没有返回完整凭据');
      return {
        status: 'confirmed',
        message: '微信已连接',
        credentials: {
          botToken: result.bot_token,
          accountId: result.ilink_bot_id,
          userId: result.ilink_user_id,
          baseUrl: trustedWeixinBaseUrl(result.baseurl || login.baseUrl),
        },
      };
    }
    const messages: Record<string, string> = {
      wait: '等待扫码',
      scaned: '已扫码，请在手机微信确认',
      need_verifycode: '请输入手机微信显示的配对码',
      verify_code_blocked: '配对码错误次数过多，请重新获取二维码',
      expired: '二维码已过期，请重新获取',
      binded_redirect: '该微信已连接到当前机器人',
    };
    if (result.status === 'expired' || result.status === 'verify_code_blocked') this.logins.delete(userId);
    return { status: result.status, qrDataUrl: login.qrDataUrl, message: messages[result.status] ?? '正在连接微信' };
  }

  private async poll(
    userId: string,
    config: WeixinChannelConfig,
    channel: { controller: AbortController; status: ImGatewayStatus; seen: Set<number> },
  ): Promise<void> {
    let buffer = config.getUpdatesBuf;
    while (!channel.controller.signal.aborted) {
      try {
        const updates = await weixinRequest<WeixinUpdates>(config.baseUrl || WEIXIN_BASE_URL, 'ilink/bot/getupdates', {
          get_updates_buf: buffer,
          base_info: WEIXIN_BASE_INFO,
        }, config.botToken, channel.controller.signal, 40_000);
        if (updates.ret && updates.ret !== 0) throw new Error(updates.errmsg || `微信 getupdates 返回 ${updates.ret}`);
        channel.status = { state: 'connected' };
        if (typeof updates.get_updates_buf === 'string' && updates.get_updates_buf !== buffer) {
          buffer = updates.get_updates_buf;
          await this.onBuffer(userId, buffer);
        }
        for (const message of updates.msgs ?? []) {
          const messageId = message.message_id;
          const senderId = message.from_user_id;
          const text = message.item_list?.find((item) => item.type === 1)?.text_item?.text?.trim();
          if (!messageId || channel.seen.has(messageId) || message.message_type !== 1 || !senderId || !text || !config.allowedUserIds.includes(senderId)) continue;
          channel.seen.add(messageId);
          if (channel.seen.size > 500) channel.seen.delete(channel.seen.values().next().value!);
          const reply = await safeReply(() => this.onMessage(userId, text));
          await weixinRequest(config.baseUrl || WEIXIN_BASE_URL, 'ilink/bot/sendmessage', {
            msg: {
              from_user_id: '',
              to_user_id: senderId,
              client_id: `apollo-${randomUUID()}`,
              message_type: 2,
              message_state: 2,
              item_list: [{ type: 1, text_item: { text: reply.slice(0, 20_000) } }],
              context_token: message.context_token,
            },
            base_info: WEIXIN_BASE_INFO,
          }, config.botToken, channel.controller.signal, 15_000);
        }
      } catch (error) {
        if (channel.controller.signal.aborted) return;
        channel.status = { state: 'error', error: readableError(error) };
        await delay(3_000, channel.controller.signal);
      }
    }
  }
}

function parseDingtalkMessage(event: DWClientDownStream): RobotTextMessage | null {
  try {
    const message = JSON.parse(event.data) as RobotTextMessage;
    return message.msgtype === 'text' && message.senderStaffId && message.text?.content.trim() ? message : null;
  } catch {
    return null;
  }
}

async function safeReply(run: () => Promise<string>): Promise<string> {
  try {
    return (await run()).trim() || '任务已完成。';
  } catch (error) {
    return error instanceof Error ? `Apollo 暂时无法处理：${error.message}` : 'Apollo 暂时无法处理这条消息';
  }
}

function splitMessage(text: string, size: number): string[] {
  const result: string[] = [];
  for (let start = 0; start < text.length; start += size) result.push(text.slice(start, start + size));
  return result.length ? result : ['任务已完成。'];
}

function readableError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 240);
}

function randomWechatUin(): string {
  return Buffer.from(String(randomBytes(4).readUInt32BE(0)), 'utf8').toString('base64');
}

function trustedWeixinBaseUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'https:' || (url.hostname !== 'weixin.qq.com' && !url.hostname.endsWith('.weixin.qq.com'))) {
    throw new Error('微信返回了不受信任的服务地址');
  }
  return url.origin;
}

async function weixinGet<T>(baseUrl: string, endpoint: string, timeoutMs: number): Promise<T> {
  const response = await fetch(new URL(endpoint, `${baseUrl.replace(/\/$/, '')}/`), {
    headers: WEIXIN_HEADERS,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`微信请求失败 ${response.status}`);
  return JSON.parse(text) as T;
}

async function weixinRequest<T = object>(
  baseUrl: string,
  endpoint: string,
  body: object,
  token = '',
  signal?: AbortSignal,
  timeoutMs = 20_000,
): Promise<T> {
  const response = await fetch(new URL(endpoint, `${baseUrl.replace(/\/$/, '')}/`), {
    method: 'POST',
    headers: {
      ...WEIXIN_HEADERS,
      'Content-Type': 'application/json',
      AuthorizationType: 'ilink_bot_token',
      'X-WECHAT-UIN': randomWechatUin(),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`微信请求失败 ${response.status}`);
  return JSON.parse(text) as T;
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
  });
}

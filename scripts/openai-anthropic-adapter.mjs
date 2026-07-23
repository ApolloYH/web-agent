const MAX_BODY_BYTES = 5 * 1024 * 1024;

function textContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) throw new Error('message content must be text');
  return content.map((part) => {
    if (part?.type !== 'text' || typeof part.text !== 'string') throw new Error('only text message content is supported');
    return part.text;
  }).join('');
}

export function toAnthropicRequest(body, defaultModel = 'glm-5.2', defaultMaxTokens = 8192) {
  if (!body || !Array.isArray(body.messages)) throw new Error('messages must be an array');
  if (body.stream) throw new Error('streaming is not supported');
  if (body.tools?.length || body.tool_choice) throw new Error('tools are not supported');

  const system = [];
  const messages = [];
  for (const message of body.messages) {
    if (!message || typeof message.role !== 'string') throw new Error('invalid message');
    const content = textContent(message.content);
    if (message.role === 'system' || message.role === 'developer') system.push(content);
    else if (message.role === 'user' || message.role === 'assistant') messages.push({ role: message.role, content });
    else throw new Error(`unsupported message role: ${message.role}`);
  }
  if (!messages.length) throw new Error('at least one user or assistant message is required');

  const request = {
    model: typeof body.model === 'string' && body.model ? body.model : defaultModel,
    max_tokens: Number.isInteger(body.max_tokens) && body.max_tokens > 0 ? body.max_tokens : defaultMaxTokens,
    messages,
  };
  if (system.length) request.system = system.join('\n\n');
  if (typeof body.temperature === 'number') request.temperature = body.temperature;
  if (typeof body.top_p === 'number') request.top_p = body.top_p;
  if (typeof body.stop === 'string') request.stop_sequences = [body.stop];
  else if (Array.isArray(body.stop)) request.stop_sequences = body.stop;
  return request;
}

export function toOpenAiResponse(body, fallbackModel = 'glm-5.2') {
  const content = Array.isArray(body?.content)
    ? body.content.filter((part) => part?.type === 'text').map((part) => part.text || '').join('')
    : '';
  const input = Number(body?.usage?.input_tokens || 0);
  const output = Number(body?.usage?.output_tokens || 0);
  return {
    id: body?.id || `chatcmpl-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: body?.model || fallbackModel,
    choices: [{
      index: 0,
      message: { role: 'assistant', content },
      finish_reason: body?.stop_reason === 'max_tokens' ? 'length' : 'stop',
    }],
    usage: { prompt_tokens: input, completion_tokens: output, total_tokens: input + output },
  };
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function error(res, status, message, type = 'invalid_request_error', code = null) {
  json(res, status, { error: { message, type, code } });
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error('request body exceeds 5 MiB'), { status: 413 });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw Object.assign(new Error('invalid JSON body'), { status: 400 });
  }
}

export async function handleAnthropicChat(req, res, options = {}) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return error(res, 405, 'method not allowed');
  }
  const token = options.token || process.env.ANTHROPIC_AUTH_TOKEN;
  if (!token) return error(res, 500, 'ANTHROPIC_AUTH_TOKEN is not configured', 'configuration_error');

  let requestBody;
  try {
    requestBody = toAnthropicRequest(
      await readJson(req),
      options.model || process.env.ANTHROPIC_MODEL || 'glm-5.2',
      Number(options.maxTokens || process.env.ANTHROPIC_MAX_TOKENS || 8192),
    );
  } catch (cause) {
    return error(res, cause.status || 400, cause.message);
  }

  const baseUrl = (options.baseUrl || process.env.ANTHROPIC_BASE_URL || 'https://open.bigmodel.cn/api/anthropic').replace(/\/$/, '');
  let upstream;
  try {
    upstream = await (options.fetch || fetch)(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(300_000),
    });
  } catch (cause) {
    return error(res, 502, `Anthropic upstream request failed: ${cause.message}`, 'upstream_error');
  }

  let responseBody;
  try { responseBody = await upstream.json(); } catch { responseBody = null; }
  if (!upstream.ok) {
    const message = responseBody?.error?.message || responseBody?.message || `Anthropic upstream returned HTTP ${upstream.status}`;
    return error(res, upstream.status, message, 'upstream_error', responseBody?.error?.type || responseBody?.code || null);
  }
  return json(res, 200, toOpenAiResponse(responseBody, requestBody.model));
}

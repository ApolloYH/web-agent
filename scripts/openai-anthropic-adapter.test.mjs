import assert from 'node:assert/strict';
import test from 'node:test';
import { Readable } from 'node:stream';
import { handleAnthropicChat, toAnthropicRequest, toOpenAiResponse } from './openai-anthropic-adapter.mjs';

test('converts OpenAI messages and options to Anthropic', () => {
  assert.deepEqual(toAnthropicRequest({
    model: 'glm-5.2', max_tokens: 123, temperature: 0.2, stop: ['END'], response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: 'rules' },
      { role: 'developer', content: 'format' },
      { role: 'user', content: [{ type: 'text', text: 'question' }] },
      { role: 'assistant', content: 'answer' },
    ],
  }), {
    model: 'glm-5.2', max_tokens: 123, temperature: 0.2, stop_sequences: ['END'],
    system: 'rules\n\nformat',
    messages: [{ role: 'user', content: 'question' }, { role: 'assistant', content: 'answer' }],
  });
  assert.throws(() => toAnthropicRequest({ messages: [{ role: 'user', content: 'x' }], stream: true }), /streaming/);
  assert.throws(() => toAnthropicRequest({ messages: [{ role: 'user', content: 'x' }], tools: [{}] }), /tools/);
});

test('converts Anthropic response to OpenAI shape', () => {
  const result = toOpenAiResponse({
    id: 'msg_1', model: 'glm-5.2', stop_reason: 'max_tokens',
    content: [{ type: 'thinking', thinking: 'hidden' }, { type: 'text', text: 'result' }],
    usage: { input_tokens: 10, output_tokens: 4 },
  });
  assert.equal(result.choices[0].message.content, 'result');
  assert.equal(result.choices[0].finish_reason, 'length');
  assert.deepEqual(result.usage, { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 });
});

test('uses configured token instead of caller authorization', async () => {
  const req = Readable.from([Buffer.from(JSON.stringify({ model: 'glm-5.2', messages: [{ role: 'user', content: 'hi' }] }))]);
  req.method = 'POST';
  req.headers = { authorization: 'Bearer caller-secret' };
  const output = { status: 0, headers: {}, body: '' };
  const res = {
    setHeader(name, value) { output.headers[name] = value; },
    writeHead(status, headers) { output.status = status; Object.assign(output.headers, headers); },
    end(body = '') { output.body = body; },
  };
  const fakeFetch = async (_url, init) => {
    assert.equal(init.headers.Authorization, 'Bearer configured-secret');
    assert.doesNotMatch(JSON.stringify(init), /caller-secret/);
    return new Response(JSON.stringify({ id: 'msg_2', model: 'glm-5.2', content: [{ type: 'text', text: 'ok' }], usage: {} }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  };
  await handleAnthropicChat(req, res, { token: 'configured-secret', fetch: fakeFetch });
  assert.equal(output.status, 200);
  assert.equal(JSON.parse(output.body).choices[0].message.content, 'ok');
});

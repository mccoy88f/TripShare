import { describe, expect, it } from 'vitest';
import { failoverPause } from '../src/ai/access.js';
import { AiError, complete } from '../src/ai/client.js';
import { parseGroqModels } from '../src/groq.js';

const URL = 'https://api.groq.com/openai/v1/chat/completions';
const base = {
  provider: 'groq' as const,
  apiKey: 'gsk_test_key_1234',
  model: 'llama-3.3-70b-versatile',
  messages: [{ role: 'user' as const, content: 'Rispondi in JSON' }],
  appUrl: 'https://trip.example.com',
  appName: 'TripShare',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const ok = (content: string, model = 'llama-3.3-70b-versatile') =>
  json({
    model,
    choices: [{ message: { content } }],
    usage: { prompt_tokens: 10, completion_tokens: 4 },
  });

describe('Groq', () => {
  it('sends an OpenAI-style request with JSON mode and reads the answer', async () => {
    let seen: { url: string; auth: string | null; body: Record<string, unknown> } | null = null;
    const res = await complete({
      ...base,
      jsonSchema: { name: 'x', schema: { type: 'object' } },
      web: true,
      fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
        seen = {
          url: String(url),
          auth: new Headers(init?.headers).get('authorization'),
          body: JSON.parse(String(init?.body)),
        };
        return ok('{"ok":true}');
      }) as typeof fetch,
    });
    expect(seen).toMatchObject({ url: URL, auth: 'Bearer gsk_test_key_1234' });
    expect(seen!.body).toMatchObject({
      model: 'llama-3.3-70b-versatile',
      response_format: { type: 'json_object' },
    });
    expect(seen!.body).not.toHaveProperty('plugins');
    expect(res).toEqual({
      content: '{"ok":true}',
      model: 'llama-3.3-70b-versatile',
      promptTokens: 10,
      completionTokens: 4,
      cost: null,
    });
  });

  it('tries the backup model when the main one is rate limited', async () => {
    const asked: string[] = [];
    const res = await complete({
      ...base,
      fallbacks: ['llama-3.1-8b-instant'],
      fetchImpl: (async (_url: string | URL | Request, init?: RequestInit) => {
        const model = JSON.parse(String(init?.body)).model as string;
        asked.push(model);
        return model === 'llama-3.3-70b-versatile'
          ? json({ error: { message: 'Rate limit reached' } }, 429)
          : ok('{}', model);
      }) as typeof fetch,
    });
    expect(asked).toEqual(['llama-3.3-70b-versatile', 'llama-3.1-8b-instant']);
    expect(res.model).toBe('llama-3.1-8b-instant');
  });

  it('does not try other models with an invalid key, and maps the errors', async () => {
    let calls = 0;
    const bad = complete({
      ...base,
      fallbacks: ['llama-3.1-8b-instant'],
      fetchImpl: (async () => {
        calls++;
        return json({ error: { message: 'Invalid API Key' } }, 401);
      }) as typeof fetch,
    });
    await expect(bad).rejects.toThrow(/^AI_INVALID_KEY/);
    expect(calls).toBe(1);

    const limited = complete({
      ...base,
      fetchImpl: (async () => json({ error: { message: 'slow down' } }, 429)) as typeof fetch,
    });
    await expect(limited).rejects.toMatchObject({ status: 429 });
    await expect(limited).rejects.toThrow(/^AI_RATE_LIMITED/);
  });

  it('refuses PDFs, so the router can move to another configuration', async () => {
    let calls = 0;
    const pdf = complete({
      ...base,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'file',
              file: { filename: 'a.pdf', file_data: 'data:application/pdf;base64,AAA' },
            },
          ],
        },
      ],
      fetchImpl: (async () => {
        calls++;
        return ok('{}');
      }) as typeof fetch,
    });
    await expect(pdf).rejects.toThrow(/^AI_UNSUPPORTED_INPUT/);
    expect(calls).toBe(0);
    expect(failoverPause(new AiError('AI_UNSUPPORTED_INPUT: x'))).toBe(0);
    expect(failoverPause(new AiError('AI_PROVIDER_ERROR', 413))).toBe(0);
    expect(failoverPause(new AiError('AI_PROVIDER_ERROR', 400))).toBeNull();
  });

  it('streams the answer and reads the usage from x_groq', async () => {
    const sse = [
      { choices: [{ delta: { content: '{"re' } }] },
      { choices: [{ delta: { content: 'ply":"ciao"}' } }] },
      { choices: [{ delta: {} }], x_groq: { usage: { prompt_tokens: 7, completion_tokens: 3 } } },
    ]
      .map((c) => `data: ${JSON.stringify(c)}\n\n`)
      .join('')
      .concat('data: [DONE]\n\n');
    const seen: string[] = [];
    const res = await complete({
      ...base,
      onDelta: (t) => seen.push(t),
      fetchImpl: (async () =>
        new Response(sse, { headers: { 'content-type': 'text/event-stream' } })) as typeof fetch,
    });
    expect(seen).toEqual(['{"re', '{"reply":"ciao"}']);
    expect(res).toMatchObject({
      content: '{"reply":"ciao"}',
      promptTokens: 7,
      completionTokens: 3,
    });
  });

  it('lists only text models', () => {
    const models = parseGroqModels({
      data: [
        { id: 'llama-3.3-70b-versatile', context_window: 131072, active: true },
        { id: 'meta-llama/llama-4-scout-17b-16e-instruct', context_window: 131072 },
        { id: 'whisper-large-v3' },
        { id: 'meta-llama/llama-guard-4-12b' },
        { id: 'old-model', active: false },
      ],
    });
    expect(models.map((m) => m.id)).toEqual([
      'llama-3.3-70b-versatile',
      'meta-llama/llama-4-scout-17b-16e-instruct',
    ]);
    expect(models.find((m) => m.id.includes('llama-4'))!.imageInput).toBe(true);
    expect(models[0]!.imageInput).toBe(false);
  });
});

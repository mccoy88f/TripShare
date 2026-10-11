import { describe, expect, it } from 'vitest';
import { complete } from '../src/ai/client.js';
import { listLlm7Models, parseLlm7Models } from '../src/llm7.js';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('LLM7', () => {
  it('uses the OpenAI-style endpoint without forcing a JSON mode', async () => {
    let seen: { url: string; auth: string | null; body: Record<string, unknown> } | null = null;
    const res = await complete({
      provider: 'llm7',
      apiKey: 'unused',
      model: 'gpt-4.1-nano-2025-04-14',
      messages: [{ role: 'user', content: 'Rispondi in JSON' }],
      jsonSchema: { name: 'x', schema: { type: 'object' } },
      appUrl: 'https://trip.example.com',
      appName: 'TripShare',
      fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
        seen = {
          url: String(url),
          auth: new Headers(init?.headers).get('authorization'),
          body: JSON.parse(String(init?.body)),
        };
        return json({
          model: 'gpt-4.1-nano-2025-04-14',
          choices: [{ message: { content: '{"ok":true}' } }],
          usage: { prompt_tokens: 5, completion_tokens: 2 },
        });
      }) as typeof fetch,
    });
    expect(seen).toMatchObject({
      url: 'https://api.llm7.io/v1/chat/completions',
      auth: 'Bearer unused',
    });
    expect(seen!.body).not.toHaveProperty('response_format');
    expect(res).toMatchObject({ content: '{"ok":true}', promptTokens: 5, cost: null });
  });

  it('reads error messages given as plain text', async () => {
    await expect(
      complete({
        provider: 'llm7',
        apiKey: 'unused',
        model: 'm',
        messages: [{ role: 'user', content: 'x' }],
        appUrl: 'u',
        appName: 'a',
        fetchImpl: (async () => json({ error: 'Too many requests' }, 429)) as typeof fetch,
      }),
    ).rejects.toThrow('AI_RATE_LIMITED: Too many requests');
  });

  it('lists text models from an array or from { data }', async () => {
    const asArray = parseLlm7Models([
      { id: 'gpt-4.1-nano-2025-04-14', context_length: 128000 },
      'mistral-small-3.1-24b',
      { id: 'flux-schnell' },
      { id: 'whisper-large' },
    ]);
    expect(asArray.map((m) => m.id)).toEqual(['gpt-4.1-nano-2025-04-14', 'mistral-small-3.1-24b']);
    expect(asArray[0]).toMatchObject({ contextLength: 128000, free: true, imageInput: true });
    expect(parseLlm7Models({ data: [{ id: 'deepseek-r1' }] })).toHaveLength(1);
    expect(() => parseLlm7Models({})).toThrow('LLM7_BAD_RESPONSE');

    let auth: string | null = null;
    const out = await listLlm7Models(
      null,
      (async (_url: string | URL | Request, init?: RequestInit) => {
        auth = new Headers(init?.headers).get('authorization');
        return json({ data: [{ id: 'deepseek-r1' }] });
      }) as typeof fetch,
      true,
    );
    expect(auth).toBe('Bearer unused');
    expect(out.models).toHaveLength(1);
  });
});

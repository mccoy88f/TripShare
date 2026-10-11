import { describe, expect, it } from 'vitest';
import { complete } from '../src/ai/client.js';
import { listNvidiaModels, parseNvidiaModels } from '../src/nvidia.js';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('NVIDIA NIM', () => {
  it('calls the OpenAI-style endpoint with the nvapi key', async () => {
    let seen: { url: string; auth: string | null; body: Record<string, unknown> } | null = null;
    const res = await complete({
      provider: 'nvidia',
      apiKey: 'nvapi-test-key-1234',
      model: 'meta/llama-3.3-70b-instruct',
      fallbacks: ['meta/llama-3.1-8b-instruct'],
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
          model: 'meta/llama-3.3-70b-instruct',
          choices: [{ message: { content: '{"ok":true}' } }],
          usage: { prompt_tokens: 8, completion_tokens: 3 },
        });
      }) as typeof fetch,
    });
    expect(seen).toMatchObject({
      url: 'https://integrate.api.nvidia.com/v1/chat/completions',
      auth: 'Bearer nvapi-test-key-1234',
    });
    expect(seen!.body).toMatchObject({ model: 'meta/llama-3.3-70b-instruct' });
    expect(seen!.body).not.toHaveProperty('response_format');
    expect(res).toMatchObject({ content: '{"ok":true}', promptTokens: 8, completionTokens: 3 });
  });

  it('lists only text models and recognises vision ones', async () => {
    const models = parseNvidiaModels({
      data: [
        { id: 'meta/llama-3.3-70b-instruct' },
        { id: 'meta/llama-3.2-90b-vision-instruct' },
        { id: 'nvidia/nv-embedqa-e5-v5' },
        { id: 'nvidia/llama-3.2-nv-rerankqa-1b-v2' },
        { id: 'nvidia/llama-3.1-nemoguard-8b-content-safety' },
      ],
    });
    expect(models.map((m) => m.id)).toEqual([
      'meta/llama-3.2-90b-vision-instruct',
      'meta/llama-3.3-70b-instruct',
    ]);
    expect(models[0]!.imageInput).toBe(true);
    expect(models[1]!.imageInput).toBe(false);
    expect(() => parseNvidiaModels({})).toThrow('NVIDIA_BAD_RESPONSE');
  });

  it('reports an invalid key when listing models', async () => {
    await expect(
      listNvidiaModels('nvapi-bad-key-0000', (async () => json({}, 401)) as typeof fetch, true),
    ).rejects.toThrow('NVIDIA_INVALID_KEY');
  });
});

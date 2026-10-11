import { describe, expect, it } from 'vitest';
import { complete } from '../src/ai/client.js';
import { replyFromPartialJson, throttleText } from '../src/ai/stream.js';

describe('replyFromPartialJson', () => {
  it('non restituisce nulla finché "reply" non compare', () => {
    expect(replyFromPartialJson('{"act')).toBeNull();
    expect(replyFromPartialJson('{"actions":[],')).toBeNull();
  });

  it('segue il testo man mano che arriva', () => {
    expect(replyFromPartialJson('{"reply":"Cia')).toBe('Cia');
    expect(replyFromPartialJson('{"reply": "Ciao a tutti')).toBe('Ciao a tutti');
    expect(replyFromPartialJson('{"reply":"Ciao","actions":[]}')).toBe('Ciao');
  });

  it('decodifica gli a capo, le virgolette e gli accenti', () => {
    expect(replyFromPartialJson('{"reply":"Riga 1\\nRiga \\"2\\" \\u00e8 ok"}')).toBe(
      'Riga 1\nRiga "2" è ok',
    );
  });

  it('aspetta le sequenze di escape incomplete', () => {
    expect(replyFromPartialJson('{"reply":"Ciao\\')).toBe('Ciao');
    expect(replyFromPartialJson('{"reply":"Ciao\\u00')).toBe('Ciao');
  });

  it('funziona anche se "reply" non è la prima chiave', () => {
    expect(replyFromPartialJson('{"actions":[],"reply":"Eccomi')).toBe('Eccomi');
  });
});

describe('throttleText', () => {
  it('passa il primo testo e salta quelli troppo ravvicinati', () => {
    const seen: string[] = [];
    const emit = throttleText((t) => seen.push(t), 10_000);
    emit('a');
    emit('ab');
    emit('abc');
    expect(seen).toEqual(['a']);
  });
});

const sse = (chunks: string[]) =>
  new Response(
    new ReadableStream({
      start(controller) {
        const enc = new TextEncoder();
        // Un evento spezzato a metà tra due letture, come succede in rete.
        const all = chunks.map((c) => `data: ${c}\n\n`).join('');
        controller.enqueue(enc.encode(all.slice(0, 25)));
        controller.enqueue(enc.encode(all.slice(25)));
        controller.close();
      },
    }),
    { headers: { 'content-type': 'text/event-stream' } },
  );

const base = {
  apiKey: 'k',
  model: 'm',
  messages: [{ role: 'user' as const, content: 'ciao' }],
  appUrl: 'http://localhost',
  appName: 'TripShare',
};

describe('complete() in streaming', () => {
  it('OpenRouter: legge i pezzi, il modello e i consumi', async () => {
    const seen: string[] = [];
    let body: Record<string, unknown> = {};
    const res = await complete({
      ...base,
      onDelta: (t) => seen.push(t),
      fetchImpl: (async (_url: string, init?: RequestInit) => {
        body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return sse([
          JSON.stringify({ model: 'x/y', choices: [{ delta: { content: '{"reply":"Ci' } }] }),
          JSON.stringify({ choices: [{ delta: { content: 'ao"}' } }] }),
          JSON.stringify({
            choices: [],
            usage: { prompt_tokens: 5, completion_tokens: 7, cost: 0.1 },
          }),
          '[DONE]',
        ]);
      }) as unknown as typeof fetch,
    });
    expect(body.stream).toBe(true);
    expect(seen).toEqual(['{"reply":"Ci', '{"reply":"Ciao"}']);
    expect(res).toMatchObject({
      content: '{"reply":"Ciao"}',
      model: 'x/y',
      promptTokens: 5,
      completionTokens: 7,
      cost: 0.1,
    });
  });

  it('OpenRouter: un errore a metà flusso diventa un errore AI', async () => {
    await expect(
      complete({
        ...base,
        onDelta: () => undefined,
        fetchImpl: (async () =>
          sse([
            JSON.stringify({ choices: [{ delta: { content: 'ab' } }] }),
            JSON.stringify({ error: { message: 'overloaded', code: 429 } }),
          ])) as unknown as typeof fetch,
      }),
    ).rejects.toThrow('AI_RATE_LIMITED');
  });

  it('Gemini: unisce i pezzi e usa lo stream', async () => {
    const seen: string[] = [];
    let url = '';
    const res = await complete({
      ...base,
      provider: 'gemini',
      onDelta: (t) => seen.push(t),
      fetchImpl: (async (u: string) => {
        url = u;
        return sse([
          JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Cia' }] } }] }),
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: 'o' }] }, finishReason: 'STOP' }],
            usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 2 },
            modelVersion: 'gemini-x',
          }),
        ]);
      }) as unknown as typeof fetch,
    });
    expect(url).toContain(':streamGenerateContent?alt=sse');
    expect(seen).toEqual(['Cia', 'Ciao']);
    expect(res).toMatchObject({ content: 'Ciao', model: 'gemini-x', promptTokens: 3 });
  });

  it('se il provider risponde con un normale JSON si usa quello', async () => {
    const res = await complete({
      ...base,
      onDelta: () => undefined,
      fetchImpl: (async () =>
        Response.json({
          model: 'x',
          choices: [{ message: { content: 'ok' } }],
        })) as unknown as typeof fetch,
    });
    expect(res.content).toBe('ok');
  });
});

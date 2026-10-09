import sharp from 'sharp';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp } from './helpers.js';

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const run = DATABASE_URL ? describe : describe.skip;

interface Call {
  url: string;
  body: Record<string, unknown>;
  auth: string | null;
}

/** Finto OpenRouter + Gemini: risponde in base al nome dello schema richiesto. */
function fakeAi(calls: Call[], replies: Record<string, unknown[]>) {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    calls.push({
      url,
      body,
      auth: headers.get('authorization') ?? headers.get('x-goog-api-key'),
    });
    if (url.endsWith('/models?pageSize=1000'))
      return Response.json({
        models: [
          { name: 'models/gemini-flash-latest', supportedGenerationMethods: ['generateContent'] },
        ],
      });
    if (url.endsWith('/key')) return Response.json({ data: { label: 'k', usage: 0 } });
    let schemaName: string;
    if (url.includes(':generateContent')) {
      const system = JSON.stringify(body.systemInstruction ?? body.contents);
      schemaName = /scontrin/i.test(system) ? 'tripshare_receipt' : 'tripshare_assistant';
    } else {
      const rf = body.response_format as { json_schema: { name: string } };
      schemaName = rf.json_schema.name;
    }
    const queue = replies[schemaName]!;
    const reply = queue.length > 1 ? queue.shift() : queue[0];
    const text = typeof reply === 'string' ? reply : JSON.stringify(reply);
    if (url.includes(':generateContent'))
      return Response.json({
        candidates: [{ content: { parts: [{ text }] } }],
        usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20 },
        modelVersion: 'gemini-flash-latest',
      });
    return Response.json({
      model: 'test/model',
      choices: [{ message: { content: text } }],
      usage: { prompt_tokens: 100, completion_tokens: 20, cost: 0.001 },
    });
  }) as typeof fetch;
}

const RECEIPT = {
  title: 'Cena da Mario',
  merchant: 'Mario',
  total: 42.5,
  currency: 'GBP',
  category: 'food',
  emoji: '🍝',
  items: [
    { name: 'Pasta', amount: 30 },
    { name: 'Vino', amount: 12.5 },
  ],
  confidence: 'high',
};

run('AI jobs (integration)', () => {
  let t: Awaited<ReturnType<typeof createTestApp>>;
  const calls: Call[] = [];
  const replies: Record<string, unknown[]> = {};

  beforeAll(async () => {
    t = await createTestApp(
      DATABASE_URL!,
      await mkdtemp(join(tmpdir(), 'tripshare-ai-')),
      fakeAi(calls, replies),
    );
  });
  beforeEach(async () => {
    await t.reset();
    calls.length = 0;
    for (const k of Object.keys(replies)) delete replies[k];
  });
  afterAll(async () => t?.close());

  async function setup() {
    const marco = (await t.signUp('marco@example.com', 'Marco')).cookie;
    const { data: trip } = await t.trpc<{ id: string }>('trips.create', marco, {
      title: 'Scozia',
      currency: 'EUR',
      startDate: '2026-10-12',
      endDate: '2026-10-14',
      destination: 'Edimburgo',
    });
    return { marco, tripId: trip.id };
  }

  async function uploadReceipt(cookie: string, tripId: string) {
    const image = await sharp({
      create: { width: 400, height: 600, channels: 3, background: '#ffffff' },
    })
      .jpeg()
      .toBuffer();
    const boundary = '----tripshare-ai';
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/trips/${tripId}/ai-files`,
      headers: {
        cookie,
        origin: 'http://localhost:5173',
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="r.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`,
        ),
        image,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]),
    });
    expect(res.statusCode).toBe(200);
    return res.json() as { file: string; mime: string };
  }

  it('reports AI as not configured without a key', async () => {
    const { marco, tripId } = await setup();
    const res = await t.trpc('ai.start', marco, {
      tripId,
      input: { kind: 'chat', message: 'ciao' },
    });
    expect(res.error?.message).toBe('AI_NOT_CONFIGURED');
  });

  it('reads a receipt with OpenRouter, repairing an invalid first answer', async () => {
    await t.settings.set('openrouter.apiKey', 'sk-or-central-key-123');
    const { marco, tripId } = await setup();
    replies.tripshare_receipt = ['non è JSON', RECEIPT];
    const file = await uploadReceipt(marco, tripId);
    const started = await t.trpc<{ id: string; conversationId: string }>('ai.start', marco, {
      tripId,
      input: { kind: 'receipt', file: file.file, mime: file.mime, tripCurrency: 'EUR' },
    });
    expect(started.status).toBe(200);
    const job = await t.trpc<{ status: string; result: typeof RECEIPT; provider: string }>(
      'ai.job',
      marco,
      { id: started.data.id },
      'query',
    );
    expect(job.data).toMatchObject({ status: 'done', provider: 'openrouter' });
    expect(job.data.result.total).toBe(42.5);
    expect(calls.filter((c) => c.url.endsWith('/chat/completions'))).toHaveLength(2);
    const first = calls.find((c) => c.url.endsWith('/chat/completions'))!;
    expect(first.auth).toBe('Bearer sk-or-central-key-123');
    expect(JSON.stringify(first.body.messages)).toContain('data:image/jpeg;base64,');

    // La spesa salvata con lo scontrino lo rende visibile ai membri.
    const me = (await t.trpc<{ myMemberId: string }>('trips.get', marco, { id: tripId }, 'query'))
      .data.myMemberId;
    await t.trpc('expenses.create', marco, {
      tripId,
      title: 'Cena da Mario',
      category: 'food',
      amount: 4250,
      currency: 'GBP',
      date: '2026-10-12',
      payers: [{ memberId: me, amount: 4250 }],
      split: { method: 'equal', members: [me] },
      receipt: file.file,
    });
    const img = await t.app.inject({
      method: 'GET',
      url: `/api/trips/${tripId}/receipts/${file.file}`,
      headers: { cookie: marco },
    });
    expect(img.statusCode).toBe(200);
  });

  it('uses the Gemini central key and enforces the monthly request quota', async () => {
    await t.settings.set('gemini.apiKey', 'AIza-central-gemini-key');
    await t.settings.set('ai.provider', 'gemini');
    await t.settings.set('ai.monthlyRequests', 1);
    const { marco, tripId } = await setup();
    replies.tripshare_assistant = [{ reply: 'Ciao! Il programma è vuoto.', actions: [] }];
    const started = await t.trpc<{ id: string; conversationId: string }>('ai.start', marco, {
      tripId,
      input: { kind: 'chat', message: 'Cosa facciamo?' },
    });
    const job = await t.trpc<{ status: string; provider: string; result: { reply: string } }>(
      'ai.job',
      marco,
      { id: started.data.id },
      'query',
    );
    expect(job.data).toMatchObject({ status: 'done', provider: 'gemini' });
    const call = calls.find((c) => c.url.includes(':generateContent'))!;
    expect(call.url).toContain('/models/gemini-flash-latest:generateContent');
    expect(call.auth).toBe('AIza-central-gemini-key');
    expect(call.body.generationConfig).toMatchObject({ responseMimeType: 'application/json' });
    // Gemini rifiuta gli schemi grandi: lo schema va solo nel prompt.
    expect(call.body.generationConfig).not.toHaveProperty('responseJsonSchema');

    const conversationId = started.data.conversationId;
    const history = await t.trpc<{ role: string }[]>(
      'ai.chat.history',
      marco,
      { tripId, conversationId },
      'query',
    );
    expect(history.data.map((m) => m.role)).toEqual(['user', 'assistant']);
    const list = await t.trpc<{ id: string; title: string }[]>(
      'ai.chat.conversations',
      marco,
      { tripId },
      'query',
    );
    expect(list.data).toEqual([
      expect.objectContaining({ id: conversationId, title: 'Cosa facciamo?' }),
    ]);

    const again = await t.trpc('ai.start', marco, {
      tripId,
      input: { kind: 'chat', message: 'Altro?' },
    });
    expect(again.error?.message).toBe('AI_QUOTA_EXCEEDED');
  });

  it('prefers the personal Gemini key in mixed mode', async () => {
    await t.settings.set('openrouter.apiKey', 'sk-or-central-key-123');
    await t.settings.set('openrouter.mode', 'mixed');
    const { marco, tripId } = await setup();
    const saved = await t.trpc('ai.setKey', marco, {
      provider: 'gemini',
      key: 'AIza-personal-key-0000',
    });
    expect(saved.status).toBe(200);
    const status = await t.trpc<{ keys: { gemini: string | null }; preferred: string }>(
      'ai.status',
      marco,
      undefined,
      'query',
    );
    expect(status.data.preferred).toBe('gemini');
    expect(status.data.keys.gemini).not.toContain('personal');

    replies.tripshare_assistant = [{ reply: 'ok', actions: [] }];
    await t.trpc('ai.start', marco, { tripId, input: { kind: 'chat', message: 'ciao' } });
    const call = calls.find((c) => c.url.includes(':generateContent'))!;
    expect(call.auth).toBe('AIza-personal-key-0000');
  });

  it('rejects assistant actions that cannot be applied, then accepts the fixed ones', async () => {
    await t.settings.set('openrouter.apiKey', 'sk-or-central-key-123');
    const { marco, tripId } = await setup();
    replies.tripshare_assistant = [
      {
        reply: 'Aggiungo il castello',
        actions: [{ type: 'deleteActivity', date: '2026-10-12', id: 'non-esiste' }],
      },
      {
        reply: 'Aggiungo il castello',
        actions: [
          { type: 'ensureDays', start: '2026-10-12', end: '2026-10-14' },
          {
            type: 'upsertActivity',
            date: '2026-10-12',
            activity: { title: 'Castello di Edimburgo', type: 'visit', time: '10:00' },
          },
        ],
      },
    ];
    const started = await t.trpc<{ id: string; conversationId: string }>('ai.start', marco, {
      tripId,
      input: { kind: 'chat', message: 'Aggiungi il castello il primo giorno' },
    });
    const job = await t.trpc<{ status: string; result: { actions: unknown[] } }>(
      'ai.job',
      marco,
      { id: started.data.id },
      'query',
    );
    expect(job.data.status).toBe('done');
    expect(job.data.result.actions).toHaveLength(2);
  });

  it('proposes a new place linked to an activity and an expense, both applicable', async () => {
    await t.settings.set('openrouter.apiKey', 'sk-or-central-key-123');
    const { marco, tripId } = await setup();
    replies.tripshare_assistant = [
      {
        reply: 'Aggiungo la distilleria e registro la benzina.',
        actions: [
          { type: 'ensureDays', start: '2026-10-12', end: '2026-10-14' },
          {
            type: 'upsertPlace',
            place: { id: 'glenkinchie', name: 'Glenkinchie Distillery', kind: 'sight' },
          },
          {
            type: 'upsertActivity',
            date: '2026-10-13',
            activity: {
              title: 'Visita alla distilleria',
              type: 'visit',
              placeIds: ['glenkinchie'],
            },
          },
        ],
        expenses: [
          {
            title: 'Benzina',
            amount: 45,
            currency: 'GBP',
            category: 'fuel',
            paidBy: 'Marco',
            status: 'paid',
          },
        ],
      },
    ];
    const started = await t.trpc<{ id: string; conversationId: string }>('ai.start', marco, {
      tripId,
      input: {
        kind: 'chat',
        message: 'Aggiungi una distilleria il secondo giorno, ho pagato 45 £ di benzina',
      },
    });
    const job = await t.trpc<{
      status: string;
      result: { actions: unknown[]; expenses: { title: string; paidBy: string }[] };
    }>('ai.job', marco, { id: started.data.id }, 'query');
    expect(job.data.status).toBe('done');
    expect(job.data.result.expenses[0]).toMatchObject({ title: 'Benzina', paidBy: 'Marco' });

    // Le modifiche si applicano al programma così come proposte.
    const applied = await t.trpc('plan.applyOps', marco, {
      tripId,
      ops: job.data.result.actions,
    });
    expect(applied.status).toBe(200);
    const plan = await t.trpc<{
      plan: { places: { id: string }[]; days: { activities: { placeIds: string[] }[] }[] };
    }>('plan.get', marco, { tripId }, 'query');
    expect(plan.data.plan.places.map((p) => p.id)).toContain('glenkinchie');
    expect(plan.data.plan.days[1]!.activities[0]!.placeIds).toEqual(['glenkinchie']);

    const history = await t.trpc<{ expenses: unknown[] | null }[]>(
      'ai.chat.history',
      marco,
      { tripId, conversationId: started.data.conversationId },
      'query',
    );
    expect(history.data[1]!.expenses).toHaveLength(1);
  });

  it('keeps separate conversations with their own history', async () => {
    await t.settings.set('openrouter.apiKey', 'sk-or-central-key-123');
    const { marco, tripId } = await setup();
    replies.tripshare_assistant = [{ reply: 'ok', actions: [] }];
    const first = await t.trpc<{ conversationId: string }>('ai.start', marco, {
      tripId,
      input: { kind: 'chat', message: 'Ristoranti a Edimburgo' },
    });
    await t.trpc('ai.start', marco, {
      tripId,
      input: { kind: 'chat', message: 'E per pranzo?', conversationId: first.data.conversationId },
    });
    const second = await t.trpc<{ conversationId: string }>('ai.start', marco, {
      tripId,
      input: { kind: 'chat', message: 'Meteo a Skye' },
    });
    expect(second.data.conversationId).not.toBe(first.data.conversationId);
    // Il secondo messaggio della prima chat arriva al modello con la cronologia della prima chat.
    const lastCall = calls.filter((c) => c.url.endsWith('/chat/completions'))[1]!;
    expect(JSON.stringify(lastCall.body.messages)).toContain('Ristoranti a Edimburgo');
    const thirdCall = calls.filter((c) => c.url.endsWith('/chat/completions'))[2]!;
    expect(JSON.stringify(thirdCall.body.messages)).not.toContain('Ristoranti a Edimburgo');

    const list = await t.trpc<unknown[]>('ai.chat.conversations', marco, { tripId }, 'query');
    expect(list.data).toHaveLength(2);
    await t.trpc('ai.chat.remove', marco, { tripId, conversationId: first.data.conversationId });
    const after = await t.trpc<unknown[]>('ai.chat.conversations', marco, { tripId }, 'query');
    expect(after.data).toHaveLength(1);
  });

  it('suggests the day for a place and rejects days outside the plan', async () => {
    await t.settings.set('openrouter.apiKey', 'sk-or-central-key-123');
    const { marco, tripId } = await setup();
    await t.trpc('plan.applyOps', marco, {
      tripId,
      ops: [
        { type: 'ensureDays', start: '2026-10-12', end: '2026-10-14' },
        {
          type: 'upsertPlace',
          place: { id: 'castello', name: 'Castello di Edimburgo', kind: 'sight' },
        },
      ],
    });
    replies.tripshare_schedule = [
      { date: '2027-01-01', reason: 'x' },
      { date: '2026-10-13', time: '10:00', reason: 'Siete già in centro quel giorno.' },
    ];
    const started = await t.trpc<{ id: string }>('ai.start', marco, {
      tripId,
      input: { kind: 'schedule', placeId: 'castello' },
    });
    const job = await t.trpc<{ status: string; result: { date: string; time: string } }>(
      'ai.job',
      marco,
      { id: started.data.id },
      'query',
    );
    expect(job.data.status).toBe('done');
    expect(job.data.result).toMatchObject({ date: '2026-10-13', time: '10:00' });
  });
});

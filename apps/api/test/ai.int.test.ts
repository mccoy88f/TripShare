import { sql } from 'drizzle-orm';
import sharp from 'sharp';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp } from './helpers.js';

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const run = DATABASE_URL ? describe : describe.skip;

const photo = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: '#3a7bd5' } })
    .jpeg()
    .toBuffer();
const BIG_PHOTO = await photo(800, 600);
const SMALL_PHOTO = await photo(200, 100);

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
    // Foto che l'AI indica per un luogo: una scaricabile e grande, una piccola, una inesistente.
    if (url.startsWith('https://93.184.216.34/')) {
      const name = url.split('/').pop()!;
      if (name.startsWith('missing')) return new Response('', { status: 404 });
      return new Response(new Uint8Array(name.startsWith('small') ? SMALL_PHOTO : BIG_PHOTO), {
        headers: { 'content-type': 'image/jpeg' },
      });
    }
    // Ricerca luoghi (OpenStreetMap) e foto (Wikimedia Commons) della generazione.
    if (url.startsWith('https://nominatim.openstreetmap.org/search')) {
      const q = decodeURIComponent(new URL(url).searchParams.get('q') ?? '');
      if (/fantasma/i.test(q)) return Response.json([]);
      const roma = /roma/i.test(q);
      return Response.json([
        {
          name: q.split(',')[0],
          display_name: q,
          lat: roma ? '41.9' : '38.12',
          lon: roma ? '12.5' : '13.36',
          address: { city: roma ? 'Roma' : 'Palermo', country: 'Italia' },
        },
      ]);
    }
    if (url.startsWith('https://commons.wikimedia.org/w/api.php'))
      return Response.json({
        query: {
          pages: {
            '1': {
              index: 1,
              title: 'File:Foto.jpg',
              imageinfo: [
                {
                  thumburl: 'https://93.184.216.34/commons-1.jpg',
                  mime: 'image/jpeg',
                  width: 960,
                  extmetadata: {
                    Artist: { value: 'Ada' },
                    LicenseShortName: { value: 'CC BY 4.0' },
                  },
                },
              ],
            },
          },
        },
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

  it('repeats a chat message, dropping it and everything after it', async () => {
    await t.settings.set('gemini.apiKey', 'AIza-central-gemini-key');
    await t.settings.set('ai.provider', 'gemini');
    const { marco, tripId } = await setup();
    replies.tripshare_assistant = [
      { reply: 'Prima risposta', actions: [] },
      { reply: 'Seconda risposta', actions: [] },
      { reply: 'Risposta rifatta', actions: [] },
    ];
    const first = await t.trpc<{ conversationId: string }>('ai.start', marco, {
      tripId,
      input: { kind: 'chat', message: 'Domanda uno' },
    });
    const conversationId = first.data.conversationId;
    await t.trpc('ai.start', marco, {
      tripId,
      input: { kind: 'chat', message: 'Domanda due', conversationId },
    });
    const history = () =>
      t.trpc<{ id: string; role: string; content: string }[]>(
        'ai.chat.history',
        marco,
        { tripId, conversationId },
        'query',
      );
    const before = (await history()).data;
    expect(before.map((m) => m.content)).toEqual([
      'Domanda uno',
      'Prima risposta',
      'Domanda due',
      'Seconda risposta',
    ]);

    // Dalla risposta si riparte dalla domanda che la precede.
    const fromAnswer = await t.trpc<{ message: string; removed: number }>('ai.chat.retry', marco, {
      tripId,
      conversationId,
      messageId: before[3]!.id,
    });
    expect(fromAnswer.data).toEqual({ message: 'Domanda due', removed: 2 });
    expect((await history()).data.map((m) => m.content)).toEqual(['Domanda uno', 'Prima risposta']);

    // Dalla domanda si toglie lei e tutto il resto; poi si rimanda.
    const fromQuestion = await t.trpc<{ message: string; removed: number }>(
      'ai.chat.retry',
      marco,
      {
        tripId,
        conversationId,
        messageId: before[0]!.id,
      },
    );
    expect(fromQuestion.data).toEqual({ message: 'Domanda uno', removed: 2 });
    await t.trpc('ai.start', marco, {
      tripId,
      input: { kind: 'chat', message: fromQuestion.data.message, conversationId },
    });
    expect((await history()).data.map((m) => m.content)).toEqual([
      'Domanda uno',
      expect.any(String),
    ]);

    // Non si tocca la chat di un altro.
    const sara = (await t.signUp('sara@example.com', 'Sara')).cookie;
    const denied = await t.trpc('ai.chat.retry', sara, {
      tripId,
      conversationId,
      messageId: before[0]!.id,
    });
    expect(denied.error).toBeDefined();
  });

  describe('phased trip generation', () => {
    const STRATEGY = {
      title: 'Sicilia e Roma',
      emoji: '🌋',
      summary: 'Da Messina a Palermo e Roma.',
      countryCodes: ['IT'],
      arrival: { mode: 'car', description: 'In auto fino a Palermo' },
      local: { modes: ['walk', 'metro'], notes: 'A piedi e metro' },
      legs: [
        { from: 'Messina', to: 'Palermo', mode: 'car', durationMinutes: 150 },
        { from: 'Palermo', to: 'Roma', mode: 'flight', durationMinutes: 80 },
        { from: 'Roma', to: 'Messina', mode: 'flight', durationMinutes: 85 },
      ],
      bases: [
        { stop: 'Palermo', nights: 1, lodging: 'apartment', rooms: 'Appartamento con 2 camere' },
        { stop: 'Roma', nights: 1, lodging: 'hotel', rooms: '2 camere doppie' },
      ],
      rental: { needed: false },
      pace: 'Tranquillo',
      guidelines: [],
    };
    const place = (id: string, name: string, extra = '') => ({
      stop: extra === 'roma' ? 'Roma' : 'Palermo',
      place: {
        id,
        name,
        kind: 'sight',
        mapsQuery: `${name}, ${extra === 'roma' ? 'Roma' : 'Palermo'}`,
        description: 'Bello',
      },
    });
    const PLACES = {
      places: [
        place('cattedrale', 'Cattedrale'),
        place('quattro-canti', 'Quattro Canti'),
        place('fantasma', 'Luogo Fantasma'),
        place('colosseo', 'Colosseo', 'roma'),
        place('foro', 'Foro Romano', 'roma'),
        place('pantheon', 'Pantheon', 'roma'),
      ],
    };
    const act = (id: string, time: string, title: string, placeIds: string[]) => ({
      id,
      time,
      type: 'visit',
      title,
      placeIds,
    });
    const DAYS = {
      days: [
        {
          date: '2026-10-12',
          title: 'Palermo',
          activities: [
            act('a1', '10:00', 'Cattedrale', ['cattedrale']),
            act('a2', '15:00', 'Quattro Canti', ['quattro-canti']),
          ],
        },
        {
          date: '2026-10-13',
          title: 'Roma',
          activities: [act('a3', '11:00', 'Colosseo', ['colosseo'])],
        },
        {
          date: '2026-10-14',
          title: 'Rientro',
          activities: [act('a4', '10:00', 'Foro', ['foro'])],
        },
      ],
    };
    const stay = (id: string, date: string, end: string) => ({
      id,
      type: 'lodging',
      title: `Alloggio ${id}`,
      status: 'to_book',
      start: { date },
      end: { date: end },
      cost: { amount: 80, currency: 'EUR', basis: 'per_night', approximate: true },
    });
    const BOOKINGS = {
      bookings: [
        stay('stay-palermo', '2026-10-12', '2026-10-13'),
        stay('stay-roma', '2026-10-13', '2026-10-14'),
      ],
      stays: [
        { date: '2026-10-12', bookingId: 'stay-palermo' },
        { date: '2026-10-13', bookingId: 'stay-roma' },
      ],
      activityLinks: [],
    };
    const BUDGET = {
      budget: [
        {
          id: 'meals',
          title: 'Pasti',
          category: 'food',
          status: 'estimate',
          amount: { amount: 30, currency: 'EUR', basis: 'per_person', approximate: true },
        },
      ],
    };
    const PACKING = {
      packing: [{ item: 'Passaporto', group: 'documents', perPerson: true }],
      tips: [{ title: 'Estate', text: 'Porta il cappello.' }],
    };
    const BRIEF = {
      main: { label: 'Sicilia', lat: 37.6, lon: 14 },
      origin: { label: 'Messina', lat: 38.19, lon: 15.55 },
      stops: [
        { label: 'Palermo', lat: 38.12, lon: 13.36, nights: 1 },
        { label: 'Roma', lat: 41.9, lon: 12.5, nights: 1 },
      ],
      travelers: { adults: 2, children: [] },
      ai: { intensity: 'normal', budget: 'mid' },
    };

    async function setupGeneration() {
      await t.settings.set('openrouter.apiKey', 'sk-or-central-key-123');
      const marco = (await t.signUp('marco@example.com', 'Marco')).cookie;
      const { data } = await t.trpc<{ id: string }>('trips.create', marco, {
        title: 'Viaggio',
        currency: 'EUR',
        destination: 'Sicilia',
        startDate: '2026-10-12',
        endDate: '2026-10-14',
        brief: BRIEF,
      });
      return { marco, tripId: data.id };
    }
    const load = (replyKey: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(replyKey)) replies[k] = [v];
    };
    const state = async (cookie: string, tripId: string) =>
      (
        await t.trpc<{
          status: string;
          steps: { key: string; status: string; count?: number; error?: string }[];
          warnings: { k: string; p?: Record<string, unknown> }[];
        }>('ai.generation.state', cookie, { tripId }, 'query')
      ).data;

    it('builds the trip step by step, verifies it and attaches photos', async () => {
      const { marco, tripId } = await setupGeneration();
      load({
        tripshare_gen_strategy: STRATEGY,
        tripshare_gen_places: PLACES,
        tripshare_gen_days: DAYS,
        tripshare_gen_bookings: BOOKINGS,
        tripshare_gen_budget: BUDGET,
        tripshare_gen_packing: PACKING,
      });
      const started = await t.trpc('ai.start', marco, {
        tripId,
        input: { kind: 'generateTrip' },
      });
      expect(started.status).toBe(200);

      const gen = await state(marco, tripId);
      expect(gen.status).toBe('done');
      expect(gen.steps.map((s) => [s.key, s.status])).toEqual([
        ['strategy', 'done'],
        ['places', 'done'],
        ['days', 'done'],
        ['bookings', 'done'],
        ['budget', 'done'],
        ['packing', 'done'],
        ['photos', 'done'],
      ]);
      // Un luogo che non esiste su OpenStreetMap resta segnalato.
      expect(gen.warnings).toContainEqual({ k: 'placeNotFound', p: { name: 'Luogo Fantasma' } });

      const { data: planRes } = await t.trpc<{
        plan: {
          trip: { title: string };
          places: { id: string; photo?: string; location?: { lat: number } }[];
          days: { stayBookingId?: string; activities: unknown[] }[];
          bookings: { id: string }[];
          budget: { id: string; bookingId?: string }[];
          packing: unknown[];
          tips: unknown[];
        };
      }>('plan.get', marco, { tripId }, 'query');
      const plan = planRes.plan;
      expect(plan.trip.title).toBe('Sicilia e Roma');
      expect(plan.places).toHaveLength(6);
      expect(plan.places.filter((p) => p.location)).toHaveLength(5);
      expect(plan.places.some((p) => p.photo?.startsWith('/api/files/place-'))).toBe(true);
      expect(plan.days.map((d) => d.stayBookingId)).toEqual([
        'stay-palermo',
        'stay-roma',
        undefined,
      ]);
      expect(plan.bookings.map((b) => b.id)).toEqual(['stay-palermo', 'stay-roma']);
      // Le prenotazioni con costo entrano da sole nel budget, insieme alle voci dell'AI.
      expect(plan.budget.map((b) => b.id)).toEqual([
        'budget-stay-palermo',
        'budget-stay-roma',
        'meals',
      ]);
      expect(plan.budget[0]!.bookingId).toBe('stay-palermo');
      expect(plan.packing).toHaveLength(1);
      expect(plan.tips).toHaveLength(1);

      // Le tappe arrivano all'AI nell'ordine del percorso, con le notti.
      const first = calls.find((c) => JSON.stringify(c.body).includes('Fase 1 di 7'))!;
      const prompt = JSON.stringify(first.body);
      expect(prompt.indexOf('Palermo')).toBeLessThan(prompt.indexOf('Roma'));
      expect(prompt).toContain('notti\\":1');
      // Una sola richiesta contata nella quota, anche se le fasi sono sei.
      const jobs = await t.db.execute(sql`select count(*)::int as n from ai_job`);
      expect((jobs as unknown as { n: number }[])[0]!.n).toBe(1);
    });

    it('repairs invalid answers, stops at a failing step and resumes from it', async () => {
      const { marco, tripId } = await setupGeneration();
      const tooBusy = {
        days: DAYS.days.map((d) => ({
          ...d,
          activities: Array.from({ length: 7 }, (_, i) =>
            act(`${d.date}-${i}`, `${String(8 + i).padStart(2, '0')}:00`, `Visita ${i}`, [
              'cattedrale',
            ]),
          ),
        })),
      };
      const noLodging = { ...BOOKINGS, bookings: [], stays: [] };
      replies.tripshare_gen_strategy = [STRATEGY];
      replies.tripshare_gen_places = [PLACES];
      replies.tripshare_gen_days = [tooBusy, DAYS];
      replies.tripshare_gen_bookings = [noLodging];
      replies.tripshare_gen_budget = [BUDGET];
      replies.tripshare_gen_packing = [PACKING];
      await t.trpc('ai.start', marco, { tripId, input: { kind: 'generateTrip' } });

      // Le giornate sbagliate (troppe visite) sono state corrette con una seconda richiesta.
      expect(calls.filter((c) => JSON.stringify(c.body).includes('Fase 3 di 7'))).toHaveLength(2);
      // Senza alloggi per tutte le notti le prenotazioni falliscono e si ferma lì.
      const failed = await state(marco, tripId);
      expect(failed.status).toBe('failed');
      expect(failed.steps.map((s) => s.status)).toEqual([
        'done',
        'done',
        'done',
        'failed',
        'pending',
        'pending',
        'pending',
      ]);
      expect(failed.steps[3]!.error).toBe('AI_INVALID_RESPONSE');

      // Si riparte dalle prenotazioni: le fasi già fatte non si rifanno.
      const before = calls.length;
      replies.tripshare_gen_bookings = [BOOKINGS];
      await t.trpc('ai.start', marco, {
        tripId,
        input: { kind: 'generateTrip', from: 'bookings' },
      });
      const done = await state(marco, tripId);
      expect(done.status).toBe('done');
      expect(done.steps.every((s) => s.status === 'done')).toBe(true);
      const again = calls.slice(before).map((c) => JSON.stringify(c.body));
      expect(again.some((b) => b.includes('Fase 1 di 7') || b.includes('Fase 2 di 7'))).toBe(false);
      expect(again.some((b) => b.includes('Fase 4 di 7'))).toBe(true);

      // Non si può ripartire da una fase senza la strategia, né avviare due volte insieme.
      const stranger = (await t.signUp('sara@example.com', 'Sara')).cookie;
      const denied = await t.trpc('ai.start', stranger, {
        tripId,
        input: { kind: 'generateTrip' },
      });
      expect(denied.error).toBeDefined();
    });
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

  it('reads a hotel receipt into booking, place and expense, and makes a ticket from the file', async () => {
    await t.settings.set('openrouter.apiKey', 'sk-or-central-key-123');
    const { marco, tripId } = await setup();
    replies.tripshare_document = [
      {
        documentType: 'invoice',
        summary: 'Ricevuta dell’hotel The Spires, 2 notti',
        expense: {
          title: 'Hotel The Spires',
          total: 203,
          currency: 'EUR',
          category: 'lodging',
          status: 'paid',
          bookingRef: 'the-spires',
        },
        bookings: [
          {
            id: 'the-spires',
            type: 'lodging',
            title: 'The Spires',
            status: 'booked',
            start: { date: '2026-10-12' },
            end: { date: '2026-10-14' },
            placeId: 'the-spires-place',
          },
        ],
        places: [{ id: 'the-spires-place', name: 'The Spires', kind: 'lodging' }],
        ticket: { bookingRef: 'the-spires', label: 'Voucher' },
        confidence: 'high',
      },
    ];
    const file = await uploadReceipt(marco, tripId);
    const started = await t.trpc<{ id: string }>('ai.start', marco, {
      tripId,
      input: {
        kind: 'document',
        file: file.file,
        mime: file.mime,
        tripCurrency: 'EUR',
        year: 2026,
      },
    });
    const job = await t.trpc<{ status: string; result: { bookings: unknown[] } }>(
      'ai.job',
      marco,
      { id: started.data.id },
      'query',
    );
    expect(job.data.status).toBe('done');
    expect(job.data.result.bookings).toHaveLength(1);

    // Il biglietto si crea dal file caricato, con una copia separata.
    await t.trpc('plan.applyOps', marco, {
      tripId,
      ops: [
        {
          type: 'upsertBooking',
          booking: {
            id: 'the-spires',
            type: 'lodging',
            title: 'The Spires',
            status: 'booked',
            start: { date: '2026-10-12' },
          },
        },
      ],
    });
    const ticket = await t.trpc<{ id: string }>('tickets.fromAiFile', marco, {
      tripId,
      bookingId: 'the-spires',
      file: file.file,
      label: 'Voucher',
    });
    expect(ticket.status).toBe(200);
    const res = await t.app.inject({
      method: 'GET',
      url: `/api/trips/${tripId}/tickets/${ticket.data.id}/file`,
      headers: { cookie: marco },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/jpeg');
  });

  it('finds place photos suggested by the AI, keeping only real, large images', async () => {
    await t.settings.set('openrouter.apiKey', 'sk-or-central-key-123');
    const { marco, tripId } = await setup();
    replies.tripshare_place_photo = [
      {
        images: [
          { url: 'https://93.184.216.34/missing-1.jpg' },
          { url: 'https://93.184.216.34/small-1.jpg' },
          { url: 'https://93.184.216.34/big-1.jpg' },
          { url: 'https://93.184.216.34/big-2.jpg', title: 'Castello' },
          { url: 'https://93.184.216.34/big-3.jpg' },
          { url: 'https://93.184.216.34/big-4.jpg' },
          { url: 'http://insecure.example.com/x.jpg' },
        ].slice(0, 6),
      },
    ];
    const started = await t.trpc<{ id: string }>('ai.start', marco, {
      tripId,
      input: { kind: 'placePhoto', name: 'Edinburgh Castle', destination: 'Scozia' },
    });
    expect(started.status).toBe(200);
    const job = await t.trpc<{
      status: string;
      result: { candidates: { photo: string; credit: string }[] };
    }>('ai.job', marco, { id: started.data.id }, 'query');
    expect(job.data.status).toBe('done');
    // Scartate la inesistente e la piccola; al massimo tre.
    expect(job.data.result.candidates).toHaveLength(3);
    for (const c of job.data.result.candidates) {
      expect(c.photo).toMatch(/^\/api\/files\/place-[a-f0-9]{32}\.webp$/);
      expect(c.credit).toBe('93.184.216.34');
      expect((await t.app.inject({ method: 'GET', url: c.photo })).statusCode).toBe(200);
    }

    // Le foto non scelte si eliminano; quella usata nel programma resta.
    const [chosen, ...others] = job.data.result.candidates.map((c) => c.photo);
    await t.trpc('plan.applyOps', marco, {
      tripId,
      ops: [
        {
          type: 'upsertPlace',
          place: { id: 'castello', name: 'Castello', kind: 'sight', photo: chosen },
        },
      ],
    });
    const discarded = await t.trpc('plan.placePhotoDiscard', marco, {
      tripId,
      urls: [chosen, ...others],
    });
    expect(discarded.status).toBe(200);
    expect((await t.app.inject({ method: 'GET', url: chosen! })).statusCode).toBe(200);
    for (const url of others)
      expect((await t.app.inject({ method: 'GET', url })).statusCode).toBe(404);
  });
});

import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp } from './helpers.js';

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const run = DATABASE_URL ? describe : describe.skip;
const scozia = JSON.parse(
  readFileSync(
    new URL('../../../packages/shared/examples/scozia.trip.json', import.meta.url),
    'utf8',
  ),
);

const fakeWeather = (async (input: string | URL | Request) => {
  const url = String(input);
  if (url.includes('geocoding-api')) {
    return Response.json({
      results: [{ name: 'Fort William', country: 'Regno Unito', latitude: 56.82, longitude: -5.1 }],
    });
  }
  if (url.includes('api.open-meteo.com')) {
    const start = new URL(url).searchParams.get('start_date')!;
    return Response.json({
      daily: {
        time: [start],
        weather_code: [61],
        temperature_2m_max: [12.4],
        temperature_2m_min: [6.1],
        precipitation_probability_max: [70],
        sunrise: [`${start}T07:41`],
        sunset: [`${start}T18:05`],
      },
    });
  }
  return new Response('{}', { status: 404 });
}) as typeof fetch;

run('trip plan (integration)', () => {
  let t: Awaited<ReturnType<typeof createTestApp>>;
  beforeAll(async () => {
    t = await createTestApp(DATABASE_URL!, undefined, fakeWeather);
  });
  beforeEach(async () => t.reset());
  afterAll(async () => t?.close());

  async function setup() {
    const owner = (await t.signUp('owner@example.com', 'Owner')).cookie;
    const { data } = await t.trpc<{ id: string }>('trips.create', owner, {
      title: 'Scozia',
      currency: 'EUR',
    });
    return { owner, tripId: data.id };
  }

  it('starts with an empty plan and applies operations', async () => {
    const { owner, tripId } = await setup();
    const empty = await t.trpc<{
      plan: { days: unknown[]; trip: { title: string } };
      version: number;
    }>('plan.get', owner, { tripId }, 'query');
    expect(empty.data.plan.days).toEqual([]);
    expect(empty.data.plan.trip.title).toBe('Scozia');

    const applied = await t.trpc<{ version: number }>('plan.applyOps', owner, {
      tripId,
      ops: [
        { type: 'ensureDays', start: '2026-10-12', end: '2026-10-13' },
        { type: 'upsertPlace', place: { name: 'Edinburgh Castle', kind: 'sight' } },
        {
          type: 'upsertActivity',
          date: '2026-10-12',
          activity: {
            time: '14:00',
            type: 'visit',
            title: 'Castello',
            placeIds: ['edinburgh-castle'],
          },
        },
      ],
    });
    expect(applied.data.version).toBe(1);
    const after = await t.trpc<{ plan: { days: { activities: { id: string }[] }[] } }>(
      'plan.get',
      owner,
      { tripId },
      'query',
    );
    expect(after.data.plan.days).toHaveLength(2);
    expect(after.data.plan.days[0]!.activities[0]!.id).toBe('castello');

    const broken = await t.trpc('plan.applyOps', owner, {
      tripId,
      ops: [
        {
          type: 'upsertActivity',
          date: '2026-10-12',
          activity: { type: 'visit', title: 'X', placeIds: ['missing'] },
        },
      ],
    });
    expect(broken.status).toBe(400);
    expect(broken.error?.message).toMatch(/PLAN_INVALID/);
  });

  it('imports a full trip document and updates the trip', async () => {
    const { owner, tripId } = await setup();
    const res = await t.trpc('plan.replace', owner, { tripId, plan: scozia, updateTrip: true });
    expect(res.status).toBe(200);
    const trip = await t.trpc<{ startDate: string; endDate: string; destination: string }>(
      'trips.get',
      owner,
      { id: tripId },
      'query',
    );
    expect(trip.data).toMatchObject({
      startDate: '2026-10-12',
      endDate: '2026-10-16',
      destination: 'Scozia',
    });
    const plan = await t.trpc<{ plan: { days: unknown[]; packing: { id: string }[] } }>(
      'plan.get',
      owner,
      { tripId },
      'query',
    );
    expect(plan.data.plan.days).toHaveLength(5);
    expect(plan.data.plan.packing.every((p) => p.id)).toBe(true);

    const invalid = await t.trpc('plan.replace', owner, { tripId, plan: { formatVersion: 1 } });
    expect(invalid.status).toBe(400);
  });

  it('tracks packing checks per member and blocks viewers from editing', async () => {
    const { owner, tripId } = await setup();
    await t.trpc('plan.replace', owner, { tripId, plan: scozia });
    const { data } = await t.trpc<{ plan: { packing: { id: string }[] } }>(
      'plan.get',
      owner,
      { tripId },
      'query',
    );
    const itemId = data.plan.packing[0]!.id;
    await t.trpc('plan.togglePacking', owner, { tripId, itemId, checked: true });
    const checked = await t.trpc<{ checks: Record<string, string[]> }>(
      'plan.get',
      owner,
      { tripId },
      'query',
    );
    expect(checked.data.checks[itemId]).toHaveLength(1);

    const invite = await t.trpc<{ token: string }>('invitations.create', owner, {
      tripId,
      role: 'viewer',
    });
    const viewer = (await t.signUp('viewer@example.com', 'Viewer')).cookie;
    await t.trpc('invitations.accept', viewer, { token: invite.data.token });
    const denied = await t.trpc('plan.applyOps', viewer, {
      tripId,
      ops: [{ type: 'setTips', tips: [] }],
    });
    expect(denied.status).toBe(403);
    // Anche chi può solo leggere spunta i propri bagagli.
    expect(
      (await t.trpc('plan.togglePacking', viewer, { tripId, itemId, checked: true })).status,
    ).toBe(200);
  });

  it('returns the weather for upcoming trips', async () => {
    const { owner, tripId } = await setup();
    const today = new Date().toISOString().slice(0, 10);
    await t.trpc('trips.update', owner, {
      id: tripId,
      data: {
        title: 'Scozia',
        currency: 'EUR',
        destination: 'Fort William',
        startDate: today,
        endDate: today,
      },
    });
    const res = await t.trpc<{ status: string; days: { sunset: string; max: number }[] }>(
      'plan.weather',
      owner,
      { tripId },
      'query',
    );
    expect(res.data.status).toBe('OK');
    expect(res.data.days[0]).toMatchObject({ sunset: '18:05', max: 12.4 });
  });
});

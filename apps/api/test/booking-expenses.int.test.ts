import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createTestApp } from './helpers.js';

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const run = DATABASE_URL ? describe : describe.skip;

interface ExpenseRow {
  id: string;
  title: string;
  amount: number;
  currency: string;
  status: string;
  bookingId: string | null;
  payers: { memberId: string; amount: number }[];
}

run('expenses of bookings (integration)', () => {
  let t: Awaited<ReturnType<typeof createTestApp>>;

  beforeAll(async () => {
    t = await createTestApp(DATABASE_URL!);
  });
  beforeEach(async () => t.reset());
  afterAll(async () => t?.close());

  async function setup() {
    const marco = (await t.signUp('marco@example.com', 'Marco')).cookie;
    const { data: trip } = await t.trpc<{ id: string }>('trips.create', marco, {
      title: 'Scozia',
      currency: 'EUR',
      startDate: '2026-10-12',
      endDate: '2026-10-14',
    });
    return { marco, tripId: trip.id };
  }
  const booking = (extra: Record<string, unknown> = {}) => ({
    id: 'volo',
    type: 'flight',
    title: 'Volo Roma → Edimburgo',
    status: 'booked',
    start: { date: '2026-10-12', time: '12:50' },
    cost: { amount: 120, currency: 'EUR' },
    ...extra,
  });

  const expensesOf = async (cookie: string, tripId: string) =>
    (await t.trpc<ExpenseRow[]>('expenses.list', cookie, { tripId }, 'query')).data;
  const planOf = async (cookie: string, tripId: string) =>
    (
      await t.trpc<{ plan: { bookings: Record<string, unknown>[] } }>(
        'plan.get',
        cookie,
        { tripId },
        'query',
      )
    ).data.plan;

  it('gives every booking its expense (free ones at zero) and keeps the cost only there', async () => {
    const { marco, tripId } = await setup();
    await t.trpc('plan.applyOps', marco, {
      tripId,
      ops: [
        { type: 'upsertBooking', booking: booking({ paid: false }) },
        {
          type: 'upsertBooking',
          booking: booking({ id: 'museo', type: 'ticket', title: 'Museo', cost: undefined }),
        },
      ],
    });
    const list = await expensesOf(marco, tripId);
    expect(list.map((e) => [e.bookingId, e.amount, e.status]).sort()).toEqual([
      ['museo', 0, 'planned'],
      ['volo', 12000, 'planned'],
    ]);
    // Il costo non resta nella prenotazione.
    const bookings = (await planOf(marco, tripId)).bookings;
    expect(bookings.every((b) => b.cost === undefined && b.paid === undefined)).toBe(true);
  });

  it('follows changes of cost and status, and ignores unrelated edits', async () => {
    const { marco, tripId } = await setup();
    await t.trpc('plan.applyOps', marco, {
      tripId,
      ops: [{ type: 'upsertBooking', booking: booking({ paid: false }) }],
    });
    // Un'altra modifica (senza costo) non cambia né duplica la spesa.
    await t.trpc('plan.applyOps', marco, {
      tripId,
      ops: [
        { type: 'upsertBooking', booking: booking({ notes: 'Bagaglio a mano', cost: undefined }) },
      ],
    });
    let list = await expensesOf(marco, tripId);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ amount: 12000, status: 'planned' });

    // Nuovo costo: la spesa segue; poi pagata; poi gratuita.
    await t.trpc('plan.applyOps', marco, {
      tripId,
      ops: [
        { type: 'upsertBooking', booking: booking({ cost: { amount: 150, currency: 'EUR' } }) },
      ],
    });
    expect((await expensesOf(marco, tripId))[0]!.amount).toBe(15000);
    await t.trpc('plan.applyOps', marco, {
      tripId,
      ops: [{ type: 'upsertBooking', booking: booking({ paid: true, cost: undefined }) }],
    });
    list = await expensesOf(marco, tripId);
    expect(list[0]).toMatchObject({ amount: 15000, status: 'paid' });
    await t.trpc('plan.applyOps', marco, {
      tripId,
      ops: [{ type: 'upsertBooking', booking: booking({ cost: { amount: 0, currency: 'EUR' } }) }],
    });
    expect((await expensesOf(marco, tripId))[0]!.amount).toBe(0);
  });

  it('cannot delete the expense of a booking by itself; deleting the booking handles it', async () => {
    const { marco, tripId } = await setup();
    await t.trpc('plan.applyOps', marco, {
      tripId,
      ops: [
        { type: 'upsertBooking', booking: booking({ paid: false }) },
        {
          type: 'upsertBooking',
          booking: booking({
            id: 'hotel',
            type: 'lodging',
            title: 'Hotel',
            paid: true,
            cost: { amount: 300, currency: 'EUR' },
          }),
        },
      ],
    });
    const list = await expensesOf(marco, tripId);
    const volo = list.find((e) => e.bookingId === 'volo')!;
    const denied = await t.trpc('expenses.delete', marco, { tripId, id: volo.id });
    expect(denied.error?.message).toBe('BOOKING_EXPENSE');

    // Prenotazione tolta: la spesa da pagare sparisce, quella già pagata resta (libera).
    await t.trpc('plan.applyOps', marco, {
      tripId,
      ops: [
        { type: 'deleteBooking', id: 'volo' },
        { type: 'deleteBooking', id: 'hotel' },
      ],
    });
    const after = await expensesOf(marco, tripId);
    expect(after.map((e) => [e.title, e.bookingId, e.status])).toEqual([['Hotel', null, 'paid']]);
    // Ora è una spesa libera: si può eliminare.
    expect((await t.trpc('expenses.delete', marco, { tripId, id: after[0]!.id })).status).toBe(200);
  });

  it('creates the missing expenses when an editor opens an existing plan', async () => {
    const { marco, tripId } = await setup();
    // Programma "vecchio": la prenotazione conserva costo e stato e non ha la spesa.
    await t.trpc('plan.applyOps', marco, {
      tripId,
      ops: [{ type: 'upsertBooking', booking: booking({ cost: undefined }) }],
    });
    await t.db.execute(
      sql`update trip set plan = jsonb_set(jsonb_set(plan, '{bookings,0,cost}', '{"amount":120,"currency":"EUR"}'::jsonb), '{bookings,0,paid}', 'true'::jsonb) where id = ${tripId}`,
    );
    await t.db.execute(sql`update expense set deleted_at = now() where trip_id = ${tripId}`);
    expect(await expensesOf(marco, tripId)).toHaveLength(0);
    const plan = await planOf(marco, tripId);
    expect(plan.bookings.every((b) => b.cost === undefined)).toBe(true);
    const list = await expensesOf(marco, tripId);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ bookingId: 'volo', amount: 12000, status: 'paid' });
    // Aprendolo ancora non cambia nulla.
    await planOf(marco, tripId);
    expect(await expensesOf(marco, tripId)).toHaveLength(1);
  });
});

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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

  it('creates the expense when a booking with a cost is saved, and follows it while unpaid', async () => {
    const { marco, tripId } = await setup();
    const expenses = async () =>
      (await t.trpc<ExpenseRow[]>('expenses.list', marco, { tripId }, 'query')).data;

    // Prenotazione con costo, non pagata: spesa "da pagare" a nome di chi l'ha salvata.
    await t.trpc('plan.applyOps', marco, {
      tripId,
      ops: [{ type: 'upsertBooking', booking: booking({ paid: false }) }],
    });
    let list = await expenses();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      title: 'Volo Roma → Edimburgo',
      amount: 12000,
      currency: 'EUR',
      status: 'planned',
      bookingId: 'volo',
    });
    expect(list[0]!.payers).toHaveLength(1);

    // Un'altra modifica del programma non crea doppioni.
    await t.trpc('plan.applyOps', marco, {
      tripId,
      ops: [{ type: 'upsertBooking', booking: booking({ paid: false, notes: 'Bagaglio a mano' }) }],
    });
    expect(await expenses()).toHaveLength(1);

    // Cambia il costo: la spesa ancora da pagare segue.
    await t.trpc('plan.applyOps', marco, {
      tripId,
      ops: [
        {
          type: 'upsertBooking',
          booking: booking({ paid: false, cost: { amount: 150, currency: 'EUR' } }),
        },
      ],
    });
    list = await expenses();
    expect(list).toHaveLength(1);
    expect(list[0]!.amount).toBe(15000);

    // La prenotazione risulta pagata: anche la spesa.
    await t.trpc('plan.applyOps', marco, {
      tripId,
      ops: [
        {
          type: 'upsertBooking',
          booking: booking({ paid: true, cost: { amount: 150, currency: 'EUR' } }),
        },
      ],
    });
    list = await expenses();
    expect(list[0]!.status).toBe('paid');

    // Una spesa già pagata non si tocca più, anche se il costo della prenotazione cambia.
    await t.trpc('plan.applyOps', marco, {
      tripId,
      ops: [
        {
          type: 'upsertBooking',
          booking: booking({ paid: true, cost: { amount: 999, currency: 'EUR' } }),
        },
      ],
    });
    expect((await expenses())[0]!.amount).toBe(15000);
  });

  it('creates a paid expense for an already paid booking and nothing without a cost', async () => {
    const { marco, tripId } = await setup();
    await t.trpc('plan.applyOps', marco, {
      tripId,
      ops: [
        { type: 'upsertBooking', booking: booking({ paid: true }) },
        {
          type: 'upsertBooking',
          booking: booking({ id: 'bnb', type: 'lodging', title: 'B&B', cost: undefined }),
        },
      ],
    });
    const list = (await t.trpc<ExpenseRow[]>('expenses.list', marco, { tripId }, 'query')).data;
    expect(list.map((e) => [e.bookingId, e.status])).toEqual([['volo', 'paid']]);
  });
});

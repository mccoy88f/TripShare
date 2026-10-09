import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp } from './helpers.js';

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const run = DATABASE_URL ? describe : describe.skip;

run('notes and planned expenses (integration)', () => {
  let t: Awaited<ReturnType<typeof createTestApp>>;

  beforeAll(async () => {
    t = await createTestApp(DATABASE_URL!);
  });
  beforeEach(async () => t.reset());
  afterAll(async () => t?.close());

  async function setup() {
    const marco = (await t.signUp('marco@example.com', 'Marco')).cookie;
    const sara = (await t.signUp('sara@example.com', 'Sara')).cookie;
    const { data: trip } = await t.trpc<{ id: string }>('trips.create', marco, {
      title: 'Scozia',
      currency: 'EUR',
    });
    const { data: inv } = await t.trpc<{ token: string }>('invitations.create', marco, {
      tripId: trip.id,
      role: 'viewer',
    });
    expect((await t.trpc('invitations.accept', sara, { token: inv.token })).status).toBe(200);
    return { marco, sara, tripId: trip.id };
  }

  it('shows public notes to everyone and private ones only to the author', async () => {
    const { marco, sara, tripId } = await setup();
    const pub = await t.trpc<{ id: string }>('notes.create', sara, {
      tripId,
      content: 'Portare gli adattatori',
      visibility: 'public',
    });
    expect(pub.status).toBe(200);
    await t.trpc('notes.create', marco, {
      tripId,
      title: 'Codici',
      content: 'Cassetta chiavi 4821',
      visibility: 'private',
    });
    const forSara = await t.trpc<{ content: string }[]>('notes.list', sara, { tripId }, 'query');
    expect(forSara.data.map((n) => n.content)).toEqual(['Portare gli adattatori']);
    const forMarco = await t.trpc<unknown[]>('notes.list', marco, { tripId }, 'query');
    expect(forMarco.data).toHaveLength(2);

    // Solo l'autore modifica; il proprietario può eliminare le note pubbliche degli altri.
    const edit = await t.trpc('notes.update', marco, {
      tripId,
      id: pub.data.id,
      content: 'x',
      visibility: 'public',
    });
    expect(edit.status).toBe(404);
    expect((await t.trpc('notes.delete', marco, { tripId, id: pub.data.id })).status).toBe(200);
  });

  it('keeps planned expenses out of balances until paid', async () => {
    const { marco, tripId } = await setup();
    const trip = await t.trpc<{ myMemberId: string; members: { id: string }[] }>(
      'trips.get',
      marco,
      { id: tripId },
      'query',
    );
    const me = trip.data.myMemberId;
    const all = trip.data.members.map((m) => m.id);
    const created = await t.trpc<{ id: string }>('expenses.create', marco, {
      tripId,
      title: 'Hotel',
      category: 'lodging',
      amount: 40000,
      currency: 'EUR',
      date: '2026-10-12',
      payers: [{ memberId: me, amount: 40000 }],
      split: { method: 'equal', members: all },
      status: 'planned',
      bookingId: 'bk-hotel',
    });
    expect(created.status).toBe(200);
    type Ledger = { ledger: { total: number; planned: number; balances: Record<string, number> } };
    let detail = await t.trpc<Ledger>('trips.get', marco, { id: tripId }, 'query');
    expect(detail.data.ledger).toMatchObject({ total: 0, planned: 40000 });
    expect(detail.data.ledger.balances[me] ?? 0).toBe(0);

    await t.trpc('expenses.setStatus', marco, { tripId, id: created.data.id, status: 'paid' });
    detail = await t.trpc<Ledger>('trips.get', marco, { id: tripId }, 'query');
    expect(detail.data.ledger).toMatchObject({ total: 40000, planned: 0 });
    expect(detail.data.ledger.balances[me]).toBe(20000);
    const list = await t.trpc<{ bookingId: string; status: string }[]>(
      'expenses.list',
      marco,
      { tripId },
      'query',
    );
    expect(list.data[0]).toMatchObject({ bookingId: 'bk-hotel', status: 'paid' });
  });

  it('integrates a planned expense with a payment receipt, rescaling the split', async () => {
    const { marco, tripId } = await setup();
    const trip = await t.trpc<{ myMemberId: string; members: { id: string }[] }>(
      'trips.get',
      marco,
      { id: tripId },
      'query',
    );
    const me = trip.data.myMemberId;
    const all = trip.data.members.map((m) => m.id);
    const { data: created } = await t.trpc<{ id: string }>('expenses.create', marco, {
      tripId,
      title: 'Hotel (stima)',
      category: 'lodging',
      amount: 20000,
      currency: 'EUR',
      date: '2026-10-12',
      payers: [{ memberId: me, amount: 20000 }],
      split: { method: 'equal', members: all },
      status: 'planned',
      bookingId: 'the-spires',
    });
    const res = await t.trpc('expenses.integrate', marco, {
      tripId,
      id: created.id,
      status: 'paid',
      amount: 20300,
      receipt: `${'a'.repeat(32)}.jpg`,
    });
    expect(res.status).toBe(200);
    const list = await t.trpc<
      {
        amount: number;
        amountTrip: number;
        status: string;
        receipt: string;
        payers: { amount: number }[];
        shares: { amount: number }[];
      }[]
    >('expenses.list', marco, { tripId }, 'query');
    expect(list.data[0]).toMatchObject({
      amount: 20300,
      amountTrip: 20300,
      status: 'paid',
      receipt: `${'a'.repeat(32)}.jpg`,
    });
    expect(list.data[0]!.payers[0]!.amount).toBe(20300);
    expect(list.data[0]!.shares.reduce((a, s) => a + s.amount, 0)).toBe(20300);
    const detail = await t.trpc<{ ledger: { balances: Record<string, number> } }>(
      'trips.get',
      marco,
      { id: tripId },
      'query',
    );
    expect(detail.data.ledger.balances[me]).toBe(10150);
  });
});

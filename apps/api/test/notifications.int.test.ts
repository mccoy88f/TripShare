import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { pruneEvents } from '../src/services/events.js';
import { createTestApp } from './helpers.js';

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const run = DATABASE_URL ? describe : describe.skip;

type Item = {
  id: string;
  read: boolean;
  tripId: string;
  event: { type: string; count: number; data: Record<string, unknown> };
  actor: { name: string } | null;
};

run('notifications (integration)', () => {
  let t: Awaited<ReturnType<typeof createTestApp>>;
  beforeAll(async () => {
    t = await createTestApp(DATABASE_URL!);
  });
  beforeEach(async () => t.reset());
  afterAll(async () => t?.close());

  async function setup() {
    const marco = (await t.signUp('marco@example.com', 'Marco')).cookie;
    const sara = (await t.signUp('sara@example.com', 'Sara')).cookie;
    const { data: trip } = await t.trpc<{ id: string; myMemberId: string }>('trips.create', marco, {
      title: 'Scozia',
      currency: 'EUR',
    });
    const { data: inv } = await t.trpc<{ token: string }>('invitations.create', marco, {
      tripId: trip.id,
      role: 'editor',
    });
    await t.trpc('invitations.accept', sara, { token: inv.token });
    const detail = await t.trpc<{ myMemberId: string; members: { id: string; name: string }[] }>(
      'trips.get',
      marco,
      { id: trip.id },
      'query',
    );
    return {
      marco,
      sara,
      tripId: trip.id,
      me: detail.data.myMemberId,
      members: detail.data.members,
    };
  }
  const list = async (cookie: string) =>
    (await t.trpc<{ items: Item[] }>('notifications.list', cookie, {}, 'query')).data.items;
  const unread = async (cookie: string) =>
    (await t.trpc<{ total: number }>('notifications.unread', cookie, undefined, 'query')).data
      .total;
  const expense = (tripId: string, me: string, title: string) => ({
    tripId,
    title,
    category: 'food',
    amount: 2500,
    currency: 'EUR',
    date: '2026-10-12',
    payers: [{ memberId: me, amount: 2500 }],
    split: { method: 'equal', members: [me] },
  });

  it('notifies the other members, never the author, and merges similar changes', async () => {
    const { marco, sara, tripId, me } = await setup();
    // Sara è entrata: lo sa solo Marco.
    expect(await unread(marco)).toBe(1);
    expect(await unread(sara)).toBe(0);
    expect((await list(marco))[0]).toMatchObject({
      event: { type: 'member.joined' },
      actor: { name: 'Sara' },
    });

    await t.trpc('expenses.create', marco, expense(tripId, me, 'Cena'));
    expect(await unread(sara)).toBe(1);
    expect(await unread(marco)).toBe(1); // le sue modifiche non lo riguardano
    const [first] = await list(sara);
    expect(first).toMatchObject({
      read: false,
      event: { type: 'expense.created', count: 1, data: { title: 'Cena', amount: 2500 } },
      actor: { name: 'Marco' },
    });

    // Un'altra spesa subito dopo si fonde: una sola notifica, con il conteggio.
    await t.trpc('expenses.create', marco, expense(tripId, me, 'Pranzo'));
    const merged = await list(sara);
    expect(merged.filter((n) => n.event.type === 'expense.created')).toHaveLength(1);
    expect(merged[0]!.event).toMatchObject({ count: 2, data: { title: 'Pranzo' } });

    // Letta, poi una nuova modifica la fa tornare da leggere.
    await t.trpc('notifications.markRead', sara, { ids: [merged[0]!.id] });
    expect(await unread(sara)).toBe(0);
    await t.trpc('expenses.create', marco, expense(tripId, me, 'Cena 2'));
    expect(await unread(sara)).toBe(1);
    expect((await list(sara))[0]!.event.count).toBe(3);

    await t.trpc('notifications.markAllRead', sara);
    expect(await unread(sara)).toBe(0);
  });

  it('records plan changes by element and skips private notes', async () => {
    const { marco, sara, tripId } = await setup();
    await t.trpc('plan.applyOps', marco, {
      tripId,
      ops: [
        { type: 'ensureDays', start: '2026-10-12', end: '2026-10-13' },
        { type: 'upsertPlace', place: { id: 'castello', name: 'Castello', kind: 'sight' } },
        {
          type: 'upsertActivity',
          date: '2026-10-12',
          activity: { title: 'Visita', type: 'visit', placeIds: ['castello'] },
        },
      ],
    });
    const types = (await list(sara)).map((n) => n.event.type);
    expect(types).toEqual(
      expect.arrayContaining(['plan.day.added', 'plan.place.added', 'plan.activity.added']),
    );

    // Una modifica dello stesso luogo non fa una notifica per ogni salvataggio.
    for (const description of ['uno', 'due']) {
      await t.trpc('plan.applyOps', marco, {
        tripId,
        ops: [
          {
            type: 'upsertPlace',
            place: { id: 'castello', name: 'Castello', kind: 'sight', description },
          },
        ],
      });
    }
    const updates = (await list(sara)).filter((n) => n.event.type === 'plan.place.updated');
    expect(updates).toHaveLength(1);
    expect(updates[0]!.event.count).toBe(2);

    await t.trpc('notes.create', marco, { tripId, content: 'Solo per me', visibility: 'private' });
    expect((await list(sara)).some((n) => n.event.type.startsWith('note.'))).toBe(false);
    await t.trpc('notes.create', marco, { tripId, content: 'Per tutti', visibility: 'public' });
    expect((await list(sara)).some((n) => n.event.type === 'note.created')).toBe(true);
  });

  it('stops notifying members who left and prunes old events', async () => {
    const { marco, sara, tripId, me, members } = await setup();
    const saraMember = members.find((m) => m.name === 'Sara')!;
    await t.trpc('trips.members.remove', marco, { tripId, memberId: saraMember.id });
    await t.trpc('expenses.create', marco, expense(tripId, me, 'Cena'));
    expect(await list(sara)).toEqual([]);
    expect(await unread(sara)).toBe(0);
    // Marco vede che Sara è uscita.
    expect((await list(marco)).some((n) => n.event.type === 'member.left')).toBe(false);

    await t.db.execute(sql`update trip_event set updated_at = now() - interval '100 days'`);
    expect(await pruneEvents(t.db, 90)).toBeGreaterThan(0);
    expect(await list(marco)).toEqual([]);
  });

  it('pushes changes to connected devices in real time', async () => {
    const { marco, sara, tripId, me } = await setup();
    await t.app.listen({ port: 0, host: '127.0.0.1' });
    const address = t.app.server.address();
    const base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;

    const open = async (cookie: string) => {
      const controller = new AbortController();
      const res = await fetch(`${base}/api/events`, {
        headers: { cookie },
        signal: controller.signal,
      });
      expect(res.headers.get('content-type')).toContain('text/event-stream');
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      return {
        /** Primo messaggio "change" ricevuto. */
        async next() {
          for (;;) {
            const match = /event: change\ndata: (.*)\n\n/.exec(buffer);
            if (match) {
              buffer = buffer.slice(match.index + match[0].length);
              return JSON.parse(match[1]!) as Record<string, unknown>;
            }
            const { value, done } = await reader.read();
            if (done) throw new Error('stream closed');
            buffer += decoder.decode(value);
          }
        },
        close: () => controller.abort(),
      };
    };

    const denied = await fetch(`${base}/api/events`);
    expect(denied.status).toBe(401);

    const forSara = await open(sara);
    const forMarco = await open(marco);
    await new Promise((r) => setTimeout(r, 100));
    await t.trpc('expenses.create', marco, expense(tripId, me, 'Cena'));
    // Sara riceve la modifica e la notifica; Marco la modifica ma non la notifica.
    expect(await forSara.next()).toMatchObject({
      tripId,
      kind: 'expense.created',
      actorName: 'Marco',
      notify: true,
      data: { title: 'Cena' },
    });
    expect(await forMarco.next()).toMatchObject({ kind: 'expense.created', notify: false });

    // Una spunta del bagaglio aggiorna le schermate senza creare notifiche.
    await t.trpc('plan.applyOps', marco, {
      tripId,
      ops: [
        { type: 'upsertPackingItem', item: { id: 'giacca', item: 'Giacca', group: 'clothing' } },
      ],
    });
    await forSara.next(); // plan.packing.added
    await t.trpc('plan.togglePacking', marco, { tripId, itemId: 'giacca', checked: true });
    expect(await forSara.next()).toMatchObject({ kind: 'packing.toggled', notify: false });
    expect((await list(sara)).some((n) => n.event.type.includes('toggled'))).toBe(false);

    forSara.close();
    forMarco.close();
  });
});

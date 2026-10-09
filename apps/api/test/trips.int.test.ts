import sharp from 'sharp';
import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp } from './helpers.js';

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const run = DATABASE_URL ? describe : describe.skip;

run('trips, invitations, expenses and balances (integration)', () => {
  let t: Awaited<ReturnType<typeof createTestApp>>;
  let uploads: string;

  beforeAll(async () => {
    uploads = await mkdtemp(join(tmpdir(), 'tripshare-uploads-'));
    t = await createTestApp(DATABASE_URL!, uploads);
  });
  beforeEach(async () => t.reset());
  afterAll(async () => t?.close());

  async function setupTrip() {
    const marco = (await t.signUp('marco@example.com', 'Marco')).cookie;
    const created = await t.trpc<{ id: string }>('trips.create', marco, {
      title: 'Scozia',
      emoji: '🏴',
      currency: 'EUR',
      startDate: '2026-10-12',
      endDate: '2026-10-16',
    });
    expect(created.status).toBe(200);
    const tripId = created.data.id;
    const luca = await t.trpc<{ id: string }>('trips.members.addPlaceholder', marco, {
      tripId,
      name: 'Luca',
      avatarEmoji: '🦊',
    });
    return { marco, tripId, lucaPlaceholder: luca.data.id };
  }

  it('creates a trip with the owner as member', async () => {
    const { marco, tripId } = await setupTrip();
    const list = await t.trpc<{ id: string; role: string; members: unknown[] }[]>(
      'trips.list',
      marco,
      undefined,
      'query',
    );
    expect(list.data).toHaveLength(1);
    expect(list.data[0]).toMatchObject({ id: tripId, role: 'owner' });
    expect(list.data[0]!.members).toHaveLength(2);
  });

  it('splits expenses in multiple currencies and simplifies debts', async () => {
    const { marco, tripId, lucaPlaceholder } = await setupTrip();
    const trip = await t.trpc<{ myMemberId: string }>('trips.get', marco, { id: tripId }, 'query');
    const me = trip.data.myMemberId;

    // 510 € di alloggio pagati da Marco, divisi a metà.
    expect(
      (
        await t.trpc('expenses.create', marco, {
          tripId,
          title: 'Waterfront Lodge',
          category: 'lodging',
          amount: 51000,
          currency: 'EUR',
          date: '2026-10-13',
          payers: [{ memberId: me, amount: 51000 }],
          split: { method: 'equal', members: [me, lucaPlaceholder] },
        })
      ).status,
    ).toBe(200);
    // 50 £ di cena pagati da Luca, quote 1:3 (Luca ha mangiato di più); cambio 1,16 dalla BCE (finta).
    const dinner = await t.trpc('expenses.create', marco, {
      tripId,
      title: 'Cena',
      emoji: '🍽️',
      category: 'food',
      amount: 5000,
      currency: 'GBP',
      date: '2026-10-13',
      payers: [{ memberId: lucaPlaceholder, amount: 5000 }],
      split: { method: 'shares', shares: { [me]: 1, [lucaPlaceholder]: 3 } },
    });
    expect(dinner.status).toBe(200);

    const after = await t.trpc<{
      ledger: { balances: Record<string, number>; transfers: unknown[]; total: number };
    }>('trips.get', marco, { id: tripId }, 'query');
    // Marco: +255 € (alloggio) − 14,50 € (¼ di 58 €) = +240,50 €
    expect(after.data.ledger.total).toBe(51000 + 5800);
    expect(after.data.ledger.balances).toEqual({ [me]: 24050, [lucaPlaceholder]: -24050 });
    expect(after.data.ledger.transfers).toEqual([{ from: lucaPlaceholder, to: me, amount: 24050 }]);

    // Rimborso registrato: i saldi si azzerano.
    await t.trpc('settlements.create', marco, {
      tripId,
      fromMemberId: lucaPlaceholder,
      toMemberId: me,
      amount: 24050,
      date: '2026-10-16',
    });
    const settled = await t.trpc<{ ledger: { balances: Record<string, number> } }>(
      'trips.get',
      marco,
      { id: tripId },
      'query',
    );
    expect(Object.values(settled.data.ledger.balances).every((v) => v === 0)).toBe(true);

    const expenses = await t.trpc<{ title: string; rate: number; amountTrip: number }[]>(
      'expenses.list',
      marco,
      { tripId },
      'query',
    );
    expect(expenses.data.find((e) => e.title === 'Cena')).toMatchObject({
      rate: 1.16,
      amountTrip: 5800,
    });
  });

  it('rejects inconsistent expenses', async () => {
    const { marco, tripId, lucaPlaceholder } = await setupTrip();
    const base = {
      tripId,
      title: 'X',
      category: 'other',
      amount: 1000,
      currency: 'EUR',
      date: '2026-10-13',
      split: { method: 'equal', members: [lucaPlaceholder] },
    };
    const wrongPayers = await t.trpc('expenses.create', marco, {
      ...base,
      payers: [{ memberId: lucaPlaceholder, amount: 999 }],
    });
    expect(wrongPayers.error?.message).toBe('PAYERS_MUST_SUM_TO_TOTAL');
    const wrongPercent = await t.trpc('expenses.create', marco, {
      ...base,
      payers: [{ memberId: lucaPlaceholder, amount: 1000 }],
      split: { method: 'percent', percents: { [lucaPlaceholder]: 90 } },
    });
    expect(wrongPercent.status).toBe(400);
  });

  it('lets an invited user sign up (invite only), claim a placeholder and see the trip', async () => {
    const { marco, tripId, lucaPlaceholder } = await setupTrip();
    await t.settings.set('registration.mode', 'invite_only');

    const invite = await t.trpc<{ token: string; url: string }>('invitations.create', marco, {
      tripId,
      role: 'editor',
    });
    expect(invite.data.url).toBe(`http://localhost:5173/invite/${invite.data.token}`);

    const preview = await t.trpc<{ valid: boolean; claimable: { id: string }[] }>(
      'invitations.preview',
      '',
      { token: invite.data.token },
      'query',
    );
    expect(preview.data.valid).toBe(true);
    expect(preview.data.claimable.map((c) => c.id)).toEqual([lucaPlaceholder]);

    const blocked = await t.signUp('stranger@example.com', 'Stranger');
    expect(blocked.status).toBe(400);
    const luca = await t.signUp('luca@example.com', 'Luca Bianchi', {
      'x-invite-token': invite.data.token,
    });
    expect(luca.status).toBe(200);

    const accepted = await t.trpc<{ tripId: string }>('invitations.accept', luca.cookie, {
      token: invite.data.token,
      claimMemberId: lucaPlaceholder,
    });
    expect(accepted.data.tripId).toBe(tripId);
    const trip = await t.trpc<{ myMemberId: string; role: string }>(
      'trips.get',
      luca.cookie,
      { id: tripId },
      'query',
    );
    expect(trip.data).toMatchObject({ myMemberId: lucaPlaceholder, role: 'editor' });
  });

  it('sends email invitations and restricts them to that address', async () => {
    const { marco, tripId } = await setupTrip();
    const invite = await t.trpc<{ token: string }>('invitations.create', marco, {
      tripId,
      email: 'giulia@example.com',
      role: 'viewer',
    });
    const mail = t.sent.find((m) => m.template.kind === 'trip-invite');
    expect(mail?.to).toBe('giulia@example.com');

    const other = await t.signUp('other@example.com', 'Other');
    const denied = await t.trpc('invitations.accept', other.cookie, { token: invite.data.token });
    expect(denied.error?.message).toBe('INVITATION_OTHER_EMAIL');

    const giulia = await t.signUp('giulia@example.com', 'Giulia');
    expect(
      (await t.trpc('invitations.accept', giulia.cookie, { token: invite.data.token })).status,
    ).toBe(200);
    // Come viewer non può aggiungere spese.
    const trip = await t.trpc<{ myMemberId: string }>(
      'trips.get',
      giulia.cookie,
      { id: tripId },
      'query',
    );
    const add = await t.trpc('expenses.create', giulia.cookie, {
      tripId,
      title: 'X',
      category: 'other',
      amount: 100,
      currency: 'EUR',
      date: '2026-10-13',
      payers: [{ memberId: trip.data.myMemberId, amount: 100 }],
      split: { method: 'equal', members: [trip.data.myMemberId] },
    });
    expect(add.status).toBe(403);
  });

  it('hides trips from non members', async () => {
    const { tripId } = await setupTrip();
    const other = await t.signUp('other@example.com', 'Other');
    const res = await t.trpc('trips.get', other.cookie, { id: tripId }, 'query');
    expect(res.status).toBe(404);
  });

  it('uploads a cover photo as WebP', async () => {
    const { marco, tripId } = await setupTrip();
    const png = await sharp({
      create: { width: 2400, height: 1600, channels: 3, background: '#0d9488' },
    })
      .png()
      .toBuffer();
    const boundary = '----tripshare';
    const payload = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="c.png"\r\nContent-Type: image/png\r\n\r\n`,
      ),
      png,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/trips/${tripId}/cover`,
      headers: {
        cookie: marco,
        origin: 'http://localhost:5173',
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload,
    });
    expect(res.statusCode).toBe(200);
    const { url } = res.json();
    const file = await t.app.inject({ method: 'GET', url });
    expect(file.headers['content-type']).toBe('image/webp');
    const meta = await sharp(file.rawPayload).metadata();
    expect(meta).toMatchObject({ format: 'webp', width: 1600, height: 900 });
    expect(await readdir(uploads)).toHaveLength(1);
  });
});

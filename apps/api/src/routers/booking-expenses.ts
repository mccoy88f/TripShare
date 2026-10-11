import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { expense, trip, tripMember } from '@tripshare/db';
import {
  BOOKING_EXPENSE_CATEGORY,
  bookingExpenseAmount,
  type TripDocument,
} from '@tripshare/shared/trip-format';
import { prepareForStorage } from '../services/plan.js';
import type { Context } from '../trpc/init.js';
import { expensesRouter } from './expenses.js';

/**
 * Ogni prenotazione ha la sua spesa: è lì che vive il costo reale (importo, da pagare o pagata,
 * chi ha pagato, come si divide). La prenotazione non conserva più `cost` e `paid`: quando
 * arrivano (dal modulo, dall'assistente o da una generazione) servono a creare o aggiornare la
 * spesa e poi vengono tolti dal programma.
 *
 * - Prenotazione senza costo (o a zero): spesa a zero, cioè "gratuita".
 * - Prenotazione nuova: spesa "da pagare", oppure "pagata" se risulta pagata.
 * - Costo o stato cambiati nella prenotazione: la spesa si allinea (importo solo se la valuta
 *   è la stessa).
 * - Prenotazione eliminata: la spesa ancora "da pagare" si elimina; una già pagata resta come
 *   spesa libera.
 *
 * Chi ha salvato la prenotazione risulta chi ha pagato e il totale si divide in parti uguali
 * tra i partecipanti: si corregge dalla scheda della spesa.
 *
 * Un errore qui non deve far fallire la modifica del programma: si registra e basta.
 * `before` è il programma precedente (null quando si sistemano prenotazioni già salvate).
 */
const running = new Map<string, Promise<unknown>>();

/** Una riconciliazione alla volta per viaggio: due aperture insieme non creano doppioni. */
async function serialized<T>(tripId: string, fn: () => Promise<T>): Promise<T> {
  const previous = running.get(tripId) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(fn);
  running.set(tripId, next);
  try {
    return await next;
  } finally {
    if (running.get(tripId) === next) running.delete(tripId);
  }
}

/** Ci sono prenotazioni senza spesa, o con costo e stato ancora nel programma? */
export async function needsBookingExpenses(ctx: Context, tripId: string, doc: TripDocument) {
  if (doc.bookings.length === 0) return false;
  const rows = await ctx.db
    .select({ bookingId: expense.bookingId })
    .from(expense)
    .where(
      and(eq(expense.tripId, tripId), isNotNull(expense.bookingId), isNull(expense.deletedAt)),
    );
  const linked = new Set(rows.map((r) => r.bookingId));
  return doc.bookings.some(
    (b) => !linked.has(b.id) || b.cost !== undefined || b.paid !== undefined,
  );
}

export async function reconcileBookingExpenses(
  ctx: Context,
  tripId: string,
  before: TripDocument | null,
  after: TripDocument,
) {
  await serialized(tripId, async () => {
    try {
      const members = await ctx.db
        .select({ id: tripMember.id, userId: tripMember.userId })
        .from(tripMember)
        .where(and(eq(tripMember.tripId, tripId), isNull(tripMember.removedAt)));
      const actor = members.find((m) => m.userId === ctx.session!.user.id);
      if (!actor) return;
      const caller = expensesRouter.createCaller(ctx);
      const linkedRows = await ctx.db
        .select()
        .from(expense)
        .where(
          and(eq(expense.tripId, tripId), isNotNull(expense.bookingId), isNull(expense.deletedAt)),
        );
      const linkedBy = new Map(linkedRows.map((e) => [e.bookingId!, e]));
      const previous = new Map((before?.bookings ?? []).map((b) => [b.id, b]));

      for (const b of after.bookings) {
        const total = bookingExpenseAmount(b, after.trip.travelers);
        const linked = linkedBy.get(b.id);
        const old = previous.get(b.id);
        if (!linked) {
          await caller.create({
            tripId,
            title: b.title.slice(0, 160),
            category: BOOKING_EXPENSE_CATEGORY[b.type],
            amount: total?.amount ?? 0,
            currency: total?.currency ?? after.trip.currency,
            date: b.start.date,
            payers: [{ memberId: actor.id, amount: total?.amount ?? 0 }],
            split: { method: 'equal', members: members.map((m) => m.id) },
            status: b.paid === true ? 'paid' : 'planned',
            bookingId: b.id,
          });
          continue;
        }
        // Costo o stato arrivati con questa modifica (non quelli rimasti in un programma vecchio).
        const touched =
          !!before &&
          (JSON.stringify(old?.cost) !== JSON.stringify(b.cost) || old?.paid !== b.paid);
        if (!touched) continue;
        const amountChanged =
          b.cost !== undefined &&
          linked.currency === (total?.currency ?? linked.currency) &&
          linked.amount !== (total?.amount ?? 0);
        const status = b.paid === true ? 'paid' : b.paid === false ? 'planned' : undefined;
        if (amountChanged || (status && status !== linked.status))
          await caller.integrate({
            tripId,
            id: linked.id,
            ...(status && status !== linked.status ? { status } : {}),
            ...(amountChanged ? { amount: total?.amount ?? 0 } : {}),
          });
      }

      // Prenotazioni tolte dal programma.
      const kept = new Set(after.bookings.map((b) => b.id));
      for (const old of before?.bookings ?? []) {
        if (kept.has(old.id)) continue;
        const linked = linkedBy.get(old.id);
        if (!linked) continue;
        if (linked.status === 'planned')
          await ctx.db
            .update(expense)
            .set({ deletedAt: new Date() })
            .where(eq(expense.id, linked.id));
        else await ctx.db.update(expense).set({ bookingId: null }).where(eq(expense.id, linked.id));
      }

      // `cost` e `paid` non restano nella prenotazione: il costo reale è nella spesa.
      if (after.bookings.some((b) => b.cost !== undefined || b.paid !== undefined)) {
        const stripped = prepareForStorage({
          ...after,
          bookings: after.bookings.map(({ cost: _c, paid: _p, ...rest }) => rest),
        } as TripDocument);
        await ctx.db
          .update(trip)
          .set({ plan: stripped, planVersion: sql`${trip.planVersion} + 1` })
          .where(eq(trip.id, tripId));
      }
    } catch (err) {
      console.warn('[plan] spese delle prenotazioni non aggiornate:', err);
    }
  });
}

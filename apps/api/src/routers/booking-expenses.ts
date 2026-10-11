import { and, eq, isNull } from 'drizzle-orm';
import { expense, tripMember } from '@tripshare/db';
import {
  BOOKING_EXPENSE_CATEGORY,
  bookingExpenseAmount,
  type TripDocument,
} from '@tripshare/shared/trip-format';
import type { Context } from '../trpc/init.js';
import { expensesRouter } from './expenses.js';

/**
 * Tiene allineate le spese alle prenotazioni: salvando una prenotazione con un costo nasce la
 * spesa collegata ("da pagare", oppure "pagata" se la prenotazione risulta pagata). Se la
 * prenotazione cambia costo o stato, la spesa ancora "da pagare" si aggiorna; una spesa già
 * pagata non si tocca più (qualcuno l'ha registrata davvero). Chi ha salvato la prenotazione
 * risulta chi ha pagato e il totale si divide in parti uguali tra i partecipanti: si
 * correggono dalla scheda della spesa.
 *
 * Un errore qui non deve far fallire la modifica del programma: si registra e basta.
 */
export async function syncBookingExpenses(
  ctx: Context,
  tripId: string,
  before: TripDocument,
  after: TripDocument,
) {
  try {
    const previous = new Map(before.bookings.map((b) => [b.id, b]));
    const changed = after.bookings.filter((b) => {
      if (!b.cost) return false;
      const old = previous.get(b.id);
      return !old || old.paid !== b.paid || JSON.stringify(old.cost) !== JSON.stringify(b.cost);
    });
    if (changed.length === 0) return;

    const members = await ctx.db
      .select({ id: tripMember.id, userId: tripMember.userId })
      .from(tripMember)
      .where(and(eq(tripMember.tripId, tripId), isNull(tripMember.removedAt)));
    const actor = members.find((m) => m.userId === ctx.session!.user.id);
    if (!actor) return;
    const caller = expensesRouter.createCaller(ctx);

    for (const b of changed) {
      const total = bookingExpenseAmount(b, after.trip.travelers);
      if (!total) continue;
      const [linked] = await ctx.db
        .select()
        .from(expense)
        .where(
          and(eq(expense.tripId, tripId), eq(expense.bookingId, b.id), isNull(expense.deletedAt)),
        );
      if (!linked) {
        await caller.create({
          tripId,
          title: b.title.slice(0, 160),
          category: BOOKING_EXPENSE_CATEGORY[b.type],
          amount: total.amount,
          currency: total.currency,
          date: b.start.date,
          payers: [{ memberId: actor.id, amount: total.amount }],
          split: { method: 'equal', members: members.map((m) => m.id) },
          status: b.paid === true ? 'paid' : 'planned',
          bookingId: b.id,
        });
        continue;
      }
      if (linked.status !== 'planned') continue;
      await caller.integrate({
        tripId,
        id: linked.id,
        ...(b.paid === true ? { status: 'paid' as const } : {}),
        // L'importo si allinea solo se la valuta è la stessa della spesa.
        ...(linked.currency === total.currency && linked.amount !== total.amount
          ? { amount: total.amount }
          : {}),
      });
    }
  } catch (err) {
    console.warn('[plan] spese delle prenotazioni non aggiornate:', err);
  }
}

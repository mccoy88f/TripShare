import { TRPCError } from '@trpc/server';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import {
  expense,
  expensePayer,
  expenseShare,
  settlement,
  trip,
  tripMember,
  type Database,
} from '@tripshare/db';
import { allocate, computeBalances, simplifyDebts, type LedgerExpense } from '@tripshare/shared';

export const TRIP_ROLES = ['owner', 'editor', 'viewer'] as const;
export type TripRole = (typeof TRIP_ROLES)[number];
const RANK: Record<TripRole, number> = { viewer: 0, editor: 1, owner: 2 };

/** Verifica che l'utente sia membro del viaggio con almeno il ruolo indicato. */
export async function requireMember(
  db: Database,
  tripId: string,
  userId: string,
  minRole: TripRole = 'viewer',
) {
  const [row] = await db
    .select({ member: tripMember, trip })
    .from(tripMember)
    .innerJoin(trip, eq(trip.id, tripMember.tripId))
    .where(
      and(
        eq(tripMember.tripId, tripId),
        eq(tripMember.userId, userId),
        isNull(tripMember.removedAt),
      ),
    );
  if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'TRIP_NOT_FOUND' });
  if (RANK[row.member.role as TripRole] < RANK[minRole])
    throw new TRPCError({ code: 'FORBIDDEN', message: 'TRIP_FORBIDDEN' });
  return row;
}

export interface Ledger {
  /** Saldo per membro nella valuta del viaggio: positivo = deve ricevere. */
  balances: Record<string, number>;
  /** Trasferimenti suggeriti per saldare tutto. */
  transfers: { from: string; to: string; amount: number }[];
  /** Totale speso dal gruppo, nella valuta del viaggio. */
  total: number;
  /** Quanto ha pagato e quanto ha consumato ciascuno. */
  paid: Record<string, number>;
  owed: Record<string, number>;
}

/**
 * Calcola saldi e trasferimenti di uno o più viaggi. Ogni spesa è convertita nella valuta del
 * viaggio con il suo tasso (amountTrip); pagamenti e quote vengono ripartiti in proporzione
 * agli importi originali, così le somme restano esatte al centesimo.
 */
export async function computeLedgers(
  db: Database,
  tripIds: string[],
): Promise<Map<string, Ledger>> {
  const result = new Map<string, Ledger>();
  if (tripIds.length === 0) return result;

  const expenses = await db
    .select({ id: expense.id, tripId: expense.tripId, amountTrip: expense.amountTrip })
    .from(expense)
    .where(and(inArray(expense.tripId, tripIds), isNull(expense.deletedAt)));
  const ids = expenses.map((e) => e.id);
  const [payers, shares, settlements] = await Promise.all([
    ids.length ? db.select().from(expensePayer).where(inArray(expensePayer.expenseId, ids)) : [],
    ids.length ? db.select().from(expenseShare).where(inArray(expenseShare.expenseId, ids)) : [],
    db
      .select()
      .from(settlement)
      .where(and(inArray(settlement.tripId, tripIds), isNull(settlement.deletedAt))),
  ]);

  const byExpense = <T extends { expenseId: string }>(rows: T[]) => {
    const map = new Map<string, T[]>();
    for (const r of rows) map.set(r.expenseId, [...(map.get(r.expenseId) ?? []), r]);
    return map;
  };
  const payersBy = byExpense(payers);
  const sharesBy = byExpense(shares);

  const spread = (total: number, rows: { memberId: string; amount: number }[]) => {
    const parts = rows.some((r) => r.amount > 0)
      ? allocate(
          total,
          rows.map((r) => r.amount),
        )
      : rows.map(() => 0);
    return Object.fromEntries(rows.map((r, i) => [r.memberId, parts[i]!]));
  };

  for (const tripId of tripIds) {
    const ledgerExpenses: LedgerExpense[] = expenses
      .filter((e) => e.tripId === tripId)
      .map((e) => ({
        paid: spread(e.amountTrip, payersBy.get(e.id) ?? []),
        owed: spread(e.amountTrip, sharesBy.get(e.id) ?? []),
      }));
    const tripSettlements = settlements
      .filter((s) => s.tripId === tripId)
      .map((s) => ({ from: s.fromMemberId, to: s.toMemberId, amount: s.amount }));
    const balances = computeBalances(ledgerExpenses, tripSettlements);
    const sum = (key: 'paid' | 'owed') => {
      const out: Record<string, number> = {};
      for (const e of ledgerExpenses)
        for (const [m, v] of Object.entries(e[key])) out[m] = (out[m] ?? 0) + v;
      return out;
    };
    result.set(tripId, {
      balances,
      transfers: simplifyDebts(balances),
      total: expenses.filter((e) => e.tripId === tripId).reduce((a, e) => a + e.amountTrip, 0),
      paid: sum('paid'),
      owed: sum('owed'),
    });
  }
  return result;
}

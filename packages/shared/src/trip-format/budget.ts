import type { CurrencyCode } from '../currencies.js';
import { toMinor } from '../money.js';
import type { BudgetItem, Money, TripDocument } from './schema.js';

/**
 * Calcolo del budget previsto nella valuta del viaggio, a partire dalle voci del programma.
 * Gli importi "a persona", "a notte" e "al giorno" vengono moltiplicati; le valute diverse
 * da quella del viaggio vengono convertite con `exchangeRates`.
 */

export interface BudgetContext {
  tripCurrency: CurrencyCode;
  travelers: number;
  days: number;
  rates: Partial<Record<CurrencyCode, number>>;
}

function nightsBetween(start?: string, end?: string) {
  if (!start || !end) return 1;
  const diff = (Date.parse(`${end}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) / 86_400_000;
  return Math.max(1, Math.round(diff));
}

/** Importo in unità minori della valuta del viaggio, oppure null se manca il tasso. */
export function moneyToTripMinor(money: Money, ctx: BudgetContext, nights = 1): number | null {
  const multiplier =
    money.basis === 'per_person'
      ? ctx.travelers
      : money.basis === 'per_night'
        ? nights
        : money.basis === 'per_day'
          ? ctx.days
          : 1;
  const rate = money.currency === ctx.tripCurrency ? 1 : ctx.rates[money.currency];
  if (!rate) return null;
  return toMinor(money.amount * multiplier * rate, ctx.tripCurrency);
}

export interface BudgetLine {
  item: BudgetItem;
  /** Importo totale nella valuta del viaggio; null se manca l'importo o il tasso. */
  total: number | null;
}

export interface BudgetSummary {
  lines: BudgetLine[];
  /** Totale delle voci incluse con importo noto. */
  total: number;
  byStatus: Record<BudgetItem['status'], number>;
  byCategory: Record<string, number>;
  /** Valute usate per cui manca il tasso di cambio. */
  missingRates: CurrencyCode[];
  /** Voci "pending" ancora senza importo. */
  pendingWithoutAmount: number;
}

export function budgetContext(doc: TripDocument, travelers?: number): BudgetContext {
  return {
    tripCurrency: doc.trip.currency,
    travelers: Math.max(1, travelers ?? doc.trip.travelers),
    days: Math.max(1, doc.days.length),
    rates: doc.exchangeRates ?? {},
  };
}

export function summarizeBudget(doc: TripDocument, ctx: BudgetContext): BudgetSummary {
  const bookings = new Map(doc.bookings.map((b) => [b.id, b]));
  const missing = new Set<CurrencyCode>();
  const summary: BudgetSummary = {
    lines: [],
    total: 0,
    byStatus: { booked: 0, pending: 0, estimate: 0 },
    byCategory: {},
    missingRates: [],
    pendingWithoutAmount: 0,
  };
  for (const item of doc.budget) {
    let total: number | null = null;
    if (item.amount) {
      const booking = item.bookingId ? bookings.get(item.bookingId) : undefined;
      total = moneyToTripMinor(
        item.amount,
        ctx,
        nightsBetween(booking?.start.date, booking?.end?.date),
      );
      if (total === null) missing.add(item.amount.currency);
    } else if (item.status === 'pending') {
      summary.pendingWithoutAmount++;
    }
    summary.lines.push({ item, total });
    if (total !== null && item.included) {
      summary.total += total;
      summary.byStatus[item.status] += total;
      summary.byCategory[item.category] = (summary.byCategory[item.category] ?? 0) + total;
    }
  }
  summary.missingRates = [...missing];
  return summary;
}

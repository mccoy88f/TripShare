import type { ExpenseCategory } from '../categories.js';
import { moneyToTripMinor } from './budget.js';
import type { Booking } from './schema.js';

/** Categoria di spesa per tipo di prenotazione. */
export const BOOKING_EXPENSE_CATEGORY: Record<Booking['type'], ExpenseCategory> = {
  flight: 'flights',
  lodging: 'lodging',
  car_rental: 'car',
  parking: 'parking',
  train: 'transport',
  bus: 'transport',
  ferry: 'transport',
  tour: 'activities',
  ticket: 'tickets',
  insurance: 'insurance',
  other: 'other',
};

/** Notti di una prenotazione (almeno una). */
export function bookingNights(b: Pick<Booking, 'start' | 'end'>) {
  if (!b.end?.date) return 1;
  return Math.max(1, Math.round((Date.parse(b.end.date) - Date.parse(b.start.date)) / 86_400_000));
}

/**
 * Importo totale della prenotazione, in unità minori della valuta del suo costo (si moltiplica
 * per persone, notti e quantità). Null se la prenotazione non ha un costo o è a zero.
 */
export function bookingExpenseAmount(
  b: Pick<Booking, 'cost' | 'start' | 'end'>,
  travelers: number,
): { amount: number; currency: NonNullable<Booking['cost']>['currency'] } | null {
  if (!b.cost) return null;
  const amount = moneyToTripMinor(
    b.cost,
    { tripCurrency: b.cost.currency, travelers, days: 1, rates: {} },
    bookingNights(b),
  );
  return amount && amount > 0 ? { amount, currency: b.cost.currency } : null;
}

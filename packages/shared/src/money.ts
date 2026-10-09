import { currencyDecimals, type CurrencyCode } from './currencies.js';
import type { Locale } from './locales.js';

/**
 * Gli importi si salvano sempre in unità minori intere (centesimi) per evitare errori
 * di arrotondamento. Le funzioni qui convertono da e verso unità maggiori.
 */

export function toMinor(amount: number, currency: CurrencyCode): number {
  const factor = 10 ** currencyDecimals(currency);
  return Math.round(amount * factor);
}

export function fromMinor(minor: number, currency: CurrencyCode): number {
  return minor / 10 ** currencyDecimals(currency);
}

export function formatMoney(minor: number, currency: CurrencyCode, locale: Locale): string {
  const decimals = currencyDecimals(currency);
  return new Intl.NumberFormat(locale === 'it' ? 'it-IT' : 'en-GB', {
    style: 'currency',
    currency,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(fromMinor(minor, currency));
}

/**
 * Converte un importo in unità minori con un tasso `rate` (1 unità di `from` = rate unità di `to`).
 */
export function convertMinor(
  minor: number,
  from: CurrencyCode,
  to: CurrencyCode,
  rate: number,
): number {
  if (from === to) return minor;
  return toMinor(fromMinor(minor, from) * rate, to);
}

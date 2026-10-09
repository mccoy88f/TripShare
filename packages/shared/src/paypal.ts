import { CURRENCIES, currencyDecimals, type CurrencyCode } from './currencies.js';

const PAYPAL_ME_USERNAME = /^[A-Za-z0-9]{1,20}$/;

/** Normalizza quello che l'utente inserisce (username, "paypal.me/nome" o URL completo). */
export function normalizePaypalMe(input: string): string | null {
  const trimmed = input
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/^(www\.)?paypal\.me\//i, '');
  const username = trimmed.split(/[/?#]/)[0] ?? '';
  return PAYPAL_ME_USERNAME.test(username) ? username : null;
}

/**
 * Link PayPal.me con importo e valuta precompilati, es. https://paypal.me/marco/42.50EUR.
 * Restituisce null se la valuta non è supportata da PayPal.me.
 */
export function paypalMeLink(
  username: string,
  minor: number,
  currency: CurrencyCode,
): string | null {
  const normalized = normalizePaypalMe(username);
  if (!normalized || !CURRENCIES[currency].paypal || minor <= 0) return null;
  const amount = (minor / 10 ** currencyDecimals(currency)).toFixed(currencyDecimals(currency));
  return `https://paypal.me/${normalized}/${amount}${currency}`;
}

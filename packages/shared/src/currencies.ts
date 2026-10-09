/**
 * Valute ISO 4217 disponibili. `decimals` indica le cifre dopo la virgola (unità minori).
 * `paypal` indica se PayPal.me accetta la valuta.
 */
export const CURRENCIES = {
  EUR: { decimals: 2, symbol: '€', paypal: true },
  USD: { decimals: 2, symbol: '$', paypal: true },
  GBP: { decimals: 2, symbol: '£', paypal: true },
  CHF: { decimals: 2, symbol: 'CHF', paypal: true },
  JPY: { decimals: 0, symbol: '¥', paypal: true },
  CAD: { decimals: 2, symbol: 'CA$', paypal: true },
  AUD: { decimals: 2, symbol: 'A$', paypal: true },
  NZD: { decimals: 2, symbol: 'NZ$', paypal: true },
  SEK: { decimals: 2, symbol: 'kr', paypal: true },
  NOK: { decimals: 2, symbol: 'kr', paypal: true },
  DKK: { decimals: 2, symbol: 'kr', paypal: true },
  PLN: { decimals: 2, symbol: 'zł', paypal: true },
  CZK: { decimals: 2, symbol: 'Kč', paypal: true },
  HUF: { decimals: 2, symbol: 'Ft', paypal: true },
  RON: { decimals: 2, symbol: 'lei', paypal: false },
  BGN: { decimals: 2, symbol: 'лв', paypal: false },
  ISK: { decimals: 0, symbol: 'kr', paypal: false },
  TRY: { decimals: 2, symbol: '₺', paypal: false },
  MXN: { decimals: 2, symbol: 'MX$', paypal: true },
  BRL: { decimals: 2, symbol: 'R$', paypal: true },
  CNY: { decimals: 2, symbol: '¥', paypal: false },
  HKD: { decimals: 2, symbol: 'HK$', paypal: true },
  SGD: { decimals: 2, symbol: 'S$', paypal: true },
  THB: { decimals: 2, symbol: '฿', paypal: true },
  INR: { decimals: 2, symbol: '₹', paypal: false },
  ILS: { decimals: 2, symbol: '₪', paypal: true },
  ZAR: { decimals: 2, symbol: 'R', paypal: false },
  KRW: { decimals: 0, symbol: '₩', paypal: false },
  AED: { decimals: 2, symbol: 'AED', paypal: false },
  MAD: { decimals: 2, symbol: 'MAD', paypal: false },
  EGP: { decimals: 2, symbol: 'E£', paypal: false },
} as const satisfies Record<string, { decimals: number; symbol: string; paypal: boolean }>;

export type CurrencyCode = keyof typeof CURRENCIES;
export const CURRENCY_CODES = Object.keys(CURRENCIES) as CurrencyCode[];
export const DEFAULT_CURRENCY: CurrencyCode = 'EUR';

export function isCurrencyCode(value: unknown): value is CurrencyCode {
  return typeof value === 'string' && value in CURRENCIES;
}

export function currencyDecimals(code: CurrencyCode): number {
  return CURRENCIES[code].decimals;
}

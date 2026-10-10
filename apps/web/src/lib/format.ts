import { formatMoney, isCurrencyCode, type CurrencyCode, type Locale } from '@tripshare/shared';
import { currentLocale } from './i18n';

export function money(minor: number, currency: string, locale: Locale = currentLocale()) {
  return formatMoney(minor, (isCurrencyCode(currency) ? currency : 'EUR') as CurrencyCode, locale);
}

export function shortDate(iso: string | null | undefined, locale: Locale = currentLocale()) {
  if (!iso) return '';
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(
    new Date(`${iso}T12:00:00`),
  );
}

export function longDate(iso: string, locale: Locale = currentLocale()) {
  return new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long' }).format(
    new Date(`${iso}T12:00:00`),
  );
}

export function dateRange(
  start: string | null,
  end: string | null,
  locale: Locale = currentLocale(),
) {
  if (!start) return '';
  if (!end || end === start) return shortDate(start, locale);
  return `${shortDate(start, locale)} – ${shortDate(end, locale)}`;
}

export function todayIso() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

/** "2 min fa", "ieri": tempo trascorso da una data, nella lingua dell'app. */
export function timeAgo(date: string | Date, locale: Locale = currentLocale()) {
  const seconds = Math.round((new Date(date).getTime() - Date.now()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
  ];
  for (const [unit, size] of steps)
    if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit);
  return rtf.format(0, 'second');
}

export const LOCALES = ['it', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'it';

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/** Sceglie la lingua supportata più adatta da un header Accept-Language o da navigator.languages. */
export function pickLocale(candidates: readonly string[] | string | undefined | null): Locale {
  const list =
    typeof candidates === 'string'
      ? candidates.split(',').map((part) => part.split(';')[0]!.trim())
      : (candidates ?? []);
  for (const tag of list) {
    const base = tag.toLowerCase().split('-')[0];
    if (isLocale(base)) return base;
  }
  return DEFAULT_LOCALE;
}

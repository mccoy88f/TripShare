import type { CurrencyCode } from '@tripshare/shared';

/**
 * Tassi di cambio dalla Banca Centrale Europea tramite l'API pubblica Frankfurter.
 * I tassi vengono tenuti in memoria per 6 ore (per giorno e coppia di valute).
 */
const cache = new Map<string, { rate: number; at: number }>();
const TTL = 6 * 3600 * 1000;

export interface FxResult {
  rate: number;
  /** Data a cui si riferisce il tasso (la BCE non pubblica nei festivi). */
  date: string;
  source: 'ecb' | 'identity';
}

export async function getRate(
  from: CurrencyCode,
  to: CurrencyCode,
  date?: string,
  fetchImpl: typeof fetch = fetch,
): Promise<FxResult> {
  if (from === to)
    return { rate: 1, date: date ?? new Date().toISOString().slice(0, 10), source: 'identity' };
  const today = new Date().toISOString().slice(0, 10);
  const day = !date || date > today ? 'latest' : date;
  const key = `${day}:${from}:${to}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL)
    return { rate: hit.rate, date: day === 'latest' ? today : day, source: 'ecb' };

  const res = await fetchImpl(`https://api.frankfurter.app/${day}?from=${from}&to=${to}`, {
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`FX_UNAVAILABLE_${res.status}`);
  const body = (await res.json()) as { date: string; rates: Record<string, number> };
  const rate = body.rates[to];
  if (!rate) throw new Error('FX_UNSUPPORTED_CURRENCY');
  cache.set(key, { rate, at: Date.now() });
  return { rate, date: body.date, source: 'ecb' };
}

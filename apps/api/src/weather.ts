/**
 * Meteo dei giorni del viaggio da Open-Meteo (gratuito, senza chiave): previsioni fino a 16
 * giorni, con alba e tramonto. La località si ottiene dal nome della destinazione.
 */
const cache = new Map<string, { at: number; value: unknown }>();
const TTL = 3600 * 1000;

async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.value as T;
  const value = await load();
  cache.set(key, { at: Date.now(), value });
  return value;
}

export interface GeoPoint {
  name: string;
  country?: string;
  lat: number;
  lng: number;
}

export async function geocode(
  query: string,
  language: string,
  fetchImpl: typeof fetch = fetch,
): Promise<GeoPoint | null> {
  // Si prova con il nome completo e poi con la parte prima della virgola ("Highlands, Scozia").
  const candidates = [query, query.split(',')[0]!.trim()].filter(
    (q, i, a) => q && a.indexOf(q) === i,
  );
  for (const q of candidates) {
    const result = await cached(`geo:${language}:${q.toLowerCase()}`, async () => {
      const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=1&language=${language}&format=json`;
      const res = await fetchImpl(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`GEOCODING_${res.status}`);
      const body = (await res.json()) as {
        results?: { name: string; country?: string; latitude: number; longitude: number }[];
      };
      const r = body.results?.[0];
      return r ? { name: r.name, country: r.country, lat: r.latitude, lng: r.longitude } : null;
    });
    if (result) return result;
  }
  return null;
}

export interface DayWeather {
  date: string;
  code: number;
  max: number;
  min: number;
  precipitation: number | null;
  sunrise: string | null;
  sunset: string | null;
}

export async function forecast(
  point: { lat: number; lng: number },
  start: string,
  end: string,
  fetchImpl: typeof fetch = fetch,
): Promise<DayWeather[]> {
  const key = `fc:${point.lat.toFixed(2)},${point.lng.toFixed(2)}:${start}:${end}`;
  return cached(key, async () => {
    const params = new URLSearchParams({
      latitude: String(point.lat),
      longitude: String(point.lng),
      daily:
        'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset',
      timezone: 'auto',
      start_date: start,
      end_date: end,
    });
    const res = await fetchImpl(`https://api.open-meteo.com/v1/forecast?${params}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`FORECAST_${res.status}`);
    const d = ((await res.json()) as { daily?: Record<string, unknown[]> }).daily;
    if (!d?.time) return [];
    return (d.time as string[]).map((date, i) => ({
      date,
      code: Number(d.weather_code?.[i] ?? 0),
      max: Number(d.temperature_2m_max?.[i]),
      min: Number(d.temperature_2m_min?.[i]),
      precipitation:
        d.precipitation_probability_max?.[i] == null
          ? null
          : Number(d.precipitation_probability_max[i]),
      sunrise: (d.sunrise?.[i] as string | undefined)?.slice(11, 16) ?? null,
      sunset: (d.sunset?.[i] as string | undefined)?.slice(11, 16) ?? null,
    }));
  });
}

/** Le previsioni coprono da oggi a 15 giorni avanti. */
export function forecastWindow(
  start: string,
  end: string,
  today = new Date().toISOString().slice(0, 10),
) {
  const limit = new Date(`${today}T12:00:00Z`);
  limit.setUTCDate(limit.getUTCDate() + 15);
  const maxDay = limit.toISOString().slice(0, 10);
  const from = start < today ? today : start;
  const to = end > maxDay ? maxDay : end;
  return from <= to ? { from, to } : null;
}

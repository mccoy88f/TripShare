/**
 * Ricerca di luoghi e "reverse lookup" (da coordinate a nome) su OpenStreetMap Nominatim.
 * Il servizio pubblico chiede: al massimo una richiesta al secondo, un User-Agent che identifichi
 * l'app e nessuna ricerca "mentre si scrive". Per questo le richieste passano dal server, in
 * coda e con una cache.
 */
const BASE = (process.env.NOMINATIM_URL ?? 'https://nominatim.openstreetmap.org').replace(
  /\/$/,
  '',
);
const USER_AGENT = 'TripShare/1.0 (+https://github.com/mccoy88f/TripShare)';
const MIN_INTERVAL_MS = process.env.NODE_ENV === 'test' ? 0 : 1100;
const CACHE_TTL_MS = 60 * 60 * 1000;
const CACHE_MAX = 500;

export interface PlaceHit {
  /** Nome breve, es. "Edinburgh Castle, Edimburgo". */
  label: string;
  /** Indirizzo completo. */
  detail: string;
  lat: number;
  lon: number;
}

interface NominatimItem {
  name?: string;
  display_name?: string;
  lat?: string;
  lon?: string;
  address?: Record<string, string>;
}

const cache = new Map<string, { at: number; value: unknown }>();
let chain: Promise<unknown> = Promise.resolve();
let last = 0;

/** Mette le richieste in fila, a distanza di almeno un secondo l'una dall'altra. */
function queued<T>(task: () => Promise<T>): Promise<T> {
  const run = async () => {
    const wait = last + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    try {
      return await task();
    } finally {
      last = Date.now();
    }
  };
  const next = chain.then(run, run);
  chain = next.catch(() => undefined);
  return next;
}

async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value as T;
  const value = await queued(load);
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  cache.set(key, { at: Date.now(), value });
  return value;
}

/** "Edinburgh Castle, Edimburgo" o "Edimburgo, Regno Unito": nome del luogo e zona. */
function labelOf(item: NominatimItem): string {
  const a = item.address ?? {};
  const area =
    a.city ?? a.town ?? a.village ?? a.municipality ?? a.hamlet ?? a.suburb ?? a.county ?? a.state;
  const parts = [item.name, area, !item.name || item.name === area ? a.country : undefined].filter(
    (p, i, all): p is string => !!p && all.indexOf(p) === i,
  );
  return parts.join(', ') || (item.display_name ?? '').split(',').slice(0, 2).join(',').trim();
}

async function get(path: string, language: string, fetchImpl: typeof fetch) {
  const res = await fetchImpl(
    `${BASE}${path}&format=jsonv2&addressdetails=1&accept-language=${language}`,
    {
      headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!res.ok) throw new Error(`NOMINATIM_${res.status}`);
  return res.json() as Promise<unknown>;
}

export function searchPlaces(
  query: string,
  language: string,
  fetchImpl: typeof fetch = fetch,
): Promise<PlaceHit[]> {
  const q = query.trim().toLowerCase();
  return cached(`s:${language}:${q}`, async () => {
    const items = (await get(
      `/search?q=${encodeURIComponent(query.trim())}&limit=6`,
      language,
      fetchImpl,
    )) as NominatimItem[];
    return items
      .filter((i) => i.lat && i.lon)
      .map((i) => ({
        label: labelOf(i),
        detail: i.display_name ?? '',
        lat: Number(i.lat),
        lon: Number(i.lon),
      }));
  });
}

export function reversePlace(
  lat: number,
  lon: number,
  language: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  // Coordinate arrotondate (circa 100 m): si sfrutta meglio la cache.
  const la = lat.toFixed(3);
  const lo = lon.toFixed(3);
  return cached(`r:${language}:${la}:${lo}`, async () => {
    const item = (await get(
      `/reverse?lat=${la}&lon=${lo}&zoom=16`,
      language,
      fetchImpl,
    )) as NominatimItem & {
      error?: string;
    };
    if (item.error) return null;
    return labelOf(item) || null;
  });
}

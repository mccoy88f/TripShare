/**
 * Ricerca di foto di luoghi su Wikimedia Commons: libere, senza chiave, con autore e licenza.
 * Le foto scelte vengono scaricate e salvate su TripShare.
 */
interface PhotoResult {
  thumb: string;
  /** Indirizzo dell'immagine da scaricare quando viene scelta. */
  full: string;
  title: string;
  /** Sito di provenienza (dominio). */
  source: string;
  /** Autore e licenza. */
  credit?: string;
}

const COMMONS = () => process.env.COMMONS_BASE_URL ?? 'https://commons.wikimedia.org';

const text = (html: string | undefined) =>
  (html ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

interface CommonsPage {
  title?: string;
  imageinfo?: {
    thumburl?: string;
    url?: string;
    mime?: string;
    width?: number;
    descriptionurl?: string;
    extmetadata?: Record<string, { value?: string } | undefined>;
  }[];
}

/** Cerca foto su Wikimedia Commons (senza chiave; serve solo uno user-agent riconoscibile). */
export async function searchCommons(
  query: string,
  appName: string,
  fetchImpl: typeof fetch = fetch,
  paging: { limit?: number; offset?: number } = {},
): Promise<PhotoResult[]> {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    generator: 'search',
    gsrsearch: query,
    gsrnamespace: '6',
    gsrlimit: String(paging.limit ?? 30),
    gsroffset: String(paging.offset ?? 0),
    prop: 'imageinfo',
    iiprop: 'url|mime|size|extmetadata',
    // Wikimedia genera le miniature solo per larghezze fisse (330, 960…): altre danno errore.
    iiurlwidth: '960',
    iiextmetadatafilter: 'Artist|LicenseShortName|ImageDescription',
  });
  const res = await fetchImpl(`${COMMONS()}/w/api.php?${params}`, {
    headers: {
      'user-agent': `${appName}/1.0 (self-hosted trip planner)`,
      accept: 'application/json',
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 429) throw new Error('COMMONS_RATE_LIMIT');
  if (!res.ok) throw new Error(`COMMONS_HTTP_${res.status}`);
  const data = (await res.json()) as {
    query?: { pages?: Record<string, CommonsPage & { index?: number }> };
  };
  const pages = Object.values(data.query?.pages ?? {}).sort(
    (a, b) => (a.index ?? 0) - (b.index ?? 0),
  );
  const out: PhotoResult[] = [];
  for (const page of pages) {
    const info = page.imageinfo?.[0];
    if (!info?.thumburl || !/^image\/(jpeg|png|webp)$/.test(info.mime ?? '')) continue;
    const meta = info.extmetadata ?? {};
    const artist = text(meta.Artist?.value);
    const license = text(meta.LicenseShortName?.value);
    out.push({
      // Anteprima da 330 px (larghezza ammessa da Wikimedia), se l'originale è più largo.
      thumb: (info.width ?? 0) > 330 ? info.thumburl.replace(/\/\d+px-/, '/330px-') : info.thumburl,
      full: info.thumburl,
      title: (page.title ?? '')
        .replace(/^File:/, '')
        .replace(/\.[a-z]+$/i, '')
        .replace(/_/g, ' '),
      source: 'commons.wikimedia.org',
      credit: [artist, license].filter(Boolean).join(' · ').slice(0, 160) || 'Wikimedia Commons',
    });
  }
  return out;
}

interface SearxResult {
  img_src?: string;
  thumbnail_src?: string;
  thumbnail?: string;
  title?: string;
  url?: string;
  engine?: string;
}

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

/**
 * Cerca immagini sul web tramite SearXNG (metamotore self-hosted, senza chiavi né AI). Il
 * credito è il sito di provenienza: a differenza di Commons non c'è una licenza garantita.
 */
export async function searchWeb(
  query: string,
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
  page = 0,
): Promise<PhotoResult[]> {
  const params = new URLSearchParams({
    q: query,
    format: 'json',
    categories: 'images',
    safesearch: '1',
    pageno: String(page + 1),
  });
  const res = await fetchImpl(`${baseUrl.replace(/\/+$/, '')}/search?${params}`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`SEARXNG_HTTP_${res.status}`);
  const data = (await res.json()) as { results?: SearxResult[] };
  const seen = new Set<string>();
  const out: PhotoResult[] = [];
  for (const r of data.results ?? []) {
    const full = r.img_src;
    if (!full || !/^https:\/\//i.test(full) || seen.has(full)) continue;
    seen.add(full);
    out.push({
      thumb: r.thumbnail_src ?? r.thumbnail ?? full,
      full,
      title: text(r.title),
      source: hostOf(r.url ?? full),
      credit: hostOf(r.url ?? full) || undefined,
    });
  }
  return out;
}

/** Foto per pagina della galleria, e quante di queste si chiedono a Commons. */
const PAGE_SIZE = 10;
const PAGE_COMMONS = 5;

/** Tipi di luogo che Commons copre poco: per loro il web viene prima. */
export const WEB_FIRST_KINDS = new Set<string>(['restaurant', 'cafe', 'bar', 'shop', 'other']);

const STOP_WORDS = new Set(['the', 'and', 'del', 'della', 'dei', 'delle', 'degli', 'dello', 'di']);

const words = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w));

/**
 * Il titolo del file contiene le parole principali del nome del luogo? Commons cerca per parole
 * sparse: senza questo controllo un ristorante può ricevere la foto di un piatto o di un'altra via.
 */
export function titleMatchesName(title: string, name: string): boolean {
  const wanted = words(name);
  if (wanted.length === 0) return true;
  const have = new Set(words(title));
  const found = wanted.filter((w) => have.has(w)).length;
  return found >= Math.max(1, Math.ceil(wanted.length * 0.6));
}

/**
 * Ripulisce il testo da cercare: `&`, `!`, `:`, virgolette e simili hanno un significato per i
 * motori (operatori, "bang" di SearXNG come `!g` o `:it`) e rovinerebbero i risultati.
 */
export function cleanQuery(query: string): string {
  return query
    .replace(/&/g, ' e ')
    .replace(/[^\p{L}\p{N}\s'.,-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

/**
 * Foto per un luogo: Wikimedia Commons (libere, con autore) e il web via SearXNG, se è
 * configurato. Una fonte che non risponde non blocca l'altra.
 *
 * - `name`: se dato, le foto di Commons si tengono solo se il titolo corrisponde al luogo.
 * - `webFirst`: i risultati del web vengono prima di quelli di Commons (ristoranti, negozi…).
 */
export async function searchPhotos(opts: {
  query: string;
  appName: string;
  searxngUrl?: string;
  fetch?: typeof fetch;
  name?: string;
  webFirst?: boolean;
  /**
   * Pagina (da 0) per la galleria: ogni pagina dà al massimo 10 foto, circa metà da Commons e il
   * resto dal web. Senza, si restituisce un elenco unico più lungo.
   */
  page?: number;
  /** Quanti risultati restituire al massimo. */
  limit?: number;
}): Promise<PhotoResult[]> {
  const paged = opts.page !== undefined;
  const query = cleanQuery(opts.query);
  if (query.length < 2) return [];
  const [commons, web] = await Promise.allSettled([
    searchCommons(
      query,
      opts.appName,
      opts.fetch,
      paged ? { limit: PAGE_COMMONS, offset: opts.page! * PAGE_COMMONS } : {},
    ),
    opts.searxngUrl
      ? searchWeb(query, opts.searxngUrl, opts.fetch, opts.page ?? 0)
      : Promise.resolve([]),
  ]);
  if (commons.status === 'rejected' && web.status === 'rejected') throw commons.reason;
  const name = opts.name;
  const fromCommons = (commons.status === 'fulfilled' ? commons.value : []).filter(
    (p) => !name || titleMatchesName(p.title, name),
  );
  const fromWeb = web.status === 'fulfilled' ? web.value : [];
  const all = opts.webFirst ? [...fromWeb, ...fromCommons] : [...fromCommons, ...fromWeb];
  return all.slice(0, opts.limit ?? (paged ? PAGE_SIZE : 30));
}

import type { BraveImage } from './brave.js';

/**
 * Fonti di foto senza chiave a pagamento: Wikimedia Commons (foto libere, con autore e licenza)
 * e un'istanza SearXNG propria (metamotore ospitato dal super admin).
 */
export type PhotoResult = BraveImage;

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
    descriptionurl?: string;
    extmetadata?: Record<string, { value?: string } | undefined>;
  }[];
}

/** Cerca foto su Wikimedia Commons (senza chiave; serve solo uno user-agent riconoscibile). */
export async function searchCommons(
  query: string,
  appName: string,
  fetchImpl: typeof fetch = fetch,
): Promise<PhotoResult[]> {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    generator: 'search',
    gsrsearch: query,
    gsrnamespace: '6',
    gsrlimit: '30',
    prop: 'imageinfo',
    iiprop: 'url|mime|extmetadata',
    iiurlwidth: '1200',
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
      // La miniatura 1200 px è già abbastanza grande: si usa anche come anteprima ridotta.
      thumb: info.thumburl.replace(/\/\d+px-/, '/360px-'),
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
  title?: string;
  img_src?: string;
  thumbnail_src?: string;
  thumbnail?: string;
  url?: string;
}

/** Cerca immagini su un'istanza SearXNG (API JSON, da abilitare in settings.yml). */
export async function searchSearxng(
  baseUrl: string,
  query: string,
  language: string,
  fetchImpl: typeof fetch = fetch,
): Promise<PhotoResult[]> {
  const params = new URLSearchParams({
    q: query,
    format: 'json',
    categories: 'images',
    language,
    safesearch: '2',
  });
  const res = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/search?${params}`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 403) throw new Error('SEARXNG_JSON_DISABLED');
  if (res.status === 429) throw new Error('SEARXNG_RATE_LIMIT');
  if (!res.ok) throw new Error(`SEARXNG_HTTP_${res.status}`);
  const data = (await res.json()) as { results?: SearxResult[] };
  const out: PhotoResult[] = [];
  for (const r of data.results ?? []) {
    const full = r.img_src;
    const thumb = r.thumbnail_src ?? r.thumbnail ?? full;
    if (!full?.startsWith('https://') || !thumb) continue;
    const source = (() => {
      try {
        return new URL(r.url ?? full).hostname.replace(/^www\./, '');
      } catch {
        return '';
      }
    })();
    out.push({ thumb, full, title: r.title ?? '', source });
    if (out.length >= 30) break;
  }
  return out;
}

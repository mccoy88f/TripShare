/**
 * Ricerca di foto di luoghi su Wikimedia Commons: libere, senza chiave, con autore e licenza.
 * Le foto scelte vengono scaricate e salvate su TripShare.
 */
export interface PhotoResult {
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
): Promise<PhotoResult[]> {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    generator: 'search',
    gsrsearch: query,
    gsrnamespace: '6',
    gsrlimit: '30',
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

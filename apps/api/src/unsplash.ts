/**
 * Ricerca foto su Unsplash per le copertine. Serve solo la "Access Key" dell'applicazione
 * Unsplash (non la Secret Key né l'Application ID). Come richiesto dalle linee guida delle API:
 * si cita l'autore e si segnala il download all'endpoint `download_location`.
 */
const BASE = 'https://api.unsplash.com';

export interface UnsplashPhoto {
  id: string;
  thumb: string;
  description: string | null;
  author: string;
  authorUrl: string;
  color: string | null;
}

interface RawPhoto {
  id: string;
  color?: string | null;
  alt_description?: string | null;
  description?: string | null;
  urls: { small: string; regular: string };
  links: { download_location: string };
  user: { name: string; links: { html: string } };
}

/** Link all'autore e a Unsplash con i parametri UTM richiesti. */
const utm = (url: string, app: string) =>
  `${url}${url.includes('?') ? '&' : '?'}utm_source=${encodeURIComponent(app)}&utm_medium=referral`;

async function call<T>(path: string, key: string, fetchImpl: typeof fetch): Promise<T> {
  const res = await fetchImpl(`${BASE}${path}`, {
    headers: { authorization: `Client-ID ${key}`, 'accept-version': 'v1' },
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 401 || res.status === 403) throw new Error('UNSPLASH_INVALID_KEY');
  if (!res.ok) throw new Error(`UNSPLASH_HTTP_${res.status}`);
  return (await res.json()) as T;
}

export async function searchPhotos(
  key: string,
  query: string,
  app: string,
  fetchImpl: typeof fetch = fetch,
): Promise<UnsplashPhoto[]> {
  const data = await call<{ results: RawPhoto[] }>(
    `/search/photos?query=${encodeURIComponent(query)}&per_page=18&orientation=landscape&content_filter=high`,
    key,
    fetchImpl,
  );
  return data.results.map((p) => ({
    id: p.id,
    thumb: p.urls.small,
    description: p.alt_description ?? p.description ?? null,
    author: p.user.name,
    authorUrl: utm(p.user.links.html, app),
    color: p.color ?? null,
  }));
}

/** Scarica la foto scelta (formato "regular", ~1080 px) e registra il download su Unsplash. */
export async function downloadPhoto(
  key: string,
  id: string,
  app: string,
  fetchImpl: typeof fetch = fetch,
) {
  const photo = await call<RawPhoto>(`/photos/${encodeURIComponent(id)}`, key, fetchImpl);
  const res = await fetchImpl(photo.urls.regular, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`UNSPLASH_HTTP_${res.status}`);
  const image = Buffer.from(await res.arrayBuffer());
  // Segnalazione del download obbligatoria; un errore qui non blocca la copertina.
  await fetchImpl(photo.links.download_location, {
    headers: { authorization: `Client-ID ${key}` },
    signal: AbortSignal.timeout(10_000),
  }).catch(() => undefined);
  return {
    image,
    credit: { name: photo.user.name, url: utm(photo.user.links.html, app) },
  };
}

export const unsplashHome = (app: string) => utm('https://unsplash.com/', app);

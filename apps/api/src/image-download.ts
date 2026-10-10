import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/** Indirizzi non pubblici (rete locale, loopback, link-local, metadati cloud). */
function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    if (
      v === '::1' ||
      v === '::' ||
      v.startsWith('fc') ||
      v.startsWith('fd') ||
      v.startsWith('fe80')
    )
      return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
    return mapped ? isPrivateAddress(mapped[1]!) : false;
  }
  const [a = 0, b = 0] = ip.split('.').map(Number);
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  );
}

export class ImageDownloadError extends Error {}

/** Molti siti (Wikimedia in testa) rifiutano le richieste senza uno user-agent riconoscibile. */
const USER_AGENT =
  'Mozilla/5.0 (compatible; TripShareBot/1.0; +https://github.com/mccoy88f/TripShare)';

interface Fetched {
  data: Buffer;
  contentType: string;
  url: string;
}

/**
 * Scarica un indirizzo https pubblico: rifiuta host locali o privati (anche dopo i
 * reindirizzamenti), accetta solo i tipi di contenuto indicati e si ferma oltre il limite.
 */
async function safeGet(
  url: string,
  options: { accept: string; allowed: (type: string) => boolean; maxBytes: number },
  fetchImpl: typeof fetch,
): Promise<Fetched> {
  let current = url;
  for (let hop = 0; hop < 4; hop++) {
    let parsed: URL;
    try {
      parsed = new URL(current);
    } catch {
      throw new ImageDownloadError('INVALID_URL');
    }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password)
      throw new ImageDownloadError('INVALID_URL');
    const host = parsed.hostname.replace(/^\[|\]$/g, '');
    const addresses = isIP(host)
      ? [host]
      : (await lookup(host, { all: true }).catch(() => [])).map((a) => a.address);
    if (addresses.length === 0 || addresses.some(isPrivateAddress))
      throw new ImageDownloadError('INVALID_URL');

    const res = await fetchImpl(current, {
      redirect: 'manual',
      headers: { accept: options.accept, 'user-agent': USER_AGENT },
      signal: AbortSignal.timeout(20_000),
    }).catch(() => {
      throw new ImageDownloadError('DOWNLOAD_FAILED');
    });
    if (res.status >= 300 && res.status < 400) {
      const next = res.headers.get('location');
      if (!next) throw new ImageDownloadError('DOWNLOAD_FAILED');
      current = new URL(next, current).toString();
      continue;
    }
    if (!res.ok) throw new ImageDownloadError('DOWNLOAD_FAILED');
    const contentType = (res.headers.get('content-type') ?? '').toLowerCase();
    if (!options.allowed(contentType)) throw new ImageDownloadError('NOT_AN_IMAGE');
    const length = Number(res.headers.get('content-length') ?? 0);
    if (length > options.maxBytes) throw new ImageDownloadError('FILE_TOO_LARGE');
    const reader = res.body?.getReader();
    if (!reader) throw new ImageDownloadError('DOWNLOAD_FAILED');
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > options.maxBytes) {
        await reader.cancel();
        throw new ImageDownloadError('FILE_TOO_LARGE');
      }
      chunks.push(value);
    }
    return { data: Buffer.concat(chunks), contentType, url: current };
  }
  throw new ImageDownloadError('DOWNLOAD_FAILED');
}

const isImage = (type: string) => type.startsWith('image/');

/** Scarica un'immagine da un indirizzo https pubblico. */
export async function downloadImage(
  url: string,
  maxBytes: number,
  fetchImpl: typeof fetch = fetch,
): Promise<Buffer> {
  const { data } = await safeGet(url, { accept: 'image/*', allowed: isImage, maxBytes }, fetchImpl);
  return data;
}

/** Indirizzo dell'immagine di anteprima dichiarata da una pagina (Open Graph o Twitter). */
export function pageImageUrl(html: string, base: string): string | null {
  const metas = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const wanted of ['og:image:secure_url', 'og:image', 'twitter:image', 'twitter:image:src']) {
    for (const tag of metas) {
      const key = /(?:property|name)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase();
      if (key !== wanted) continue;
      const content = /content\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
      if (!content) continue;
      try {
        return new URL(content.replace(/&amp;/g, '&'), base).toString();
      } catch {
        // indirizzo non valido: si prova il successivo
      }
    }
  }
  return null;
}

/**
 * Come downloadImage, ma accetta anche l'indirizzo di una pagina web: ne legge l'immagine di
 * anteprima (Open Graph) e scarica quella. Utile con gli indirizzi proposti dall'AI, che spesso
 * sono pagine (Wikipedia, siti turistici) e non il file dell'immagine.
 */
export async function downloadImageFromAnyUrl(
  url: string,
  maxBytes: number,
  fetchImpl: typeof fetch = fetch,
): Promise<Buffer> {
  const first = await safeGet(
    url,
    {
      accept: 'image/*,text/html;q=0.8',
      allowed: (t) => isImage(t) || t.startsWith('text/html'),
      maxBytes: Math.max(maxBytes, 1_500_000),
    },
    fetchImpl,
  );
  if (isImage(first.contentType)) {
    if (first.data.length > maxBytes) throw new ImageDownloadError('FILE_TOO_LARGE');
    return first.data;
  }
  const image = pageImageUrl(first.data.toString('utf8', 0, 400_000), first.url);
  if (!image) throw new ImageDownloadError('NOT_AN_IMAGE');
  return downloadImage(image, maxBytes, fetchImpl);
}

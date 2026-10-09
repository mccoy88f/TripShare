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

/**
 * Scarica un'immagine da un indirizzo https pubblico: rifiuta host locali o privati (anche dopo
 * i reindirizzamenti), accetta solo contenuti immagine e si ferma oltre il limite di dimensione.
 */
export async function downloadImage(
  url: string,
  maxBytes: number,
  fetchImpl: typeof fetch = fetch,
): Promise<Buffer> {
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
      headers: { accept: 'image/*' },
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
    if (!(res.headers.get('content-type') ?? '').startsWith('image/'))
      throw new ImageDownloadError('NOT_AN_IMAGE');
    const length = Number(res.headers.get('content-length') ?? 0);
    if (length > maxBytes) throw new ImageDownloadError('FILE_TOO_LARGE');
    const reader = res.body?.getReader();
    if (!reader) throw new ImageDownloadError('DOWNLOAD_FAILED');
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) {
        await reader.cancel();
        throw new ImageDownloadError('FILE_TOO_LARGE');
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  }
  throw new ImageDownloadError('DOWNLOAD_FAILED');
}

import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import exifr from 'exifr';
import sharp from 'sharp';

const run = promisify(execFile);
const FFMPEG = process.env.FFMPEG_PATH ?? 'ffmpeg';
const FFPROBE = process.env.FFPROBE_PATH ?? 'ffprobe';

/** Durata massima di un video di un ricordo. */
export const MAX_VIDEO_SECONDS = 120;

export interface MediaMeta {
  takenAt: Date | null;
  lat: number | null;
  lon: number | null;
  width: number | null;
  height: number | null;
  durationSec: number | null;
}

export class MediaError extends Error {
  constructor(readonly code: 'UNSUPPORTED_MEDIA' | 'VIDEO_TOO_LONG' | 'VIDEO_UNREADABLE') {
    super(code);
  }
}

const finite = (n: unknown): number | null =>
  typeof n === 'number' && Number.isFinite(n) ? n : null;

/** "+02:00" → minuti dal meridiano di Greenwich. */
function offsetMinutes(offset: unknown): number {
  const m = typeof offset === 'string' ? /^([+-])(\d{2}):?(\d{2})$/.exec(offset.trim()) : null;
  if (!m) return 0;
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
}

/**
 * Foto: la ridimensiona (max 2400 px) e ne crea l'anteprima, entrambe in WebP e senza metadati;
 * data e posizione dello scatto, se presenti, si leggono dall'EXIF e restano solo nei campi.
 */
export async function processPhoto(
  input: Buffer,
): Promise<{ full: Buffer; thumb: Buffer; meta: MediaMeta }> {
  const base = () => sharp(input, { failOn: 'error', limitInputPixels: 100_000_000 }).rotate();
  let full: Buffer;
  let thumb: Buffer;
  let size: { width: number; height: number };
  try {
    const out = await base()
      .resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true });
    full = out.data;
    size = { width: out.info.width, height: out.info.height };
    thumb = await base()
      .resize({ width: 640, height: 640, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 74 })
      .toBuffer();
  } catch {
    throw new MediaError('UNSUPPORTED_MEDIA');
  }
  const exif = (await exifr
    .parse(input, {
      gps: true,
      pick: ['DateTimeOriginal', 'CreateDate', 'OffsetTimeOriginal', 'OffsetTime'],
    })
    .catch(() => null)) as Record<string, unknown> | null;
  const gps = (await exifr.gps(input).catch(() => null)) as {
    latitude?: number;
    longitude?: number;
  } | null;
  const raw = exif?.DateTimeOriginal ?? exif?.CreateDate;
  let takenAt: Date | null = null;
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    // L'EXIF ha l'ora locale dello scatto senza fuso: si ricompone con lo scarto, se indicato.
    const wall = Date.UTC(
      raw.getFullYear(),
      raw.getMonth(),
      raw.getDate(),
      raw.getHours(),
      raw.getMinutes(),
      raw.getSeconds(),
    );
    takenAt = new Date(wall - offsetMinutes(exif?.OffsetTimeOriginal ?? exif?.OffsetTime) * 60_000);
  }
  return {
    full,
    thumb,
    meta: {
      takenAt,
      lat: finite(gps?.latitude),
      lon: finite(gps?.longitude),
      width: size.width,
      height: size.height,
      durationSec: null,
    },
  };
}

/** "+45.4642+009.1900+120.0/" (ISO 6709) → coordinate. */
export function parseIso6709(text: unknown): { lat: number; lon: number } | null {
  if (typeof text !== 'string') return null;
  const m = /([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)/.exec(text);
  if (!m) return null;
  const lat = Number(m[1]);
  const lon = Number(m[2]);
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

interface ProbeOutput {
  format?: { duration?: string; tags?: Record<string, string> };
  streams?: {
    codec_type?: string;
    width?: number;
    height?: number;
    tags?: Record<string, string>;
  }[];
}

/** Legge durata, dimensioni, data e posizione di un video con ffprobe. */
export async function probeVideo(file: string): Promise<MediaMeta> {
  let out: ProbeOutput;
  try {
    const { stdout } = await run(
      FFPROBE,
      ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file],
      { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 },
    );
    out = JSON.parse(stdout) as ProbeOutput;
  } catch {
    throw new MediaError('VIDEO_UNREADABLE');
  }
  const video = out.streams?.find((s) => s.codec_type === 'video');
  if (!video) throw new MediaError('VIDEO_UNREADABLE');
  const tags = { ...video.tags, ...out.format?.tags };
  const position = parseIso6709(
    tags['com.apple.quicktime.location.ISO6709'] ?? tags['location'] ?? tags['location-eng'],
  );
  const created = tags['com.apple.quicktime.creationdate'] ?? tags['creation_time'];
  const takenAt = created ? new Date(created) : null;
  return {
    takenAt: takenAt && !Number.isNaN(takenAt.getTime()) ? takenAt : null,
    lat: position?.lat ?? null,
    lon: position?.lon ?? null,
    width: finite(video.width),
    height: finite(video.height),
    durationSec: finite(Number(out.format?.duration)),
  };
}

/** Immagine di anteprima di un video (fotogramma a 1 secondo o all'inizio), in WebP. */
export async function videoPoster(file: string, durationSec: number | null): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), 'poster-'));
  try {
    const out = join(dir, 'poster.jpg');
    const at = durationSec && durationSec > 2 ? '1' : '0';
    await run(FFMPEG, ['-v', 'error', '-ss', at, '-i', file, '-frames:v', '1', out], {
      timeout: 30_000,
    });
    return await sharp(await readFile(out))
      .rotate()
      .resize({ width: 640, height: 640, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 74 })
      .toBuffer();
  } catch {
    throw new MediaError('VIDEO_UNREADABLE');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Ricodifica in MP4 (H.264 + AAC, max 1280 px): si apre su qualunque browser e telefono. */
export async function transcodeVideo(input: string, output: string): Promise<void> {
  const scale =
    "scale=w='if(gt(iw,ih),min(1280,iw),-2)':h='if(gt(iw,ih),-2,min(1280,ih))':force_original_aspect_ratio=decrease";
  await run(
    FFMPEG,
    [
      '-y',
      '-v',
      'error',
      '-i',
      input,
      '-t',
      String(MAX_VIDEO_SECONDS + 5),
      '-vf',
      `${scale},scale=trunc(iw/2)*2:trunc(ih/2)*2`,
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '26',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-movflags',
      '+faststart',
      output,
    ],
    { timeout: 15 * 60_000 },
  );
}

/** Scrive un buffer in un file temporaneo e lo passa a `fn`. */
export async function withTempFile<T>(
  data: Buffer,
  extension: string,
  fn: (path: string) => Promise<T>,
): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'media-'));
  try {
    const path = join(dir, `input.${extension}`);
    await writeFile(path, data);
    return await fn(path);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

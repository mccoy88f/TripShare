import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';

/**
 * Archivio dei file caricati (foto profilo e copertine) su disco, in UPLOADS_DIR.
 * I nomi sono casuali (128 bit) e non indovinabili; le immagini vengono ridimensionate,
 * convertite in WebP e ripulite dai metadati (EXIF, posizione).
 */
export const IMAGE_PRESETS = {
  avatar: { width: 512, height: 512, fit: 'cover' as const },
  cover: { width: 1600, height: 900, fit: 'cover' as const },
  place: { width: 1200, height: 800, fit: 'cover' as const },
};
export type ImagePreset = keyof typeof IMAGE_PRESETS;

const NAME = /^[a-z]+-[a-f0-9]{32}\.webp$/;
const PRIVATE_NAME = /^[a-f0-9]{32}\.[a-z0-9]{1,8}$/;

export class FileStorage {
  constructor(private readonly dir: string) {}

  async init() {
    await mkdir(join(this.dir, 'private'), { recursive: true });
  }

  /**
   * File privati (biglietti, ricevute): salvati così come sono, serviti solo dopo il controllo
   * dei permessi. Restituisce il nome interno.
   */
  async savePrivate(input: Buffer, extension: string): Promise<string> {
    const ext =
      extension
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')
        .slice(0, 8) || 'bin';
    const name = `${randomBytes(16).toString('hex')}.${ext}`;
    await writeFile(join(this.dir, 'private', name), input);
    return name;
  }

  async readPrivate(name: string): Promise<Buffer | null> {
    if (!PRIVATE_NAME.test(name)) return null;
    try {
      return await readFile(join(this.dir, 'private', name));
    } catch {
      return null;
    }
  }

  /** Percorso su disco di un file privato (per ffmpeg e per servirlo a pezzi); nullo se il nome non è valido. */
  privatePath(name: string): string | null {
    return PRIVATE_NAME.test(name) ? join(this.dir, 'private', name) : null;
  }

  async removePrivate(name: string | null | undefined) {
    if (!name || !PRIVATE_NAME.test(name)) return;
    await rm(join(this.dir, 'private', name), { force: true });
  }

  /** Elabora e salva un'immagine; restituisce l'URL pubblico. */
  async saveImage(input: Buffer, preset: ImagePreset): Promise<string> {
    const { width, height, fit } = IMAGE_PRESETS[preset];
    const output = await sharp(input, { failOn: 'error', limitInputPixels: 50_000_000 })
      .rotate()
      .resize({ width, height, fit, withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
    const name = `${preset}-${randomBytes(16).toString('hex')}.webp`;
    await writeFile(join(this.dir, name), output);
    return `/api/files/${name}`;
  }

  async read(name: string): Promise<Buffer | null> {
    if (!NAME.test(name)) return null;
    try {
      return await readFile(join(this.dir, name));
    } catch {
      return null;
    }
  }

  /** Elimina un file a partire dal suo URL pubblico; ignora URL esterni o già rimossi. */
  async removeByUrl(url: string | null | undefined) {
    const name = url?.startsWith('/api/files/') ? url.slice('/api/files/'.length) : null;
    if (!name || !NAME.test(name)) return;
    await rm(join(this.dir, name), { force: true });
  }
}

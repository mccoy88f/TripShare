import { copyFile, mkdir, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import sharp from 'sharp';
import { createWorker, type Worker } from 'tesseract.js';
import { parseReceiptText, type CurrencyCode, type ParsedReceipt } from '@tripshare/shared';

/**
 * Lettura di uno scontrino con Tesseract (OCR) sul server, senza AI. Il motore resta in memoria
 * tra una lettura e l'altra e si spegne dopo un po' di inattività per non occupare RAM.
 */
const require = createRequire(import.meta.url);
const IDLE_MS = 5 * 60_000;
const TIMEOUT_MS = 60_000;

let langPath: Promise<string> | undefined;
/** Dati delle lingue (italiano e inglese, versione leggera) copiati in una sola cartella. */
function languages(): Promise<string> {
  langPath ??= (async () => {
    const dir = join(tmpdir(), 'tripshare-tessdata');
    await mkdir(dir, { recursive: true });
    for (const lang of ['ita', 'eng']) {
      const source = join(
        dirname(require.resolve(`@tesseract.js-data/${lang}/package.json`)),
        '4.0.0_best_int',
        `${lang}.traineddata.gz`,
      );
      const target = join(dir, `${lang}.traineddata.gz`);
      if (!(await stat(target).catch(() => null))) await copyFile(source, target);
    }
    return dir;
  })();
  return langPath;
}

let worker: Promise<Worker> | undefined;
let idle: NodeJS.Timeout | undefined;
let queue: Promise<unknown> = Promise.resolve();

function getWorker(): Promise<Worker> {
  worker ??= languages().then((lang) =>
    createWorker(['ita', 'eng'], 1, { langPath: lang, gzip: true, cachePath: lang }),
  );
  return worker;
}

async function stopWorker() {
  const current = worker;
  worker = undefined;
  if (current) await (await current).terminate().catch(() => undefined);
}

/** Foto pronta per l'OCR: dritta, di larghezza utile, in grigi con contrasto. */
async function prepare(image: Buffer): Promise<Buffer> {
  return sharp(image, { failOn: 'error', limitInputPixels: 80_000_000 })
    .rotate()
    .resize({ width: 2000, withoutEnlargement: false })
    .grayscale()
    .normalize()
    .sharpen()
    .png()
    .toBuffer();
}

/** Una lettura (una sola per volta). `mode` 6 = blocco uniforme, 4 = colonna di testo. */
function recognize(png: Buffer, mode: '6' | '4'): Promise<string> {
  const run = async () => {
    clearTimeout(idle);
    const w = await getWorker();
    await w.setParameters({ tessedit_pageseg_mode: mode as never });
    const result = await Promise.race([
      w.recognize(png),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('OCR_TIMEOUT')), TIMEOUT_MS).unref(),
      ),
    ]).catch(async (err) => {
      // Un motore bloccato si butta via: alla prossima lettura se ne crea uno nuovo.
      await stopWorker();
      throw err;
    });
    idle = setTimeout(() => void stopWorker(), IDLE_MS);
    idle.unref();
    return result.data.text;
  };
  const next = queue.then(run, run);
  queue = next.catch(() => undefined);
  return next;
}

const RANK = { high: 3, medium: 2, low: 1 } as const;

export interface OcrReceipt {
  receipt: ParsedReceipt;
  text: string;
}

/**
 * Legge uno scontrino da una foto. Una prima lettura come blocco unico; se il risultato non è
 * sicuro se ne prova una seconda come colonna di testo e si tiene la migliore. Restituisce null
 * se non si ricava nemmeno un totale.
 */
export async function ocrReceipt(
  image: Buffer,
  options: { currency?: CurrencyCode } = {},
): Promise<OcrReceipt | null> {
  const png = await prepare(image);
  let best: OcrReceipt | null = null;
  for (const mode of ['6', '4'] as const) {
    const text = await recognize(png, mode);
    const receipt = parseReceiptText(text, options);
    if (receipt && (!best || RANK[receipt.confidence] > RANK[best.receipt.confidence]))
      best = { receipt, text };
    if (best?.receipt.confidence === 'high') break;
  }
  return best;
}

/** Spegne il motore (per i test e per la chiusura del processo). */
export const closeReceiptOcr = stopWorker;

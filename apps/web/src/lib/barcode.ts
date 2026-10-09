/**
 * Lettura e generazione di QR e codici a barre nel browser con ZXing (WebAssembly).
 * Il modulo (~1,5 MB) si carica solo quando serve ed è servito dall'app, quindi funziona offline.
 */
import wasmUrl from 'zxing-wasm/full/zxing_full.wasm?url';

export const CODE_FORMATS = [
  'QRCode',
  'AztecCode',
  'PDF417',
  'DataMatrix',
  'Code128',
  'Code39',
  'EAN13',
  'EAN8',
  'UPCA',
  'ITF',
] as const;
export type CodeFormat = (typeof CODE_FORMATS)[number];

export const CODE_FORMAT_LABELS: Record<CodeFormat, string> = {
  QRCode: 'QR Code',
  AztecCode: 'Aztec',
  PDF417: 'PDF417',
  DataMatrix: 'Data Matrix',
  Code128: 'Code 128',
  Code39: 'Code 39',
  EAN13: 'EAN-13',
  EAN8: 'EAN-8',
  UPCA: 'UPC-A',
  ITF: 'ITF',
};

let modulePromise: Promise<typeof import('zxing-wasm/full')> | null = null;

function zxing() {
  modulePromise ??= import('zxing-wasm/full').then((m) => {
    m.prepareZXingModule({
      overrides: {
        locateFile: (path: string, prefix: string) =>
          path.endsWith('.wasm') ? wasmUrl : prefix + path,
      },
    });
    return m;
  });
  return modulePromise;
}

/** Riporta il formato letto da ZXing a uno di quelli gestiti da TripShare. */
export function normalizeFormat(format: string): CodeFormat | null {
  const f = format.replace(/[^A-Za-z0-9]/g, '').toLowerCase();
  if (f.startsWith('qr') || f.startsWith('microqr') || f.startsWith('rmqr')) return 'QRCode';
  if (f.startsWith('aztec')) return 'AztecCode';
  if (f.includes('pdf417')) return 'PDF417';
  if (f.startsWith('datamatrix')) return 'DataMatrix';
  if (f.startsWith('code128')) return 'Code128';
  if (f.startsWith('code39')) return 'Code39';
  if (f === 'ean13' || f === 'eanupc') return 'EAN13';
  if (f === 'ean8') return 'EAN8';
  if (f === 'upca') return 'UPCA';
  if (f.startsWith('itf')) return 'ITF';
  return null;
}

export interface DecodedCode {
  format: CodeFormat;
  text: string;
}

/** Cerca codici in un'immagine (foto o screenshot). Restituisce il primo valido, se c'è. */
export async function decodeImage(file: Blob): Promise<DecodedCode | null> {
  try {
    const { readBarcodes } = await zxing();
    const results = await readBarcodes(file, { tryHarder: true, maxNumberOfSymbols: 1 });
    for (const r of results) {
      const format = normalizeFormat(r.format);
      if (r.isValid && format && r.text) return { format, text: r.text };
    }
  } catch {
    // immagine non leggibile o formato non supportato
  }
  return null;
}

/** SVG del codice, nitido a qualsiasi dimensione. */
export async function renderCodeSvg(text: string, format: CodeFormat): Promise<string | null> {
  try {
    const { writeBarcode } = await zxing();
    const result = await writeBarcode(text, { format, scale: 8 });
    return result.error ? null : result.svg;
  } catch {
    return null;
  }
}

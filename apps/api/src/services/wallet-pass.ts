import { unzipSync } from 'fflate';

/**
 * Il codice (QR, Aztec, PDF417…) contenuto in un biglietto per il Wallet: così il biglietto si
 * mostra al controllo anche senza aprire Apple Wallet o Google Wallet.
 */
export interface PassCode {
  format: string;
  value: string;
}

const PKPASS_FORMATS: Record<string, string> = {
  PKBarcodeFormatQR: 'QRCode',
  PKBarcodeFormatPDF417: 'PDF417',
  PKBarcodeFormatAztec: 'AztecCode',
  PKBarcodeFormatCode128: 'Code128',
};

const GOOGLE_FORMATS: Record<string, string> = {
  QR_CODE: 'QRCode',
  AZTEC: 'AztecCode',
  PDF_417: 'PDF417',
  CODE_128: 'Code128',
  CODE_39: 'Code39',
  DATA_MATRIX: 'DataMatrix',
  EAN_13: 'EAN13',
  EAN_8: 'EAN8',
  UPC_A: 'UPCA',
  ITF_14: 'ITF',
};

const MAX_VALUE = 4000;

/** Primo codice a barre di un file Apple Wallet (.pkpass, uno zip con `pass.json`). */
export function codeFromPkpass(file: Uint8Array): PassCode | null {
  try {
    // Si legge solo pass.json, e solo se è di dimensioni normali.
    const files = unzipSync(file, {
      filter: (f) => f.name === 'pass.json' && f.originalSize < 1_000_000,
    });
    const raw = files['pass.json'];
    if (!raw) return null;
    const pass = JSON.parse(new TextDecoder().decode(raw)) as {
      barcodes?: { format?: string; message?: string }[];
      barcode?: { format?: string; message?: string };
    };
    for (const b of [...(pass.barcodes ?? []), ...(pass.barcode ? [pass.barcode] : [])]) {
      const format = b.format ? PKPASS_FORMATS[b.format] : undefined;
      if (format && b.message && b.message.length <= MAX_VALUE) return { format, value: b.message };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Codice a barre di un link "Salva su Google Wallet": l'indirizzo contiene un token JWT con il
 * biglietto, leggibile senza chiavi. I link corti, senza token, non si possono leggere.
 */
export function codeFromGoogleWalletUrl(url: string): PassCode | null {
  try {
    const token = new URL(url).pathname.split('/').pop() ?? '';
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const json = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8')) as {
      payload?: Record<string, { barcode?: { type?: string; value?: string } }[]>;
    };
    for (const objects of Object.values(json.payload ?? {})) {
      if (!Array.isArray(objects)) continue;
      for (const o of objects) {
        const format = o.barcode?.type ? GOOGLE_FORMATS[o.barcode.type] : undefined;
        const value = o.barcode?.value;
        if (format && value && value.length <= MAX_VALUE) return { format, value };
      }
    }
    return null;
  } catch {
    return null;
  }
}

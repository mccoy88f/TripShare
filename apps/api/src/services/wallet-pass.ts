import { unzipSync } from 'fflate';

/**
 * Il codice (QR, Aztec, PDF417…) contenuto in un biglietto per il Wallet: così il biglietto si
 * mostra al controllo anche senza aprire Apple Wallet o Google Wallet.
 */
export interface PassCode {
  format: string;
  value: string;
}

/** Cosa si ricava da un biglietto del Wallet: il codice a barre e/o il numero di prenotazione. */
export interface PassInfo {
  code: PassCode | null;
  /** Numero di prenotazione o di biglietto, da mostrare se manca un codice a barre. */
  reference: string | null;
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

interface PkField {
  key?: string;
  label?: string;
  value?: unknown;
}

const REFERENCE_STRONG = /pnr|confirm|booking|reserv|locator|prenotaz|localizz|conferma/i;
const REFERENCE_WEAK = /ticket|biglietto|codice|code|riferimento|reference|\bref\b/i;

/**
 * Un valore che somiglia a un numero di prenotazione: una sigla in maiuscolo (anche con spazi o
 * trattini) oppure una parola senza spazi con almeno una cifra. Le frasi non passano.
 */
const looksLikeReference = (v: unknown): v is string => {
  if (typeof v !== 'string') return false;
  const x = v.trim();
  return (
    /^[A-Z0-9][A-Z0-9 \-_/]{2,38}$/.test(x) || /^(?=.*\d)[A-Za-z0-9][A-Za-z0-9\-_/]{2,29}$/.test(x)
  );
};

/** Il numero di prenotazione tra i campi di un pass (per chiave o etichetta). */
function referenceFromFields(pass: Record<string, unknown>): string | null {
  const fields: PkField[] = [];
  for (const style of Object.values(pass))
    if (style && typeof style === 'object' && !Array.isArray(style))
      for (const list of Object.values(style as Record<string, unknown>))
        if (Array.isArray(list))
          for (const f of list) if (f && typeof f === 'object') fields.push(f as PkField);
  for (const pattern of [REFERENCE_STRONG, REFERENCE_WEAK])
    for (const f of fields)
      if ((pattern.test(f.key ?? '') || pattern.test(f.label ?? '')) && looksLikeReference(f.value))
        return (f.value as string).trim();
  return null;
}

/** Codice a barre e numero di prenotazione di un file Apple Wallet (.pkpass, uno zip con `pass.json`). */
export function infoFromPkpass(file: Uint8Array): PassInfo {
  const none: PassInfo = { code: null, reference: null };
  try {
    // Si legge solo pass.json, e solo se è di dimensioni normali.
    const files = unzipSync(file, {
      filter: (f) => f.name === 'pass.json' && f.originalSize < 1_000_000,
    });
    const raw = files['pass.json'];
    if (!raw) return none;
    const pass = JSON.parse(new TextDecoder().decode(raw)) as Record<string, unknown> & {
      barcodes?: { format?: string; message?: string; altText?: string }[];
      barcode?: { format?: string; message?: string; altText?: string };
    };
    const barcodes = [...(pass.barcodes ?? []), ...(pass.barcode ? [pass.barcode] : [])];
    let code: PassCode | null = null;
    for (const b of barcodes) {
      const format = b.format ? PKPASS_FORMATS[b.format] : undefined;
      if (format && b.message && b.message.length <= MAX_VALUE) {
        code = { format, value: b.message };
        break;
      }
    }
    const alt = barcodes.map((b) => b.altText).find(looksLikeReference);
    return { code, reference: referenceFromFields(pass) ?? alt?.trim() ?? null };
  } catch {
    return none;
  }
}

/**
 * Codice a barre e numero di prenotazione di un link "Salva su Google Wallet": l'indirizzo
 * contiene un token JWT con il biglietto, leggibile senza chiavi. I link corti, senza token, non
 * si possono leggere.
 */
export function infoFromGoogleWalletUrl(url: string): PassInfo {
  const none: PassInfo = { code: null, reference: null };
  try {
    const token = new URL(url).pathname.split('/').pop() ?? '';
    const parts = token.split('.');
    if (parts.length < 2) return none;
    const json = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8')) as {
      payload?: Record<string, GoogleObject[]>;
    };
    let code: PassCode | null = null;
    let reference: string | null = null;
    for (const objects of Object.values(json.payload ?? {})) {
      if (!Array.isArray(objects)) continue;
      for (const o of objects) {
        const format = o.barcode?.type ? GOOGLE_FORMATS[o.barcode.type] : undefined;
        const value = o.barcode?.value;
        if (!code && format && value && value.length <= MAX_VALUE) code = { format, value };
        reference ??=
          [
            o.reservationInfo?.confirmationCode,
            o.confirmationCode,
            o.ticketNumber,
            o.reservationInfo?.eticketNumber,
            o.barcode?.alternateText,
          ]
            .find(looksLikeReference)
            ?.trim() ?? null;
      }
    }
    return { code, reference };
  } catch {
    return none;
  }
}

interface GoogleObject {
  barcode?: { type?: string; value?: string; alternateText?: string };
  reservationInfo?: { confirmationCode?: string; eticketNumber?: string };
  confirmationCode?: string;
  ticketNumber?: string;
}

import { describe, expect, it } from 'vitest';
import { googleUrl, pkpass } from './wallet-fixtures.js';
import { codeFromGoogleWalletUrl, codeFromPkpass } from '../src/services/wallet-pass.js';

describe('codeFromPkpass', () => {
  it('legge il codice dall’elenco "barcodes"', () => {
    const file = pkpass({
      barcodes: [
        {
          format: 'PKBarcodeFormatQR',
          message: 'M1BIANCHI/LUCA ABC123',
          messageEncoding: 'iso-8859-1',
        },
      ],
    });
    expect(codeFromPkpass(file)).toEqual({ format: 'QRCode', value: 'M1BIANCHI/LUCA ABC123' });
  });

  it('accetta il vecchio campo "barcode" e gli altri formati', () => {
    expect(
      codeFromPkpass(pkpass({ barcode: { format: 'PKBarcodeFormatPDF417', message: 'X' } })),
    ).toEqual({ format: 'PDF417', value: 'X' });
    expect(
      codeFromPkpass(pkpass({ barcodes: [{ format: 'PKBarcodeFormatAztec', message: 'Y' }] })),
    ).toEqual({ format: 'AztecCode', value: 'Y' });
  });

  it('salta i formati sconosciuti e non si rompe con file non validi', () => {
    expect(
      codeFromPkpass(
        pkpass({
          barcodes: [
            { format: 'Strano', message: 'X' },
            { format: 'PKBarcodeFormatQR', message: 'ok' },
          ],
        }),
      ),
    ).toEqual({ format: 'QRCode', value: 'ok' });
    expect(codeFromPkpass(pkpass({ name: 'senza codice' }))).toBeNull();
    expect(codeFromPkpass(Buffer.from('non è uno zip'))).toBeNull();
  });
});

describe('codeFromGoogleWalletUrl', () => {
  it('legge il codice dal token del link', () => {
    const url = googleUrl({
      flightObjects: [{ id: 'a', barcode: { type: 'QR_CODE', value: 'FR1234-XYZ' } }],
    });
    expect(codeFromGoogleWalletUrl(url)).toEqual({ format: 'QRCode', value: 'FR1234-XYZ' });
    expect(
      codeFromGoogleWalletUrl(
        googleUrl({ eventTicketObjects: [{ barcode: { type: 'PDF_417', value: 'P' } }] }),
      ),
    ).toEqual({ format: 'PDF417', value: 'P' });
  });

  it('ignora i link corti, senza token, e i testi senza codice', () => {
    expect(codeFromGoogleWalletUrl('https://pay.google.com/gp/v/save/abc123')).toBeNull();
    expect(codeFromGoogleWalletUrl('https://example.com')).toBeNull();
    expect(
      codeFromGoogleWalletUrl(
        googleUrl({ genericObjects: [{ barcode: { type: 'TEXT_ONLY', value: 't' } }] }),
      ),
    ).toBeNull();
  });
});

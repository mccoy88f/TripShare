import { describe, expect, it } from 'vitest';
import { infoFromGoogleWalletUrl, infoFromPkpass } from '../src/services/wallet-pass.js';
import { googleUrl, pkpass } from './wallet-fixtures.js';

describe('infoFromPkpass', () => {
  it('legge il codice dall’elenco "barcodes"', () => {
    const file = pkpass({
      barcodes: [{ format: 'PKBarcodeFormatQR', message: 'M1BIANCHI/LUCA ABC123' }],
    });
    expect(infoFromPkpass(file).code).toEqual({ format: 'QRCode', value: 'M1BIANCHI/LUCA ABC123' });
  });

  it('accetta il vecchio campo "barcode" e gli altri formati', () => {
    expect(
      infoFromPkpass(pkpass({ barcode: { format: 'PKBarcodeFormatPDF417', message: 'X' } })).code,
    ).toEqual({ format: 'PDF417', value: 'X' });
    expect(
      infoFromPkpass(pkpass({ barcodes: [{ format: 'PKBarcodeFormatAztec', message: 'Y' }] })).code,
    ).toEqual({ format: 'AztecCode', value: 'Y' });
  });

  it('ricava il numero di prenotazione dai campi, anche senza codice a barre', () => {
    const info = infoFromPkpass(
      pkpass({
        boardingPass: {
          primaryFields: [{ key: 'from', label: 'Da', value: 'Roma' }],
          auxiliaryFields: [{ key: 'pnr', label: 'Prenotazione', value: 'K7ZQ9P' }],
          backFields: [{ key: 'info', label: 'Note', value: 'Presentarsi due ore prima del volo' }],
        },
      }),
    );
    expect(info).toEqual({ code: null, reference: 'K7ZQ9P' });
    // Chiavi con nomi diversi o etichette in italiano.
    expect(
      infoFromPkpass(
        pkpass({
          eventTicket: {
            secondaryFields: [{ key: 'x', label: 'Codice prenotazione', value: 'AB-1234' }],
          },
        }),
      ).reference,
    ).toBe('AB-1234');
    // Il testo sotto il codice a barre è l'ultima scelta.
    expect(
      infoFromPkpass(
        pkpass({ barcode: { format: 'PKBarcodeFormatQR', message: 'm', altText: 'TKT55' } }),
      ).reference,
    ).toBe('TKT55');
  });

  it('non scambia una frase per un numero di prenotazione', () => {
    expect(
      infoFromPkpass(
        pkpass({
          generic: {
            primaryFields: [
              { key: 'booking', label: 'Booking', value: 'Presentarsi alle nove al cancello' },
            ],
          },
        }),
      ).reference,
    ).toBeNull();
  });

  it('salta i formati sconosciuti e non si rompe con file non validi', () => {
    expect(
      infoFromPkpass(
        pkpass({
          barcodes: [
            { format: 'Strano', message: 'X' },
            { format: 'PKBarcodeFormatQR', message: 'ok' },
          ],
        }),
      ).code,
    ).toEqual({ format: 'QRCode', value: 'ok' });
    expect(infoFromPkpass(pkpass({ name: 'senza codice' }))).toEqual({
      code: null,
      reference: null,
    });
    expect(infoFromPkpass(Buffer.from('non è uno zip'))).toEqual({ code: null, reference: null });
  });
});

describe('infoFromGoogleWalletUrl', () => {
  it('legge il codice dal token del link', () => {
    expect(
      infoFromGoogleWalletUrl(
        googleUrl({
          flightObjects: [{ id: 'a', barcode: { type: 'QR_CODE', value: 'FR1234-XYZ' } }],
        }),
      ).code,
    ).toEqual({ format: 'QRCode', value: 'FR1234-XYZ' });
    expect(
      infoFromGoogleWalletUrl(
        googleUrl({ eventTicketObjects: [{ barcode: { type: 'PDF_417', value: 'P' } }] }),
      ).code,
    ).toEqual({ format: 'PDF417', value: 'P' });
  });

  it('ricava il numero di prenotazione', () => {
    expect(
      infoFromGoogleWalletUrl(
        googleUrl({ flightObjects: [{ reservationInfo: { confirmationCode: 'XY12AB' } }] }),
      ),
    ).toEqual({ code: null, reference: 'XY12AB' });
    expect(
      infoFromGoogleWalletUrl(googleUrl({ eventTicketObjects: [{ ticketNumber: 'TK-778899' }] }))
        .reference,
    ).toBe('TK-778899');
  });

  it('ignora i link corti, senza token, e i testi senza codice', () => {
    expect(infoFromGoogleWalletUrl('https://pay.google.com/gp/v/save/abc123')).toEqual({
      code: null,
      reference: null,
    });
    expect(infoFromGoogleWalletUrl('https://example.com').code).toBeNull();
    expect(
      infoFromGoogleWalletUrl(
        googleUrl({ genericObjects: [{ barcode: { type: 'TEXT_ONLY', value: 't' } }] }),
      ).code,
    ).toBeNull();
  });
});

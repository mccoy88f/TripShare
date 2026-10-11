import { describe, expect, it } from 'vitest';
import { parseReceiptText } from '../src/receipt-text.js';

const today = new Date('2026-10-11T12:00:00Z');
const parse = (text: string) => parseReceiptText(text, { today });

// Testi letti da Tesseract da una foto vera di uno scontrino (negozio, con totale in grassetto):
// il totale è scritto male in alcune letture, ma è ripetuto in più righe.
const PHOTO_PSM6 = `
@happycasastore he
Happy Casa Store Cassino : —=
Via Casilina, Km 141.500 - 03043 (FR) =
Tel. 07761810234 ee
cassino@retail happucasastore. it mess
P.I, 02708430737 ~ www. happycasastore. it a
DOCUMENTO COMMERCIALE —
di vendita o prestazione ===
DESCRIZIONE IVA PREZZOCe) RS
COLGATE SPAZZ. EXTRA CLEAN 4PZ 22,00% 2,99 =
SET VIAGGIO 8PZ C/BORSETTA PVC 22,00% Rc —
DOVE DEO STICK INVISIBILE DRY & 22,00% 3.99 orione
SCONTO DIPENDENTE 20.00% 22,00% -0,80 | —
SUBTOTALE 9,17 =
| LA AN i 1% i = sa
TOTALE COMPLESSIVO 5,17 EE
DI CUT IVA 1,685 Fee
Pagamento elettronico 9]7 =. =
Importo pagato 9,1
0 000636 0096006000 AU UA 06 UU UA 3
Pasamento elettronico: |_ime————
Bancomat 2.17 |
`;

const PHOTO_BASE = `
@happycasastore a
Happy Casa Store Cassino ===
Via Casilina, Km 141.500 = 03043 (FR) e
Tel. 07761810234 ===
P.I, 02708430737 ~ www.happycasastore it E
DOCUMENTO COMMERCIALE =—
| di vendita o prestazione ===
| DESCRIZIONE IVA PREZZOCE) PA
| COLGATE SPAZZ, EXTRA CLEAN 4PZ 22,00% 2,99 EEE
SET VIAGGIO 8FZ C/BORSETTA PVC 22, 00% 2,99 SESS.
DOVE DED STICK INVISIBILE DRY & 22,00% 3,99 SESS
SCONTO DIPENDENTE 20.00% 22,00% -0,80 Hp
SUBTOTALE 9,17 za
TA uni Pee 0 a 4% =
DALE COPLESSIVI 7
DI CUT IVA 1,65 Fe
Pagamento elettronico 917 ii
Importo pagato 9,1 |
Pasamento elettronico: jr ——
Bancomat 9,17 | =
`;

const PHOTO_PSM4 = `
@happycasastore

Happy Casa Store Cassino
Via Casilina, Km 141 500 - 03043 (FR)
Tel. 07761810234
P.I. 02708430737 = www. happycasastore it

DOCUMENTO COMMERCIALE
di vendita o Prestazione

DESCRIZIONE IVR PREZZ
COLGATE SPAZZ. EXTRA CLEAN 4PZ 22, 00% 2,95
SET VIAGGIO 8FZ C/BORSETTA PVC 22,00% 2,99
DOVE DED STICK INVISIBILE DRY & 22,00% 3, A

SCONTO DIPENDENTE 20.00% 22, 00% “0,80

SUBTOTALE 9,17

TOTALE COMPLESSIVO
DI CUI IVA pr
Pagamento elettronico B 1]

Importo pagato 91
Pasamento elettronico:
Bancomat 9.17
`;

describe('parseReceiptText su una foto vera', () => {
  it.each([
    ['totale illeggibile: lo confermano subtotale e pagamento', PHOTO_BASE],
    ['solo subtotale e pagamento leggibili', PHOTO_PSM4],
  ])('%s', (_name, text) => {
    const r = parse(text)!;
    expect(r.total).toBe(9.17);
    expect(r.merchant).toBe('Happy Casa Store Cassino');
    expect(r.currency).toBe('EUR');
    expect(r.category).toBe('shopping');
    expect(r.confidence).toBe('high');
    expect(r.date).toBeUndefined();
    expect(r.notes).toContain('Data non letta');
  });

  it('legge le righe con lo sconto e le torna sommando al totale', () => {
    const r = parse(PHOTO_BASE)!;
    expect(r.items.map((i) => i.amount)).toEqual([2.99, 2.99, 3.99, -0.8]);
    expect(r.items[0]!.name).toMatch(/^COLGATE SPAZZ[.,] EXTRA CLEAN 4PZ$/);
    expect(r.items.reduce((a, i) => a + i.amount, 0)).toBeCloseTo(9.17, 2);
  });

  it('una cifra letta male (5 al posto di 9) non passa per sicura', () => {
    // "TOTALE COMPLESSIVO 5,17" contro "SUBTOTALE 9,17": il testo è in conflitto con se stesso,
    // quindi la fiducia non è alta e il chiamante può ripiegare sull'AI.
    const r = parse(PHOTO_PSM6)!;
    expect(r.confidence).not.toBe('high');
    expect(r.notes).toContain('Il totale non è chiaro');
  });
});

describe('parseReceiptText', () => {
  const TRATTORIA = `
TRATTORIA DA MARIO

Via Roma 12 - 00100 ROMA
P.IVA 01234567890
12/10/2026 20:41

2 x Coperto 3,00
Spaghetti carbonara 9,50
Tiramisu 5,00
Acqua naturale 1L 2,50
Vino della casa 0,5 8,00
SUBTOTALE 28,00
TOTALE COMPLESSIVO 28,00
CONTANTI 30,00
RESTO 2,00
`;

  it('ristorante: negozio, data, totale e categoria', () => {
    const r = parse(TRATTORIA)!;
    expect(r).toMatchObject({
      merchant: 'Trattoria Da Mario',
      title: 'Trattoria Da Mario',
      date: '2026-10-12',
      total: 28,
      currency: 'EUR',
      category: 'food',
      confidence: 'high',
    });
    expect(r.items).toHaveLength(5);
    expect(r.notes).toBeUndefined();
  });

  it('il totale non è né il contante né il resto', () => {
    expect(parse(TRATTORIA)!.total).toBe(28);
  });

  it('importi con migliaia, valute e date in altri formati', () => {
    const r = parse(`Hotel Aurora
Camera 12 - 3 notti
Totale EUR 1.234,50
Pagamento elettronico 1.234,50
Data 05.09.26`)!;
    expect(r).toMatchObject({
      total: 1234.5,
      currency: 'EUR',
      date: '2026-09-05',
      category: 'lodging',
    });
    expect(
      parse(`Corner Shop London
Milk 1.20
Bread 2.30
Total £3.50
Card 3.50
03 Oct 2026`),
    ).toMatchObject({ total: 3.5, currency: 'GBP', date: '2026-10-03' });
  });

  it('una data nel futuro o impossibile non viene presa', () => {
    expect(
      parse(`Bar Centrale\nTOTALE 2,50\nPagamento elettronico 2,50\n31/02/2026`)!.date,
    ).toBeUndefined();
    expect(
      parse(`Bar Centrale\nTOTALE 2,50\nPagamento elettronico 2,50\n01/01/2030`)!.date,
    ).toBeUndefined();
  });

  it('con un solo punto di conferma la fiducia è media, senza totale è bassa', () => {
    expect(parse(`Bar Centrale\nCornetto 1,50\nTOTALE 1,50`)!.confidence).toBe('medium');
    const none = parse(`Qualcosa di illeggibile\nxx yy zz\n12,30 4,50`)!;
    expect(none.confidence).toBe('low');
    expect(parse('niente\naltro')).toBeNull();
  });

  it('categorie: carburante e supermercato', () => {
    expect(
      parse(`ENI STATION\nBenzina 95 40,00\nTOTALE 40,00\nPagamento elettronico 40,00`)!.category,
    ).toBe('fuel');
    expect(
      parse(`Conad Supermercato\nPane 1,20\nLatte 1,50\nTOTALE 2,70\nBancomat 2,70`)!.category,
    ).toBe('groceries');
  });
});

describe('parseReceiptText su email e schermate', () => {
  const EMAIL = `9:41 4G 85%
Posta in arrivo
Da: Ricevute <noreply@trenitalia.com>
Oggetto: La tua ricevuta di pagamento
Ven 9 ott 2026, 18:22
Grazie per il tuo acquisto
Biglietto Roma Termini - Napoli Centrale 12/10/2026
Importo 24,90 EUR
Totale pagato 24,90 EUR
Metodo di pagamento Visa **** 4242`;

  it('il mittente (non la barra di stato) è il negozio; la fiducia non supera "media"', () => {
    const r = parseReceiptText(EMAIL, { today })!;
    expect(r).toMatchObject({ merchant: 'Trenitalia', total: 24.9, currency: 'EUR' });
    expect(r.confidence).toBe('medium');
  });

  it('con un mittente con nome si usa quello', () => {
    const r = parseReceiptText(
      `Da: Ristorante Da Gino <info@dagino.it>\nOggetto: Conto\nTotale 38,50 EUR\nPagamento elettronico 38,50`,
      { today },
    )!;
    expect(r.merchant).toBe('Ristorante Da Gino');
  });

  it('conferme con più importi diversi (acconto, saldo) restano incerte', () => {
    const r = parseReceiptText(
      `Da: Hotel Aurora <info@hotelaurora.it>
Oggetto: Conferma prenotazione
Totale soggiorno 450,00 EUR
Acconto versato 90,00 EUR
Saldo da pagare in struttura 360,00 EUR`,
      { today },
    )!;
    expect(r.confidence).not.toBe('high');
  });

  it('senza importi non si ricava nulla', () => {
    expect(
      parseReceiptText(
        `Da: Marco <marco@gmail.com>\nOggetto: Ci vediamo domani\nCiao, a domani alle 20.`,
        { today },
      ),
    ).toBeNull();
  });
});

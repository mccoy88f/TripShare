import { EXPENSE_CATEGORIES, type ExpenseCategory } from './categories.js';
import { CURRENCY_CODES, type CurrencyCode } from './currencies.js';

/**
 * Lettura di uno scontrino dal suo testo (quello restituito da un OCR), con regole semplici:
 * totale, data, negozio, categoria e righe. Niente AI: funziona offline e non costa nulla, ma si
 * ferma quando il testo è troppo confuso (il chiamante, in quel caso, passa all'AI).
 */
export interface ParsedReceipt {
  title: string;
  merchant?: string;
  date?: string;
  total: number;
  currency: CurrencyCode;
  category: ExpenseCategory;
  emoji: string;
  items: { name: string; quantity?: number; amount: number }[];
  tax?: number;
  confidence: 'high' | 'medium' | 'low';
  notes?: string;
}

// ─── Importi ────────────────────────────────────────────────────────────────

/** Importo con due decimali ("12,50", "1.234,56", "12.50"), non parte di una data o di un numero. */
const MONEY = /(?<![\d.,/-])-?(\d{1,3}(?:[.\s]\d{3})+|\d+)[,.](\d{2})(?!\d|[.,/-]\d)/g;

function moneyIn(line: string): number[] {
  return [...line.matchAll(MONEY)].map((m) => {
    const value = Number(`${m[1]!.replace(/[.\s]/g, '')}.${m[2]}`);
    return m[0].startsWith('-') ? -value : value;
  });
}

// ─── Totale ─────────────────────────────────────────────────────────────────

const TOTAL_STRONG =
  /totale\s+complessivo|totale\s+da\s+pagare|da\s+pagare|importo\s+(?:pagato|totale|da\s+pagare)|totale\s+(?:eur|euro|€)|total\s+due|amount\s+due|grand\s+total|total\s+(?:eur|gbp|usd|chf)|totale\s+documento/i;
const TOTAL_NORMAL = /\b(?:totale|total|importo|saldo|balance|amount)\b/i;
const TOTAL_PAYMENT =
  /pagamento\s+(?:elettronico|carta|con)|\b(?:pagato|bancomat|pos|carta\s+di\s+credito|credit\s+card|card)\b/i;
/** Righe che contengono un importo ma non sono il totale. */
const NOT_TOTAL =
  /sub\s*-?\s*total|imponibile|\biva\b|\btax\b|\bvat\b|\bresto\b|\bchange\b|sconto|contanti|\bcash\b|di\s+cui|\btot\.?\s*iva|non\s+riscosso|buono|ticket\s+restaurant|\bmancia\b|\btip\b|arrotond/i;

const SUBTOTAL = /sub\s*-?\s*total/i;

/** Un importo letto in più righe del totale ("TOTALE", "Pagamento", "Bancomat"…). */
interface Candidate {
  value: number;
  score: number;
  /** Quante righe diverse lo riportano. */
  support: number;
  /** Peso massimo di una riga che lo riporta (3 = "totale complessivo", 2 = "totale"…). */
  best: number;
  index: number;
}

/**
 * Il totale compare in più punti dello scontrino (totale, pagamento, importo pagato, subtotale):
 * se una riga è letta male le altre lo confermano. Si sceglie l'importo con più conferme.
 */
function totalCandidates(lines: string[]): Candidate[] {
  const byValue = new Map<number, Candidate>();
  lines.forEach((line, i) => {
    const strong = TOTAL_STRONG.test(line);
    const weight = SUBTOTAL.test(line)
      ? 1
      : NOT_TOTAL.test(line) && !strong
        ? 0
        : strong
          ? 3
          : TOTAL_NORMAL.test(line)
            ? 2
            : TOTAL_PAYMENT.test(line)
              ? 1
              : 0;
    if (weight === 0) return;
    let amounts = moneyIn(line);
    // L'importo può essere sulla riga dopo ("TOTALE" ... "28,00").
    if (amounts.length === 0 && lines[i + 1]) {
      const next = moneyIn(lines[i + 1]!);
      if (next.length === 1 && !/[A-Za-z]{3}/.test(lines[i + 1]!)) amounts = next;
    }
    const value = amounts.at(-1);
    if (value === undefined || value <= 0) return;
    const key = Math.round(value * 100) / 100;
    const c = byValue.get(key) ?? { value: key, score: 0, support: 0, best: 0, index: i };
    c.score += weight;
    c.support += 1;
    c.best = Math.max(c.best, weight);
    // Le righe delle voci stanno prima di quella del totale.
    c.index = weight >= 2 ? i : Math.max(c.index, i);
    byValue.set(key, c);
  });
  return [...byValue.values()];
}

// ─── Data ───────────────────────────────────────────────────────────────────

const MONTHS: Record<string, number> = {
  gen: 1,
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  mag: 5,
  may: 5,
  giu: 6,
  jun: 6,
  lug: 7,
  jul: 7,
  ago: 8,
  aug: 8,
  set: 9,
  sep: 9,
  ott: 10,
  oct: 10,
  nov: 11,
  dic: 12,
  dec: 12,
};

function validDate(y: number, m: number, d: number, today: Date): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  if (y < 2000 || y > today.getUTCFullYear() + 1) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCMonth() !== m - 1) return null;
  // Uno scontrino non è nel futuro (con un giorno di tolleranza per i fusi orari).
  if (date.getTime() > today.getTime() + 2 * 86_400_000) return null;
  return date.toISOString().slice(0, 10);
}

function findDate(text: string, today: Date): string | undefined {
  const candidates: { index: number; iso: string }[] = [];
  for (const m of text.matchAll(/(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/g)) {
    const iso = validDate(+m[1]!, +m[2]!, +m[3]!, today);
    if (iso) candidates.push({ index: m.index!, iso });
  }
  for (const m of text.matchAll(
    /(?<![\d.,])(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4}|\d{2})(?![\d])/g,
  )) {
    const year = m[3]!.length === 2 ? 2000 + +m[3]! : +m[3]!;
    // Giorno/mese all'italiana; se il mese non esiste si prova all'americana.
    const iso = validDate(year, +m[2]!, +m[1]!, today) ?? validDate(year, +m[1]!, +m[2]!, today);
    if (iso) candidates.push({ index: m.index!, iso });
  }
  for (const m of text.matchAll(/(?<!\d)(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?,?\s+(\d{4})(?!\d)/g)) {
    const month = MONTHS[m[2]!.toLowerCase()];
    const iso = month ? validDate(+m[3]!, month, +m[1]!, today) : null;
    if (iso) candidates.push({ index: m.index!, iso });
  }
  // La data dello scontrino è di solito la prima: le altre (scadenze, garanzie) vengono dopo.
  return candidates.sort((a, b) => a.index - b.index)[0]?.iso;
}

// ─── Valuta, negozio, categoria ─────────────────────────────────────────────

function findCurrency(text: string, fallback: CurrencyCode): CurrencyCode {
  if (/€|\beur(?:o)?\b/i.test(text)) return 'EUR';
  if (/£|\bgbp\b/i.test(text)) return 'GBP';
  if (/\bchf\b|\bfr\.\s?\d/i.test(text)) return 'CHF';
  if (/\busd\b|us\$|\$\s?\d/i.test(text)) return 'USD';
  for (const code of CURRENCY_CODES) if (new RegExp(`\\b${code}\\b`).test(text)) return code;
  return fallback;
}

const NOT_MERCHANT =
  /^(?:scontrino|ricevuta|fattura|documento|receipt|invoice|tel|telefono|fax|p\.?\s?iva|c\.?\s?f\.?|cod|via\b|viale|piazza|corso|largo|strada|www|http|data|ora\b|cassa|n[.°]|num|grazie|benvenut|welcome|tavolo|coperti|operatore|cliente)/i;

function findMerchant(lines: string[]): string | undefined {
  for (const raw of lines.slice(0, 8)) {
    const line = raw
      .replace(/[^\p{L}\p{N}&'’.,\- ]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const letters = (line.match(/\p{L}/gu) ?? []).length;
    if (letters < 3 || letters < line.length * 0.5) continue;
    if (NOT_MERCHANT.test(line) || moneyIn(line).length > 0 || /\d{5,}/.test(line)) continue;
    // Profili social, siti e indirizzi email non sono il nome del negozio.
    if (/^@|@\w|www\.|https?:|\.(?:it|com|org|net|eu)\b/i.test(raw)) continue;
    const name = line.slice(0, 80);
    // Tutto maiuscolo → "Trattoria Da Mario".
    return name === name.toUpperCase()
      ? name
          .toLowerCase()
          .replace(/(^|[\s'’-])(\p{L})/gu, (_, a: string, b: string) => a + b.toUpperCase())
      : name;
  }
  return undefined;
}

const CATEGORY_RULES: [ExpenseCategory, RegExp][] = [
  [
    'fuel',
    /benzina|gasolio|diesel|carburante|\bgpl\b|self\s*service|\b(?:eni|agip|q8|esso|tamoil|ip)\b|\bshell\b|unleaded|petrol/i,
  ],
  [
    'lodging',
    /\bhotel\b|albergo|\bb\s?&\s?b\b|pernottament|\bresort\b|\bostello\b|camera\s+\d|\bnotti\b/i,
  ],
  ['parking', /parcheggio|parking|pedaggio|autostrad|telepass|\btoll\b/i],
  [
    'transport',
    /\btaxi\b|\buber\b|trenitalia|italo|\bbus\b|metropolitana|\bmetro\b|biglietto\s+(?:corsa|treno|bus)|\btrain\b|\bferry\b|traghett/i,
  ],
  [
    'groceries',
    /supermercat|\bconad\b|\bcoop\b|esselunga|carrefour|\blidl\b|eurospin|despar|\bpam\b|alimentari|\btesco\b|sainsbury|\baldi\b|market/i,
  ],
  [
    'coffee',
    /caffetteria|\bcaff[eè]\b|colazione|cornetto|pasticceri|cappuccin|\bcoffee\b|bakery|panetteria/i,
  ],
  ['drinks', /\bbar\b|\bpub\b|birreria|enoteca|cocktail|\bbirra\b|\bbeer\b|aperitivo/i],
  [
    'food',
    /ristorante|trattoria|pizzeria|osteria|\bpizza\b|tavola\s+calda|\bgrill\b|restaurant|coperto|\bmenu\b|gelateria|\bgelato\b|kebab|sushi|burger/i,
  ],
  [
    'tickets',
    /\bingresso\b|biglietto\s+d.ingresso|\bmuseo\b|\bmuseum\b|\bcinema\b|teatro|\badmission\b|\bentry\b|castello|parco\s+(?:divertimenti|naturale)/i,
  ],
  [
    'activities',
    /escursione|\btour\b|noleggio\s+(?:bici|barca|scooter)|\bguida\b|\bexcursion\b|\bcrociera\b/i,
  ],
  ['health', /farmacia|pharmacy|parafarmacia|\bmedic/i],
  ['communication', /\bsim\b|\bgb\b|ricarica\s+telefon|vodafone|\btim\b|\bwind\b|iliad/i],
  ['car', /autonoleggio|rent\s*a\s*car|\bavis\b|\bhertz\b|\bsixt\b|\beuropcar\b/i],
  ['shopping', /abbigliamento|boutique|souvenir|\bshop\b|negozio|\bstore\b/i],
];

function findCategory(text: string): ExpenseCategory {
  for (const [category, pattern] of CATEGORY_RULES) if (pattern.test(text)) return category;
  return 'other';
}

// ─── Righe ──────────────────────────────────────────────────────────────────

// Dopo il prezzo l'OCR lascia spesso qualche segno ("SESS", "=", "—") dei bordi della carta.
const ITEM_LINE = /^(?:(\d{1,2})\s*[x×*]\s*)?(.{2,}?)\s+(-?\d{1,4}[.,]\d{2})\s*[^\d]{0,10}$/;
const NOT_ITEM =
  /totale|total|sub\s*-?\s*total|\biva\b|\bvat\b|\btax\b|resto|change|contanti|\bcash\b|pagament|bancomat|\bcarta\b|\bcard\b|imponibile|importo|\bpos\b|p\.?\s*iva|tel\b|data\b|ora\b|\bn\.\s*\d|arrotond|di\s+cui/i;

function findItems(lines: string[], until: number): ParsedReceipt['items'] {
  const items: ParsedReceipt['items'] = [];
  // Le prime righe sono l'intestazione (negozio, indirizzo, partita IVA).
  for (const raw of lines.slice(Math.min(2, until), until)) {
    if (NOT_ITEM.test(raw)) continue;
    // Colonne di aliquota IVA o sconto in percentuale ("22,00%"): non sono l'importo della riga.
    const line = raw
      .replace(/\b\d{1,3}(?:[.,]\s?\d{1,2})?\s*%/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const m = ITEM_LINE.exec(line);
    if (!m) continue;
    // Si tolgono i segni dei bordi della carta all'inizio e le code di punti o trattini.
    const name = m[2]!
      .replace(/\s+/g, ' ')
      .replace(/^[^\p{L}\p{N}]+/u, '')
      .replace(/[.\s-]+$/, '')
      .trim();
    if ((name.match(/\p{L}/gu) ?? []).length < 2 || moneyIn(name).length > 0) continue;
    const amount = Number(m[3]!.replace(',', '.'));
    if (!Number.isFinite(amount) || amount === 0) continue;
    items.push({ name: name.slice(0, 160), ...(m[1] ? { quantity: +m[1] } : {}), amount });
    if (items.length >= 80) break;
  }
  return items;
}

// ─── Insieme ────────────────────────────────────────────────────────────────

export function parseReceiptText(
  text: string,
  options: { currency?: CurrencyCode; today?: Date } = {},
): ParsedReceipt | null {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  if (lines.length < 2) return null;
  const today = options.today ?? new Date();

  const candidates = totalCandidates(lines);
  // Senza nessuna riga di totale si ripiega sull'importo più alto, ma con poca fiducia.
  const all = lines.flatMap((l) => (NOT_TOTAL.test(l) ? [] : moneyIn(l)));
  const lastResort = all.length ? Math.max(...all) : 0;

  const lastTotalLine = Math.max(...candidates.map((c) => c.index), -1);
  const items = findItems(lines, lastTotalLine >= 0 ? lastTotalLine : lines.length);
  const itemsSum = Math.round(items.reduce((a, i) => a + i.amount, 0) * 100) / 100;
  // Se le righe lette sommano a un importo candidato, è una conferma in più.
  const itemsOk = items.length >= 2;
  if (itemsOk) {
    const match = candidates.find((c) => Math.abs(c.value - itemsSum) < 0.011);
    if (match) {
      match.score += 3;
      match.support += 1;
    } else if (itemsSum > 0 && candidates.length === 0) {
      candidates.push({ value: itemsSum, score: 1, support: 1, best: 0, index: lines.length });
    }
  }
  const chosen = [...candidates].sort((a, b) => b.score - a.score || b.value - a.value)[0];
  const total = chosen?.value ?? lastResort;
  if (!(total > 0)) return null;

  const merchant = findMerchant(lines);
  const date = findDate(text, today);
  const category = findCategory(text);
  const support = chosen?.support ?? 0;
  // Più importi diversi, ciascuno letto in una riga di totale, e nessuno confermato più degli
  // altri (tipico di una cifra letta male, come 5 al posto di 9): non ci si può fidare.
  const conflict =
    !!chosen &&
    candidates.some(
      (c) => c !== chosen && c.score >= 1 && (c.support >= chosen.support || chosen.support < 2),
    );

  // Alta fiducia solo se il totale è confermato da almeno due punti dello scontrino (la data,
  // se non c'è, si lascia da scegliere: lo scontrino potrebbe semplicemente non averla).
  const confidence: ParsedReceipt['confidence'] =
    support >= 2 && merchant && !conflict
      ? 'high'
      : support >= 1 && (chosen?.best ?? 0) >= 2 && (date || merchant) && !conflict
        ? 'medium'
        : support >= 2 && !conflict
          ? 'medium'
          : conflict && support >= 1
            ? 'low'
            : support >= 1 && (chosen?.best ?? 0) >= 2
              ? 'medium'
              : 'low';
  const notes: string[] = [];
  if (!date) notes.push('Data non letta.');
  if (conflict) notes.push('Il totale non è chiaro: controllalo.');
  if (itemsOk && Math.abs(itemsSum - total) > Math.max(0.5, total * 0.1))
    notes.push('Le righe lette non sommano al totale: controllale.');
  const tax = lines
    .filter((l) => /\biva\b|\bvat\b|\btax\b/i.test(l) && !/imponibile/i.test(l))
    .flatMap(moneyIn)
    .filter((v) => v > 0 && v < total)
    .at(-1);

  return {
    title: (merchant ?? 'Scontrino').slice(0, 160),
    ...(merchant ? { merchant } : {}),
    ...(date ? { date } : {}),
    total,
    currency: findCurrency(text, options.currency ?? 'EUR'),
    category,
    emoji: EXPENSE_CATEGORIES[category].emoji,
    items: itemsOk ? items : [],
    ...(tax ? { tax } : {}),
    confidence,
    ...(notes.length ? { notes: notes.join(' ') } : {}),
  };
}

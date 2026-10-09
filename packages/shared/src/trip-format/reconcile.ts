import type { Booking, Place } from './schema.js';

/**
 * Riconciliazione tra ciò che arriva da un documento (letto dall'AI) e ciò che è già nel
 * viaggio: si riconoscono prenotazioni, luoghi, spese e biglietti già presenti, così da
 * integrarli invece di crearne dei doppioni. Le regole sono deterministiche e non dipendono
 * dall'AI, che può sbagliare nel riconoscere un elemento esistente.
 */

/** Testo confrontabile: minuscolo, senza accenti né punteggiatura. */
export function normalizeText(text: string | undefined | null): string {
  return (text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Codice confrontabile: solo lettere e cifre maiuscole ("4471.902.113" → "4471902113"). */
export function normalizeCode(code: string | undefined | null): string {
  return (code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

const STOP = new Set(['hotel', 'volo', 'flight', 'from', 'with', 'della', 'delle', 'the', 'and']);
const tokens = (text: string | undefined) =>
  new Set(
    normalizeText(text)
      .split(' ')
      .filter((w) => w.length >= 4 && !STOP.has(w)),
  );
const overlap = (a: Set<string>, b: Set<string>) => [...a].some((w) => b.has(w));

/** Prenotazione esistente che corrisponde a quella letta, se c'è. */
export function matchBooking(
  incoming: Booking & { existing?: boolean },
  existing: readonly Booking[],
): Booking | undefined {
  if (incoming.existing) {
    const byId = existing.find((b) => b.id === incoming.id);
    if (byId) return byId;
  }
  const code = normalizeCode(incoming.confirmationCode);
  if (code.length >= 4) {
    const byCode = existing.find((b) => normalizeCode(b.confirmationCode) === code);
    if (byCode) return byCode;
  }
  const flight = normalizeCode(incoming.flight?.number);
  if (flight) {
    const byFlight = existing.find(
      (b) => normalizeCode(b.flight?.number) === flight && b.start.date === incoming.start.date,
    );
    if (byFlight) return byFlight;
  }
  const words = new Set([...tokens(incoming.title), ...tokens(incoming.provider)]);
  return existing.find(
    (b) =>
      b.type === incoming.type &&
      b.start.date === incoming.start.date &&
      overlap(words, new Set([...tokens(b.title), ...tokens(b.provider)])),
  );
}

export type BookingChange =
  | { field: 'confirmationCode'; value: string }
  | { field: 'provider'; value: string }
  | { field: 'startTime'; from?: string; value: string }
  | { field: 'end'; value: string }
  | { field: 'cost'; value: string }
  | { field: 'paid' }
  | { field: 'booked' }
  | { field: 'flight'; value: string }
  | { field: 'place' }
  | { field: 'notes' }
  | { field: 'links'; count: number };

/**
 * Integra una prenotazione esistente con i dati del documento. Il documento vale come fonte
 * più affidabile per codici, orari e costi; non si cancella nulla di ciò che c'era.
 */
export function mergeBooking(
  current: Booking,
  incoming: Booking,
  knownPlaceIds: ReadonlySet<string> = new Set(),
): { merged: Booking; changes: BookingChange[] } {
  const merged: Booking = structuredClone(current);
  const changes: BookingChange[] = [];

  if (
    incoming.confirmationCode &&
    normalizeCode(incoming.confirmationCode) !== normalizeCode(current.confirmationCode)
  ) {
    merged.confirmationCode = incoming.confirmationCode;
    changes.push({ field: 'confirmationCode', value: incoming.confirmationCode });
  }
  if (incoming.provider && !current.provider) {
    merged.provider = incoming.provider;
    changes.push({ field: 'provider', value: incoming.provider });
  }
  if (incoming.start.time && incoming.start.time !== current.start.time) {
    merged.start = { ...merged.start, time: incoming.start.time };
    changes.push({ field: 'startTime', from: current.start.time, value: incoming.start.time });
  }
  if (
    incoming.end &&
    (incoming.end.date !== current.end?.date ||
      (incoming.end.time && incoming.end.time !== current.end?.time))
  ) {
    merged.end = { ...incoming.end };
    changes.push({
      field: 'end',
      value: `${incoming.end.date}${incoming.end.time ? ` ${incoming.end.time}` : ''}`,
    });
  }
  if (
    incoming.cost &&
    (!current.cost ||
      current.cost.amount !== incoming.cost.amount ||
      current.cost.currency !== incoming.cost.currency)
  ) {
    merged.cost = { ...incoming.cost };
    changes.push({ field: 'cost', value: `${incoming.cost.amount} ${incoming.cost.currency}` });
  }
  if (incoming.paid === true && current.paid !== true) {
    merged.paid = true;
    changes.push({ field: 'paid' });
  }
  if (incoming.status === 'booked' && current.status !== 'booked') {
    merged.status = 'booked';
    changes.push({ field: 'booked' });
  }
  if (incoming.flight && !current.flight) {
    merged.flight = { ...incoming.flight };
    changes.push({
      field: 'flight',
      value: `${incoming.flight.number} ${incoming.flight.from} → ${incoming.flight.to}`,
    });
  }
  if (incoming.placeId && !current.placeId && knownPlaceIds.has(incoming.placeId)) {
    merged.placeId = incoming.placeId;
    changes.push({ field: 'place' });
  }
  if (incoming.notes && !normalizeText(current.notes).includes(normalizeText(incoming.notes))) {
    merged.notes = [current.notes, incoming.notes].filter(Boolean).join('\n').slice(0, 600);
    changes.push({ field: 'notes' });
  }
  const urls = new Set(current.links.map((l) => l.url));
  const newLinks = (incoming.links ?? []).filter((l) => !urls.has(l.url));
  if (newLinks.length) {
    merged.links = [...current.links, ...newLinks].slice(0, 20);
    changes.push({ field: 'links', count: newLinks.length });
  }
  return { merged, changes };
}

/** Luogo esistente con lo stesso nome (o un nome che lo contiene). */
export function matchPlace(incoming: Place, existing: readonly Place[]): Place | undefined {
  const name = normalizeText(incoming.name);
  if (!name) return undefined;
  return (
    existing.find((p) => p.id === incoming.id) ??
    existing.find((p) => normalizeText(p.name) === name) ??
    existing.find((p) => {
      const other = normalizeText(p.name);
      return (
        p.kind === incoming.kind &&
        Math.min(other.length, name.length) >= 5 &&
        (other.includes(name) || name.includes(other))
      );
    })
  );
}

export interface ExpenseLike {
  id: string;
  title: string;
  amount: number;
  currency: string;
  date: string;
  bookingId: string | null;
  status: string;
}

const dayDiff = (a: string, b: string) =>
  Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;

/**
 * Spesa esistente a cui si riferisce il documento: quella collegata alla stessa prenotazione,
 * oppure una con stessa valuta, importo simile (±1%) e data vicina (±1 giorno), oppure con
 * lo stesso titolo nello stesso giorno.
 */
export function matchExpense(
  incoming: { title: string; amount: number; currency: string; date?: string },
  expenses: readonly ExpenseLike[],
  bookingId?: string,
): ExpenseLike | undefined {
  if (bookingId) {
    const linked = expenses.find((e) => e.bookingId === bookingId);
    if (linked) return linked;
  }
  const near = (e: ExpenseLike) => !incoming.date || dayDiff(e.date, incoming.date) <= 1;
  return (
    expenses.find(
      (e) =>
        e.currency === incoming.currency &&
        Math.abs(e.amount - incoming.amount) <= Math.max(1, incoming.amount * 0.01) &&
        near(e),
    ) ??
    expenses.find(
      (e) =>
        normalizeText(e.title) === normalizeText(incoming.title) &&
        !!incoming.date &&
        e.date === incoming.date,
    )
  );
}

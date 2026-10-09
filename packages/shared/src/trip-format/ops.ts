import { z } from 'zod';
import {
  ActivitySchema,
  AlternativeSchema,
  BookingSchema,
  BudgetItemSchema,
  CurrencySchema,
  IsoDateSchema,
  PackingItemSchema,
  PlaceSchema,
  RefSchema,
  TipSchema,
  TripDocumentSchema,
  type Activity,
  type Day,
  type TripDocument,
  type TripDocumentInput,
} from './schema.js';

/**
 * Operazioni di modifica del programma di un viaggio. Il programma è salvato nel formato
 * standard (TripDocument); ogni modifica è un'operazione piccola, applicata sul server in modo
 * atomico, così più persone possono lavorare insieme senza sovrascriversi.
 * Le stesse operazioni sono usate dall'AI per proporre modifiche.
 */

const OptionalId = RefSchema.optional();
const ActivityInput = ActivitySchema.extend({ id: OptionalId });
const AlternativeInput = AlternativeSchema.extend({
  id: OptionalId,
  activities: z.array(ActivityInput).min(1),
});

export const PlanOpSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('upsertDay'),
    day: z.object({
      date: IsoDateSchema,
      title: z.string().min(1).max(160),
      route: z.array(z.string().max(80)).optional(),
      stayBookingId: RefSchema.nullable().optional(),
      summary: z.string().max(600).nullable().optional(),
    }),
  }),
  z.object({ type: z.literal('deleteDay'), date: IsoDateSchema }),
  /** Crea i giorni mancanti tra due date (non elimina quelli esistenti). */
  z.object({
    type: z.literal('ensureDays'),
    start: IsoDateSchema,
    end: IsoDateSchema,
    titlePrefix: z.string().max(40).optional(),
  }),
  z.object({
    type: z.literal('upsertActivity'),
    date: IsoDateSchema,
    activity: ActivityInput,
    alternativeId: RefSchema.optional(),
  }),
  z.object({ type: z.literal('deleteActivity'), id: RefSchema }),
  z.object({ type: z.literal('moveActivity'), id: RefSchema, date: IsoDateSchema }),
  z.object({
    type: z.literal('upsertAlternative'),
    date: IsoDateSchema,
    alternative: AlternativeInput,
  }),
  z.object({ type: z.literal('deleteAlternative'), id: RefSchema }),
  /** Sostituisce nel giorno le attività indicate dall'alternativa con quelle dell'alternativa. */
  z.object({ type: z.literal('applyAlternative'), id: RefSchema }),
  z.object({ type: z.literal('upsertPlace'), place: PlaceSchema.extend({ id: OptionalId }) }),
  /** Imposta (o, senza `photo`, toglie) la foto di un luogo. */
  z.object({
    type: z.literal('setPlacePhoto'),
    id: RefSchema,
    photo: PlaceSchema.shape.photo,
    photoCredit: PlaceSchema.shape.photoCredit,
  }),
  z.object({ type: z.literal('deletePlace'), id: RefSchema }),
  z.object({ type: z.literal('upsertBooking'), booking: BookingSchema.extend({ id: OptionalId }) }),
  z.object({ type: z.literal('deleteBooking'), id: RefSchema }),
  z.object({
    type: z.literal('upsertBudgetItem'),
    item: BudgetItemSchema.extend({ id: OptionalId }),
  }),
  z.object({ type: z.literal('deleteBudgetItem'), id: RefSchema }),
  z.object({ type: z.literal('upsertPackingItem'), item: PackingItemSchema }),
  z.object({ type: z.literal('deletePackingItem'), id: RefSchema }),
  z.object({ type: z.literal('setTips'), tips: z.array(TipSchema).max(50) }),
  z.object({
    type: z.literal('setExchangeRates'),
    rates: z.partialRecord(CurrencySchema, z.number().positive()),
  }),
]);
export type PlanOp = z.input<typeof PlanOpSchema>;

export class PlanOpError extends Error {}

const slug = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'item';

/** Tutti gli id usati nel documento (per generarne di nuovi senza collisioni). */
export function collectIds(doc: TripDocument): Set<string> {
  const ids = new Set<string>();
  doc.places.forEach((p) => ids.add(p.id));
  doc.bookings.forEach((b) => ids.add(b.id));
  doc.budget.forEach((b) => ids.add(b.id));
  doc.packing.forEach((p) => p.id && ids.add(p.id));
  for (const day of doc.days) {
    day.activities.forEach((a) => ids.add(a.id));
    for (const alt of day.alternatives) {
      ids.add(alt.id);
      alt.activities.forEach((a) => ids.add(a.id));
    }
  }
  return ids;
}

export function newId(base: string, used: Set<string>): string {
  const root = slug(base);
  let id = root;
  for (let n = 2; used.has(id); n++) id = `${root}-${n}`.slice(0, 64);
  used.add(id);
  return id;
}

/** Ordina le attività per orario; quelle senza orario restano dopo la precedente. */
export function sortActivities(list: Activity[]): Activity[] {
  let last = '00:00';
  const keyed = list.map((a, i) => {
    if (a.time) last = a.time;
    return { a, key: a.time ?? last, i };
  });
  return keyed.sort((x, y) => x.key.localeCompare(y.key) || x.i - y.i).map((k) => k.a);
}

function findDay(doc: TripDocument, date: string): Day {
  const day = doc.days.find((d) => d.date === date);
  if (!day) throw new PlanOpError(`DAY_NOT_FOUND:${date}`);
  return day;
}

function locateActivity(doc: TripDocument, id: string) {
  for (const day of doc.days) {
    const i = day.activities.findIndex((a) => a.id === id);
    if (i >= 0) return { day, list: day.activities, index: i, alternative: null };
    for (const alt of day.alternatives) {
      const j = alt.activities.findIndex((a) => a.id === id);
      if (j >= 0) return { day, list: alt.activities, index: j, alternative: alt };
    }
  }
  return null;
}

function upsertBy<T extends { id?: string }>(list: T[], item: T & { id: string }) {
  const i = list.findIndex((x) => x.id === item.id);
  if (i >= 0) list[i] = item;
  else list.push(item);
}

function addDays(iso: string, n: number) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Elenco delle date tra start ed end incluse (massimo 120 giorni). */
export function dateRange(start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = start; d <= end && out.length < 120; d = addDays(d, 1)) out.push(d);
  return out;
}

/**
 * Applica una sequenza di operazioni e restituisce un nuovo documento validato.
 * Lancia PlanOpError per riferimenti inesistenti o un errore di validazione Zod.
 */
export function applyPlanOps(input: TripDocument, ops: PlanOp[]): TripDocument {
  const doc: TripDocument = structuredClone(input);
  const used = collectIds(doc);

  for (const raw of ops) {
    const op = PlanOpSchema.parse(raw);
    switch (op.type) {
      case 'upsertDay': {
        const existing = doc.days.find((d) => d.date === op.day.date);
        if (existing) {
          existing.title = op.day.title;
          if (op.day.route !== undefined) existing.route = op.day.route;
          if (op.day.stayBookingId !== undefined)
            existing.stayBookingId = op.day.stayBookingId ?? undefined;
          if (op.day.summary !== undefined) existing.summary = op.day.summary ?? undefined;
        } else {
          doc.days.push({
            date: op.day.date,
            title: op.day.title,
            route: op.day.route ?? [],
            stayBookingId: op.day.stayBookingId ?? undefined,
            summary: op.day.summary ?? undefined,
            activities: [],
            alternatives: [],
          });
          doc.days.sort((a, b) => a.date.localeCompare(b.date));
        }
        break;
      }
      case 'deleteDay':
        doc.days = doc.days.filter((d) => d.date !== op.date);
        break;
      case 'ensureDays': {
        if (op.end < op.start) throw new PlanOpError('END_BEFORE_START');
        dateRange(op.start, op.end).forEach((date, i) => {
          if (!doc.days.some((d) => d.date === date)) {
            doc.days.push({
              date,
              title: `${op.titlePrefix ?? 'Giorno'} ${i + 1}`,
              route: [],
              activities: [],
              alternatives: [],
            });
          }
        });
        doc.days.sort((a, b) => a.date.localeCompare(b.date));
        break;
      }
      case 'upsertActivity': {
        const activity = {
          ...op.activity,
          id: op.activity.id ?? newId(op.activity.title, used),
        } as Activity;
        const found = op.activity.id ? locateActivity(doc, op.activity.id) : null;
        if (found) {
          found.list[found.index] = activity;
          if (!found.alternative) found.day.activities = sortActivities(found.day.activities);
          else found.alternative.activities = sortActivities(found.alternative.activities);
          break;
        }
        const day = findDay(doc, op.date);
        if (op.alternativeId) {
          const alt = day.alternatives.find((a) => a.id === op.alternativeId);
          if (!alt) throw new PlanOpError(`ALTERNATIVE_NOT_FOUND:${op.alternativeId}`);
          alt.activities = sortActivities([...alt.activities, activity]);
        } else {
          day.activities = sortActivities([...day.activities, activity]);
        }
        break;
      }
      case 'deleteActivity': {
        const found = locateActivity(doc, op.id);
        if (!found) throw new PlanOpError(`ACTIVITY_NOT_FOUND:${op.id}`);
        found.list.splice(found.index, 1);
        for (const alt of found.day.alternatives)
          alt.replacesActivityIds = alt.replacesActivityIds.filter((x) => x !== op.id);
        // Un'alternativa rimasta senza attività non ha senso: si elimina.
        found.day.alternatives = found.day.alternatives.filter((a) => a.activities.length > 0);
        break;
      }
      case 'moveActivity': {
        const found = locateActivity(doc, op.id);
        if (!found || found.alternative) throw new PlanOpError(`ACTIVITY_NOT_FOUND:${op.id}`);
        const target = findDay(doc, op.date);
        const [activity] = found.list.splice(found.index, 1);
        for (const alt of found.day.alternatives)
          alt.replacesActivityIds = alt.replacesActivityIds.filter((x) => x !== op.id);
        target.activities = sortActivities([...target.activities, activity!]);
        break;
      }
      case 'upsertAlternative': {
        const day = findDay(doc, op.date);
        const alternative = {
          ...op.alternative,
          id: op.alternative.id ?? newId(op.alternative.title, used),
          activities: op.alternative.activities.map((a) => ({
            ...a,
            id: a.id ?? newId(a.title, used),
          })),
        } as Day['alternatives'][number];
        upsertBy(day.alternatives, alternative);
        break;
      }
      case 'deleteAlternative':
        for (const day of doc.days)
          day.alternatives = day.alternatives.filter((a) => a.id !== op.id);
        break;
      case 'applyAlternative': {
        const day = doc.days.find((d) => d.alternatives.some((a) => a.id === op.id));
        if (!day) throw new PlanOpError(`ALTERNATIVE_NOT_FOUND:${op.id}`);
        const alt = day.alternatives.find((a) => a.id === op.id)!;
        const replaced = day.activities.filter((a) => alt.replacesActivityIds.includes(a.id));
        day.activities = sortActivities([
          ...day.activities.filter((a) => !alt.replacesActivityIds.includes(a.id)),
          ...alt.activities,
        ]);
        // Il piano originale diventa a sua volta un'alternativa, così si può tornare indietro.
        day.alternatives = day.alternatives.filter((a) => a.id !== op.id);
        if (replaced.length) {
          day.alternatives.push({
            id: newId(`piano-originale-${day.date}`, used),
            title: alt.replacesActivityIds.length
              ? `↩︎ ${replaced.map((a) => a.title).join(', ')}`.slice(0, 160)
              : '↩︎',
            replacesActivityIds: alt.activities.map((a) => a.id),
            activities: replaced,
          });
        }
        break;
      }
      case 'upsertPlace': {
        const id = op.place.id ?? newId(op.place.name, used);
        // Chi modifica un luogo senza citare la foto (AI, import) non deve farla sparire:
        // per toglierla c'è setPlacePhoto.
        const previous = doc.places.find((p) => p.id === id);
        upsertBy(doc.places, {
          ...op.place,
          id,
          ...(!op.place.photo && previous?.photo
            ? { photo: previous.photo, photoCredit: previous.photoCredit }
            : {}),
        });
        break;
      }
      case 'setPlacePhoto': {
        const place = doc.places.find((p) => p.id === op.id);
        if (!place) throw new PlanOpError(`PLACE_NOT_FOUND:${op.id}`);
        place.photo = op.photo;
        place.photoCredit = op.photo ? op.photoCredit : undefined;
        break;
      }
      case 'deletePlace':
        doc.places = doc.places.filter((p) => p.id !== op.id);
        for (const day of doc.days) {
          for (const a of [...day.activities, ...day.alternatives.flatMap((x) => x.activities)]) {
            a.placeIds = a.placeIds.filter((x) => x !== op.id);
          }
        }
        for (const b of doc.bookings) if (b.placeId === op.id) b.placeId = undefined;
        break;
      case 'upsertBooking':
        upsertBy(doc.bookings, {
          ...op.booking,
          id: op.booking.id ?? newId(op.booking.title, used),
        });
        break;
      case 'deleteBooking':
        doc.bookings = doc.bookings.filter((b) => b.id !== op.id);
        for (const day of doc.days) {
          if (day.stayBookingId === op.id) day.stayBookingId = undefined;
          for (const a of [...day.activities, ...day.alternatives.flatMap((x) => x.activities)]) {
            if (a.bookingId === op.id) a.bookingId = undefined;
          }
        }
        for (const b of doc.budget) if (b.bookingId === op.id) b.bookingId = undefined;
        break;
      case 'upsertBudgetItem':
        upsertBy(doc.budget, { ...op.item, id: op.item.id ?? newId(op.item.title, used) });
        break;
      case 'deleteBudgetItem':
        doc.budget = doc.budget.filter((b) => b.id !== op.id);
        break;
      case 'upsertPackingItem':
        upsertBy(doc.packing, { ...op.item, id: op.item.id ?? newId(op.item.item, used) });
        break;
      case 'deletePackingItem':
        doc.packing = doc.packing.filter((p) => p.id !== op.id);
        break;
      case 'setTips':
        doc.tips = op.tips;
        break;
      case 'setExchangeRates':
        doc.exchangeRates = { ...doc.exchangeRates, ...op.rates };
        break;
    }
  }
  return TripDocumentSchema.parse(doc);
}

/** Assegna un id agli elementi della lista bagagli che non lo hanno (documenti importati o dall'AI). */
export function normalizePlan(doc: TripDocument): TripDocument {
  const used = collectIds(doc);
  return {
    ...doc,
    packing: doc.packing.map((p) => (p.id ? p : { ...p, id: newId(p.item, used) })),
  };
}

/** Documento vuoto per un viaggio senza programma. */
export function emptyPlan(trip: {
  title: string;
  emoji?: string | null;
  destination?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  currency: TripDocument['trip']['currency'];
  travelers: number;
  language: TripDocument['language'];
}): TripDocument {
  const doc: TripDocumentInput = {
    formatVersion: 1,
    language: trip.language,
    trip: {
      title: trip.title,
      emoji: trip.emoji ?? undefined,
      destination: { name: trip.destination || trip.title, countryCodes: [] },
      startDate: trip.startDate ?? undefined,
      endDate: trip.endDate ?? undefined,
      currency: trip.currency,
      travelers: Math.max(1, trip.travelers),
    },
  };
  return TripDocumentSchema.parse(doc);
}

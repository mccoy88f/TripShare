import { z } from 'zod';
import { CURRENCY_CODES } from '../currencies.js';
import { EXPENSE_CATEGORY_KEYS } from '../categories.js';
import { LOCALES } from '../locales.js';

/**
 * TripShare Trip Format, versione 1.
 *
 * È il formato standard con cui un viaggio entra ed esce da TripShare: lo produce l'AI quando
 * genera un viaggio, lo usano import ed export. Le descrizioni dei campi finiscono nel JSON Schema
 * e guidano il modello, quindi vanno scritte per chi deve compilare il documento.
 *
 * Regole generali:
 * - date in formato ISO `YYYY-MM-DD`, orari `HH:MM` (24 ore) nell'ora locale del luogo;
 * - importi in unità maggiori (es. 23.5 = 23,50 £); l'app li converte in centesimi;
 * - gli oggetti si collegano tra loro con `id` brevi in kebab-case (es. `edinburgh-castle`).
 */

export const TRIP_FORMAT_VERSION = 1 as const;
export const TRIP_FORMAT_SCHEMA_ID = 'https://tripshare.app/schema/trip.v1.schema.json';

const d = (description: string) => ({ description });

export const RefSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,63}$/)
  .meta(d('Identificativo locale in kebab-case, unico nel documento, es. "urquhart-castle".'));

const RefListSchema = z.array(RefSchema);

export const IsoDateSchema = z.iso.date().meta(d('Data ISO 8601, es. "2026-10-12".'));

export const LocalTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
  .meta(d('Orario locale HH:MM a 24 ore, es. "08:15".'));

export const CurrencySchema = z.enum(CURRENCY_CODES).meta(d('Codice valuta ISO 4217.'));

export const LinkSchema = z
  .object({
    title: z.string().min(1).max(120),
    url: z.url(),
  })
  .meta(d('Link esterno utile: sito ufficiale, biglietti, guida.'));

export const MoneySchema = z
  .object({
    amount: z.number().nonnegative().meta(d('Importo in unità maggiori, es. 23.5.')),
    currency: CurrencySchema,
    basis: z
      .enum(['total', 'per_person', 'per_night', 'per_vehicle', 'per_day'])
      .default('total')
      .meta(d('A cosa si riferisce l\'importo. "per_person" viene moltiplicato per i viaggiatori.')),
    approximate: z
      .boolean()
      .default(false)
      .meta(d('true se è una stima e non un prezzo letto da una fonte o da una prenotazione.')),
    note: z.string().max(200).optional().meta(d('Es. "14 £ online, 16 £ in loco".')),
  })
  .meta(d('Importo con valuta.'));

export const VerificationSchema = z
  .object({
    status: z
      .enum(['verified', 'unverified'])
      .meta(d('"verified" solo se l\'informazione è stata letta su una fonte ufficiale citata.')),
    checkedAt: IsoDateSchema.optional().meta(d('Giorno in cui la fonte è stata controllata.')),
    sources: z.array(LinkSchema).default([]),
  })
  .meta(d('Affidabilità di orari e prezzi.'));

export const PLACE_KINDS = [
  'sight',
  'museum',
  'nature',
  'viewpoint',
  'restaurant',
  'cafe',
  'bar',
  'lodging',
  'airport',
  'station',
  'parking',
  'car_rental',
  'shop',
  'neighborhood',
  'city',
  'other',
] as const;

export const PlaceSchema = z
  .object({
    id: RefSchema,
    name: z.string().min(1).max(160),
    kind: z.enum(PLACE_KINDS),
    address: z.string().max(240).optional(),
    mapsQuery: z
      .string()
      .max(240)
      .optional()
      .meta(d('Testo da cercare su una mappa, es. "Urquhart Castle, Drumnadrochit".')),
    location: z
      .object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) })
      .optional(),
    openingHours: z
      .string()
      .max(400)
      .optional()
      .meta(d('Orari in testo libero per le date del viaggio, es. "9:30–17:00, ultimo ingresso 16:00".')),
    price: MoneySchema.optional().meta(d('Prezzo di ingresso o costo tipico.')),
    priceLevel: z
      .number()
      .int()
      .min(1)
      .max(4)
      .optional()
      .meta(d('Fascia di prezzo da 1 (economico) a 4 (caro), utile per ristoranti.')),
    meals: z
      .array(z.enum(['breakfast', 'lunch', 'dinner', 'snack']))
      .optional()
      .meta(d('Per ristoranti e caffè: pasti consigliati.')),
    description: z.string().max(1000).optional(),
    tips: z.array(z.string().max(300)).default([]),
    verification: VerificationSchema.optional(),
    links: z.array(LinkSchema).default([]),
  })
  .meta(d('Luogo citato dal programma: attrazione, ristorante, alloggio, aeroporto…'));

export const BOOKING_TYPES = [
  'flight',
  'lodging',
  'car_rental',
  'parking',
  'train',
  'bus',
  'ferry',
  'tour',
  'ticket',
  'insurance',
  'other',
] as const;

export const BookingSchema = z
  .object({
    id: RefSchema,
    type: z.enum(BOOKING_TYPES),
    title: z.string().min(1).max(160).meta(d('Es. "Volo Ryanair FR5590 Ciampino → Edimburgo".')),
    status: z
      .enum(['booked', 'to_book', 'optional'])
      .meta(d('"booked" se già prenotato, "to_book" se va prenotato, "optional" se facoltativo.')),
    provider: z.string().max(120).optional(),
    confirmationCode: z.string().max(80).optional(),
    start: z
      .object({ date: IsoDateSchema, time: LocalTimeSchema.optional() })
      .meta(d('Inizio: partenza, check-in, ritiro.')),
    end: z
      .object({ date: IsoDateSchema, time: LocalTimeSchema.optional() })
      .optional()
      .meta(d('Fine: arrivo, check-out, riconsegna.')),
    placeId: RefSchema.optional().meta(d('Luogo principale (alloggio, parcheggio, punto di ritiro).')),
    flight: z
      .object({
        number: z.string().max(12),
        from: z.string().max(80).meta(d('Aeroporto di partenza, preferibilmente con codice IATA.')),
        to: z.string().max(80),
      })
      .optional(),
    cost: MoneySchema.optional(),
    paid: z.boolean().optional().meta(d('true se è già pagato, false se si paga sul posto.')),
    notes: z.string().max(600).optional(),
    links: z.array(LinkSchema).default([]),
  })
  .meta(d('Prenotazione: volo, alloggio, noleggio, parcheggio, biglietto…'));

export const TRANSPORT_MODES = [
  'car',
  'walk',
  'bike',
  'taxi',
  'rideshare',
  'bus',
  'tram',
  'metro',
  'train',
  'ferry',
  'flight',
  'shuttle',
  'other',
] as const;

export const TransportOptionSchema = z.object({
  mode: z.enum(TRANSPORT_MODES),
  durationMinutes: z.number().int().positive().optional(),
  distanceKm: z.number().positive().optional(),
  route: z.string().max(120).optional().meta(d('Strade o linee, es. "A82" o "Tram linea 1".')),
  cost: MoneySchema.optional(),
  notes: z.string().max(300).optional(),
});

export const TransportSchema = TransportOptionSchema.extend({
  alternatives: z
    .array(TransportOptionSchema)
    .default([])
    .meta(d('Altri mezzi possibili per lo stesso spostamento, es. Uber al posto del tram.')),
}).meta(d('Spostamento associato all\'attività.'));

export const ACTIVITY_TYPES = [
  'travel',
  'flight',
  'visit',
  'meal',
  'checkin',
  'checkout',
  'pickup',
  'dropoff',
  'activity',
  'shopping',
  'free_time',
  'other',
] as const;

export const ActivitySchema = z
  .object({
    id: RefSchema,
    time: LocalTimeSchema.optional().meta(d('Orario di inizio. Omettere solo se davvero libero.')),
    endTime: LocalTimeSchema.optional(),
    type: z.enum(ACTIVITY_TYPES),
    emoji: z.string().max(16).optional().meta(d('Una sola emoji rappresentativa.')),
    title: z.string().min(1).max(160),
    description: z.string().max(1500).optional(),
    placeIds: RefListSchema.default([]).meta(d('Luoghi coinvolti, riferiti a places[].id.')),
    bookingId: RefSchema.optional().meta(d('Prenotazione collegata, riferita a bookings[].id.')),
    transport: TransportSchema.optional(),
    cost: MoneySchema.optional().meta(d('Costo previsto dell\'attività.')),
    warnings: z
      .array(z.string().max(300))
      .default([])
      .meta(d('Avvisi importanti: chiusure, tramonto, prenotazione obbligatoria.')),
    tips: z.array(z.string().max(300)).default([]),
    links: z.array(LinkSchema).default([]),
  })
  .meta(d('Voce del programma di un giorno.'));

export const AlternativeSchema = z
  .object({
    id: RefSchema,
    title: z.string().min(1).max(160).meta(d('Es. "Steall Falls al posto di Loch Ness".')),
    when: z.string().max(200).optional().meta(d('Quando conviene, es. "se piove forte".')),
    replacesActivityIds: RefListSchema.meta(d('Attività del giorno che questa alternativa sostituisce.')),
    activities: z.array(ActivitySchema).min(1),
    tradeoffs: z.string().max(400).optional().meta(d('Cosa si perde e cosa si guadagna.')),
  })
  .meta(d('Piano alternativo per una parte del giorno.'));

export const DaySchema = z
  .object({
    date: IsoDateSchema,
    title: z.string().min(1).max(160),
    route: z
      .array(z.string().max(80))
      .default([])
      .meta(d('Tappe principali nell\'ordine, es. ["Fort William", "Glenfinnan", "Loch Ness"].')),
    stayBookingId: RefSchema.optional().meta(d('Prenotazione dell\'alloggio per la notte.')),
    summary: z.string().max(600).optional(),
    activities: z.array(ActivitySchema).default([]).meta(d('In ordine cronologico.')),
    alternatives: z.array(AlternativeSchema).default([]),
  })
  .meta(d('Giorno del viaggio.'));

export const BudgetItemSchema = z
  .object({
    id: RefSchema,
    title: z.string().min(1).max(160),
    category: z.enum(EXPENSE_CATEGORY_KEYS),
    emoji: z.string().max(16).optional(),
    status: z
      .enum(['booked', 'pending', 'estimate'])
      .meta(
        d(
          '"booked" prenotato con importo noto, "pending" prenotato ma importo da inserire, "estimate" stima.',
        ),
      ),
    amount: MoneySchema.optional().meta(d('Omettere solo per le voci "pending".')),
    included: z.boolean().default(true).meta(d('false per le voci facoltative escluse dal totale.')),
    bookingId: RefSchema.optional(),
    notes: z.string().max(400).optional(),
  })
  .meta(d('Voce di budget prevista per il viaggio.'));

export const PackingItemSchema = z
  .object({
    item: z.string().min(1).max(160),
    group: z
      .enum(['documents', 'clothing', 'electronics', 'health', 'gear', 'food', 'other'])
      .meta(d('"documents" include anche prenotazioni e check-in da fare prima di partire.')),
    perPerson: z.boolean().default(false).meta(d('true se ogni viaggiatore ne deve avere uno.')),
    reason: z.string().max(300).optional(),
  })
  .meta(d('Cosa portare o preparare.'));

export const TipSchema = z.object({
  title: z.string().min(1).max(120),
  text: z.string().min(1).max(600),
});

export const TripDocumentSchema = z
  .object({
    $schema: z.string().optional(),
    formatVersion: z.literal(TRIP_FORMAT_VERSION),
    language: z.enum(LOCALES).meta(d('Lingua dei testi del documento.')),
    trip: z.object({
      title: z.string().min(1).max(120),
      emoji: z.string().max(16).optional(),
      summary: z.string().max(600).optional(),
      destination: z.object({
        name: z.string().min(1).max(120),
        countryCodes: z
          .array(z.string().regex(/^[A-Z]{2}$/))
          .min(1)
          .meta(d('Paesi visitati, codici ISO 3166-1 alpha-2.')),
      }),
      startDate: IsoDateSchema,
      endDate: IsoDateSchema,
      timezone: z.string().max(64).optional().meta(d('Fuso IANA principale, es. "Europe/London".')),
      currency: CurrencySchema.meta(d('Valuta del viaggio, usata per saldi e budget.')),
      travelers: z.number().int().min(1).max(100),
      style: z
        .array(z.string().max(40))
        .default([])
        .meta(d('Parole chiave sullo stile, es. ["in auto", "natura", "economico"].')),
      coverQuery: z
        .string()
        .max(120)
        .optional()
        .meta(d('Ricerca in inglese per una foto di copertina, es. "Glenfinnan viaduct autumn".')),
    }),
    places: z.array(PlaceSchema).default([]),
    bookings: z.array(BookingSchema).default([]),
    days: z.array(DaySchema).min(1).meta(d('Un elemento per ogni giorno, in ordine di data.')),
    budget: z.array(BudgetItemSchema).default([]),
    packing: z.array(PackingItemSchema).default([]),
    tips: z
      .array(TipSchema)
      .default([])
      .meta(d('Consigli generali: guida, fuso orario, pagamenti, connessione.')),
    exchangeRates: z
      .partialRecord(CurrencySchema, z.number().positive())
      .optional()
      .meta(
        d('Tassi usati per le stime: quante unità della valuta del viaggio vale 1 unità della chiave.'),
      ),
    disclaimer: z.string().max(400).optional(),
    generatedBy: z
      .object({ model: z.string().max(120).optional(), at: z.iso.datetime().optional() })
      .optional(),
  })
  .superRefine((doc, ctx) => {
    const issue = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: 'custom', path, message });

    if (doc.trip.endDate < doc.trip.startDate) {
      issue(['trip', 'endDate'], 'endDate must not be before startDate');
    }

    const ids = new Map<string, string>();
    const register = (id: string, path: (string | number)[]) => {
      const previous = ids.get(id);
      if (previous) issue(path, `duplicate id "${id}" (already used at ${previous})`);
      else ids.set(id, path.join('.'));
    };
    doc.places.forEach((p, i) => register(p.id, ['places', i, 'id']));
    doc.bookings.forEach((b, i) => register(b.id, ['bookings', i, 'id']));
    doc.budget.forEach((b, i) => register(b.id, ['budget', i, 'id']));
    doc.days.forEach((day, di) => {
      day.activities.forEach((a, ai) => register(a.id, ['days', di, 'activities', ai, 'id']));
      day.alternatives.forEach((alt, li) => {
        register(alt.id, ['days', di, 'alternatives', li, 'id']);
        alt.activities.forEach((a, ai) =>
          register(a.id, ['days', di, 'alternatives', li, 'activities', ai, 'id']),
        );
      });
    });

    const placeIds = new Set(doc.places.map((p) => p.id));
    const bookingIds = new Set(doc.bookings.map((b) => b.id));
    const checkActivity = (a: z.infer<typeof ActivitySchema>, path: (string | number)[]) => {
      a.placeIds.forEach((id, i) => {
        if (!placeIds.has(id)) issue([...path, 'placeIds', i], `unknown place "${id}"`);
      });
      if (a.bookingId && !bookingIds.has(a.bookingId)) {
        issue([...path, 'bookingId'], `unknown booking "${a.bookingId}"`);
      }
    };

    const seenDates = new Set<string>();
    let previousDate = '';
    doc.days.forEach((day, di) => {
      if (seenDates.has(day.date)) issue(['days', di, 'date'], `duplicate day ${day.date}`);
      seenDates.add(day.date);
      if (day.date < previousDate) issue(['days', di, 'date'], 'days must be in chronological order');
      previousDate = day.date;
      if (day.date < doc.trip.startDate || day.date > doc.trip.endDate) {
        issue(['days', di, 'date'], 'day is outside the trip dates');
      }
      if (day.stayBookingId && !bookingIds.has(day.stayBookingId)) {
        issue(['days', di, 'stayBookingId'], `unknown booking "${day.stayBookingId}"`);
      }
      const activityIds = new Set(day.activities.map((a) => a.id));
      day.activities.forEach((a, ai) => checkActivity(a, ['days', di, 'activities', ai]));
      day.alternatives.forEach((alt, li) => {
        alt.replacesActivityIds.forEach((id, i) => {
          if (!activityIds.has(id)) {
            issue(['days', di, 'alternatives', li, 'replacesActivityIds', i], `unknown activity "${id}" in this day`);
          }
        });
        alt.activities.forEach((a, ai) =>
          checkActivity(a, ['days', di, 'alternatives', li, 'activities', ai]),
        );
      });
    });

    doc.bookings.forEach((b, i) => {
      if (b.placeId && !placeIds.has(b.placeId)) {
        issue(['bookings', i, 'placeId'], `unknown place "${b.placeId}"`);
      }
    });
    doc.budget.forEach((b, i) => {
      if (b.bookingId && !bookingIds.has(b.bookingId)) {
        issue(['budget', i, 'bookingId'], `unknown booking "${b.bookingId}"`);
      }
      if (b.status !== 'pending' && !b.amount) {
        issue(['budget', i, 'amount'], 'amount is required unless status is "pending"');
      }
    });
  })
  .meta({
    id: 'TripDocument',
    title: 'TripShare Trip Format v1',
    description: 'Documento standard di un viaggio TripShare: programma, luoghi, prenotazioni, budget e lista.',
  });

export type TripDocument = z.infer<typeof TripDocumentSchema>;
export type TripDocumentInput = z.input<typeof TripDocumentSchema>;
export type Place = z.infer<typeof PlaceSchema>;
export type Booking = z.infer<typeof BookingSchema>;
export type Day = z.infer<typeof DaySchema>;
export type Activity = z.infer<typeof ActivitySchema>;
export type Alternative = z.infer<typeof AlternativeSchema>;
export type BudgetItem = z.infer<typeof BudgetItemSchema>;
export type PackingItem = z.infer<typeof PackingItemSchema>;
export type Money = z.infer<typeof MoneySchema>;

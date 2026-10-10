import { z } from 'zod';
import {
  CURRENCY_CODES,
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_KEYS,
  type Locale,
} from '@tripshare/shared';
import {
  BookingSchema,
  LinkSchema,
  MoneySchema,
  PackingItemSchema,
  PlaceSchema,
  PlanOpSchema,
  RefSchema,
  buildRepairMessage,
  buildTripGenerationRequest,
  extractJson,
  parseTripDocument,
  type TripDocument,
} from '@tripshare/shared/trip-format';
import type { AiPurpose } from './access.js';
import type { ChatMessage, ContentPart } from './client.js';

/**
 * Compiti AI di TripShare. Ognuno definisce: input, modello da usare, messaggi da inviare,
 * schema JSON della risposta e validazione. Le risposte non valide vengono rimandate al modello
 * con l'elenco degli errori (al massimo una o due volte).
 */

const lang = (l: Locale) => (l === 'en' ? 'English' : 'italiano');
const today = () => new Date().toISOString().slice(0, 10);

// ─── Scontrini e ricevute ───────────────────────────────────────────────────

export const ReceiptResultSchema = z.object({
  title: z.string().min(1).max(160).describe('Descrizione breve della spesa, es. "Cena da Mario"'),
  merchant: z.string().max(160).optional(),
  date: z.iso.date().optional().describe('Data dello scontrino, se leggibile'),
  total: z.number().positive().describe('Totale pagato, in unità maggiori'),
  currency: z.enum(CURRENCY_CODES),
  category: z.enum(EXPENSE_CATEGORY_KEYS),
  emoji: z.string().max(16).describe('Una sola emoji adatta'),
  items: z
    .array(
      z.object({
        name: z.string().min(1).max(160),
        quantity: z.number().positive().optional(),
        amount: z.number(),
      }),
    )
    .max(80)
    .default([])
    .describe('Righe dello scontrino con il loro importo totale (sconti come importi negativi)'),
  tax: z.number().nonnegative().optional(),
  tip: z.number().nonnegative().optional(),
  confidence: z.enum(['high', 'medium', 'low']),
  notes: z.string().max(400).optional().describe('Dubbi o parti illeggibili'),
});
export type ReceiptResult = z.infer<typeof ReceiptResultSchema>;

// ─── Prenotazioni da screenshot o PDF ───────────────────────────────────────

export const BookingResultSchema = z.object({
  bookings: z.array(BookingSchema.extend({ id: RefSchema.optional() })).max(20),
  travelers: z
    .array(z.string().max(120))
    .max(30)
    .default([])
    .describe('Nomi dei passeggeri / ospiti indicati nel documento'),
  notes: z.string().max(600).optional(),
});
export type BookingResult = z.infer<typeof BookingResultSchema>;

// ─── Assistente del viaggio ─────────────────────────────────────────────────

/** Spesa proposta dall'assistente: diventa una spesa vera solo quando l'utente la conferma. */
export const ExpenseProposalSchema = z.object({
  title: z.string().min(1).max(160),
  amount: z.number().positive().describe('Importo totale in unità maggiori'),
  currency: z.enum(CURRENCY_CODES),
  category: z.enum(EXPENSE_CATEGORY_KEYS),
  emoji: z.string().max(16).optional(),
  date: z.iso.date().optional(),
  paidBy: z
    .string()
    .max(120)
    .optional()
    .describe('Nome di chi ha pagato (o pagherà), come nel gruppo'),
  splitAmong: z
    .array(z.string().max(120))
    .max(50)
    .default([])
    .describe('Nomi tra cui dividere; vuoto = tutto il gruppo'),
  status: z.enum(['paid', 'planned']).default('paid').describe('"planned" se è ancora da pagare'),
  notes: z.string().max(400).optional(),
});
export type ExpenseProposal = z.infer<typeof ExpenseProposalSchema>;

export const ChatResultSchema = z.object({
  reply: z
    .string()
    .min(1)
    .max(4000)
    .describe(
      'Risposta per l’utente in Markdown semplice: **grassetto**, *corsivo*, elenchi puntati o numerati, link; niente HTML né titoli grandi',
    ),
  actions: z
    .array(PlanOpSchema)
    .max(30)
    .default([])
    .describe('Modifiche al programma proposte; vuoto se la domanda non richiede modifiche'),
  expenses: z
    .array(ExpenseProposalSchema)
    .max(10)
    .default([])
    .describe('Spese da registrare proposte; vuoto se l’utente non parla di spese'),
});
export type ChatResult = z.infer<typeof ChatResultSchema>;

// ─── Verifica di un luogo sul web ───────────────────────────────────────────

export const VerifyResultSchema = z.object({
  openingHours: z.string().max(400).optional(),
  price: MoneySchema.optional(),
  verified: z
    .boolean()
    .describe('true solo se orari/prezzi sono stati letti su una fonte ufficiale citata'),
  sources: z.array(LinkSchema).max(5).default([]),
  notes: z.string().max(600).optional().describe('Chiusure, avvisi, cambi d’orario stagionali'),
});
export type VerifyResult = z.infer<typeof VerifyResultSchema>;

// ─── Foto di un luogo trovate sul web ───────────────────────────────────────

export const PlacePhotoResultSchema = z.object({
  images: z
    .array(
      z.object({
        url: z
          .string()
          .regex(/^https:\/\/\S+$/)
          .describe(
            'Indirizzo https DIRETTO di un file immagine (jpg, png o webp), non di una pagina',
          ),
        title: z.string().max(160).optional(),
      }),
    )
    .max(8)
    .default([]),
});
export type PlacePhotoResult = z.infer<typeof PlacePhotoResultSchema>;

// ─── Documento fotografato (scontrino, ricevuta, conferma, carta d'imbarco…) ──

export const DOCUMENT_TYPES = [
  'receipt',
  'invoice',
  'booking_confirmation',
  'boarding_pass',
  'ticket',
  'other',
] as const;

export const DocumentResultSchema = z.object({
  documentType: z.enum(DOCUMENT_TYPES),
  summary: z.string().min(1).max(300).describe('Cosa è il documento, in una frase'),
  expense: z
    .object({
      title: z.string().min(1).max(160),
      merchant: z.string().max(160).optional(),
      date: z.iso.date().optional(),
      total: z.number().positive().describe('Totale pagato o da pagare, in unità maggiori'),
      currency: z.enum(CURRENCY_CODES),
      category: z.enum(EXPENSE_CATEGORY_KEYS),
      emoji: z.string().max(16).optional(),
      status: z.enum(['paid', 'planned']).describe('"planned" se è ancora da pagare'),
      items: z
        .array(z.object({ name: z.string().min(1).max(160), amount: z.number() }))
        .max(80)
        .default([]),
      bookingRef: RefSchema.optional().describe('id della prenotazione a cui si riferisce'),
    })
    .optional()
    .describe('Solo se il documento riporta un importo da registrare come spesa'),
  bookings: z
    .array(
      BookingSchema.extend({
        id: RefSchema.describe(
          'id nuovo in kebab-case, oppure quello di una prenotazione esistente',
        ),
        existing: z
          .boolean()
          .default(false)
          .describe('true se corrisponde a una prenotazione già nel programma (stesso id)'),
      }),
    )
    .max(10)
    .default([]),
  places: z
    .array(PlaceSchema)
    .max(5)
    .default([])
    .describe('Luoghi nuovi citati (alloggio, ristorante…) non già nel programma'),
  ticket: z
    .object({
      bookingRef: RefSchema,
      label: z.string().max(120).optional().describe('Es. "Andata · posto 12A"'),
      passenger: z.string().max(120).optional(),
    })
    .optional()
    .describe('Se il documento stesso è un biglietto o una carta d’imbarco'),
  confidence: z.enum(['high', 'medium', 'low']),
  notes: z.string().max(400).optional(),
});
export type DocumentResult = z.infer<typeof DocumentResultSchema>;

// ─── In quale giorno mettere un luogo ───────────────────────────────────────

export const ScheduleResultSchema = z.object({
  date: z.iso.date().describe('Giorno del programma in cui inserire la visita'),
  time: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .optional()
    .describe('Orario consigliato HH:MM'),
  durationMin: z.number().int().min(10).max(720).optional(),
  reason: z.string().min(1).max(400).describe('Perché quel giorno, in una o due frasi'),
});
export type ScheduleResult = z.infer<typeof ScheduleResultSchema>;

// ─── Lista bagagli ──────────────────────────────────────────────────────────

export const PackingResultSchema = z.object({ items: z.array(PackingItemSchema).max(40) });
export type PackingResult = z.infer<typeof PackingResultSchema>;

// ─── Definizione dei compiti ────────────────────────────────────────────────

export const AiInputSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('receipt'),
    file: z.string(),
    mime: z.string(),
    tripCurrency: z.enum(CURRENCY_CODES),
  }),
  z.object({
    kind: z.literal('booking'),
    file: z.string(),
    mime: z.string(),
    tripCurrency: z.enum(CURRENCY_CODES),
    year: z.number().int(),
  }),
  z.object({
    kind: z.literal('generate'),
    prompt: z.string().min(3).max(3000),
    destination: z.string().max(160).optional(),
    startDate: z.iso.date().optional(),
    endDate: z.iso.date().optional(),
    travelers: z.number().int().min(1).max(50).optional(),
    departureFrom: z.string().max(160).optional(),
    currency: z.enum(CURRENCY_CODES),
    budget: z
      .object({
        amount: z.number().positive(),
        currency: z.enum(CURRENCY_CODES),
        basis: z.enum(['total', 'per_person']),
      })
      .optional(),
    style: z.array(z.string().max(40)).max(12).optional(),
  }),
  z.object({
    kind: z.literal('chat'),
    message: z.string().min(1).max(3000),
    /** Conversazione a cui appartiene il messaggio (la crea l'API se manca). */
    conversationId: z.uuid().optional(),
  }),
  z.object({ kind: z.literal('verify'), placeId: z.string().max(64) }),
  z.object({
    kind: z.literal('placePhoto'),
    name: z.string().min(2).max(160),
    address: z.string().max(240).optional(),
    destination: z.string().max(160).optional(),
  }),
  z.object({ kind: z.literal('packing') }),
  z.object({ kind: z.literal('schedule'), placeId: z.string().max(64) }),
  z.object({
    kind: z.literal('document'),
    file: z.string(),
    mime: z.string(),
    tripCurrency: z.enum(CURRENCY_CODES),
    year: z.number().int(),
  }),
]);
export type AiInput = z.infer<typeof AiInputSchema>;

export const PURPOSE: Record<AiInput['kind'], AiPurpose> = {
  receipt: 'vision',
  booking: 'vision',
  generate: 'planner',
  chat: 'chat',
  verify: 'web',
  placePhoto: 'web',
  packing: 'light',
  schedule: 'chat',
  document: 'vision',
};

function schemaOf(s: z.ZodType) {
  return z.toJSONSchema(s, {
    target: 'draft-2020-12',
    io: 'input',
    unrepresentable: 'any',
  }) as Record<string, unknown>;
}

function filePart(dataUrl: string, mime: string, name: string): ContentPart {
  return mime === 'application/pdf'
    ? { type: 'file', file: { filename: name, file_data: dataUrl } }
    : { type: 'image_url', image_url: { url: dataUrl } };
}

/** Riassunto compatto del programma per l'assistente (senza campi vuoti). */
export function planContext(plan: TripDocument, extra: Record<string, unknown> = {}) {
  return JSON.stringify({ ...plan, ...extra }, (_k, v) =>
    Array.isArray(v) && v.length === 0 ? undefined : v,
  );
}

export interface TaskContext {
  locale: Locale;
  plan?: TripDocument;
  /** Dati del file (data URL) per scontrini e prenotazioni. */
  fileDataUrl?: string;
  /** Contesto aggiuntivo: membri, saldi, meteo… */
  extra?: Record<string, unknown>;
  history?: { role: 'user' | 'assistant'; content: string }[];
}

export interface TaskSpec {
  messages: ChatMessage[];
  schema: z.ZodType;
  schemaName: string;
  /** JSON Schema della risposta, per l'output strutturato del provider. */
  jsonSchema: Record<string, unknown>;
  web?: boolean;
  /** Validazione semantica oltre allo schema; restituisce gli errori. */
  validate?: (value: unknown) => { path: string; message: string }[] | null;
  repairs: number;
}

export function buildTask(input: AiInput, ctx: TaskContext): TaskSpec {
  const L = lang(ctx.locale);
  switch (input.kind) {
    case 'receipt': {
      const categories = EXPENSE_CATEGORY_KEYS.map(
        (c) => `${c} ${EXPENSE_CATEGORIES[c].emoji}`,
      ).join(', ');
      return {
        schemaName: 'tripshare_receipt',
        schema: ReceiptResultSchema,
        jsonSchema: schemaOf(ReceiptResultSchema),
        repairs: 1,
        messages: [
          {
            role: 'system',
            content: `Leggi scontrini, ricevute e fatture di viaggio e rispondi SOLO con JSON secondo lo schema. Testi in ${L}.
Regole: "total" è l'importo effettivamente pagato (con tasse, servizio e mance incluse se presenti). La valuta si deduce da simboli, paese e lingua (es. £ → GBP). Se il documento non indica la valuta usa ${input.tripCurrency}. "items" sono le righe con il totale di riga; non inventare righe illeggibili. Categorie possibili: ${categories}. "confidence" low se il documento è sfocato o parziale. Date nel formato YYYY-MM-DD (oggi è ${today()}).
JSON Schema: ${JSON.stringify(schemaOf(ReceiptResultSchema))}`,
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Ecco lo scontrino.' },
              filePart(ctx.fileDataUrl!, input.mime, 'receipt'),
            ],
          },
        ],
      };
    }
    case 'document': {
      const plan = ctx.plan!;
      const categories = EXPENSE_CATEGORY_KEYS.map(
        (c) => `${c} ${EXPENSE_CATEGORIES[c].emoji}`,
      ).join(', ');
      const placeIds = new Set(plan.places.map((p) => p.id));
      const bookingIds = new Set(plan.bookings.map((b) => b.id));
      return {
        schemaName: 'tripshare_document',
        schema: DocumentResultSchema,
        jsonSchema: schemaOf(DocumentResultSchema),
        repairs: 1,
        validate: (value) => {
          const doc = value as DocumentResult;
          const issues: { path: string; message: string }[] = [];
          const newPlaces = new Set(doc.places.map((p) => p.id));
          const refs = new Set(doc.bookings.map((b) => b.id));
          doc.bookings.forEach((b, i) => {
            if (b.existing && !bookingIds.has(b.id))
              issues.push({ path: `bookings.${i}.id`, message: 'unknown existing booking id' });
            if (!b.existing && bookingIds.has(b.id))
              issues.push({
                path: `bookings.${i}.id`,
                message: 'id already used: set existing true or use a new id',
              });
            if (b.placeId && !newPlaces.has(b.placeId) && !placeIds.has(b.placeId))
              issues.push({ path: `bookings.${i}.placeId`, message: 'unknown place id' });
          });
          doc.places.forEach((p, i) => {
            if (placeIds.has(p.id))
              issues.push({
                path: `places.${i}.id`,
                message: 'place already exists: reference it instead',
              });
          });
          if (
            doc.expense?.bookingRef &&
            !refs.has(doc.expense.bookingRef) &&
            !bookingIds.has(doc.expense.bookingRef)
          )
            issues.push({ path: 'expense.bookingRef', message: 'unknown booking' });
          if (
            doc.ticket &&
            !refs.has(doc.ticket.bookingRef) &&
            !bookingIds.has(doc.ticket.bookingRef)
          )
            issues.push({ path: 'ticket.bookingRef', message: 'unknown booking' });
          return issues.length ? issues : null;
        },
        messages: [
          {
            role: 'system',
            content: `Leggi un documento di viaggio fotografato o in PDF (scontrino, fattura o ricevuta, conferma di prenotazione, carta d'imbarco, biglietto) e ricava TUTTO quello che serve al programma del gruppo, rispondendo SOLO con JSON secondo lo schema. Testi in ${L}. Oggi è ${today()}.
Regole:
- "expense" solo se c'è un importo: "total" è quanto pagato o da pagare (tasse e servizio inclusi); "status" è "planned" se il documento dice che si paga dopo o sul posto. Categorie: ${categories}. Valuta dai simboli e dal paese; se manca usa ${input.tripCurrency}.
- "bookings" per alloggi, voli, treni, noleggi, traghetti, tour, biglietti d'ingresso: andata e ritorno sono due voci. Se la prenotazione è già nel programma (stesse date e fornitore, codice o numero di volo) usa il suo id con "existing": true e riporta comunque TUTTI i dati letti nel documento (codice, orari, costo, "paid", volo): l'app li integrerà nella prenotazione esistente. Altrimenti usa un id nuovo in kebab-case. Una ricevuta di pagamento di una prenotazione esistente va collegata a quella prenotazione ("existing": true, "paid": true) e alla spesa con "bookingRef". Copia esattamente codici, orari (HH:MM locali) e importi; anno se manca: ${input.year}.
- Esempio: la ricevuta di un albergo produce la prenotazione "lodging" (o quella esistente), la spesa collegata con "bookingRef" e il luogo dell'albergo in "places" se non c'è già; lo scontrino di un ristorante produce solo la spesa (e il luogo se utile).
- "places" solo per luoghi nuovi, con id in kebab-case; per collegare una prenotazione a un luogo usa "placeId" (nuovo o esistente).
- "ticket" se il documento stesso è un biglietto o una carta d'imbarco, con "bookingRef" della prenotazione a cui appartiene.
- Non inventare ciò che non si legge; "confidence" low se il documento è poco leggibile.
Programma attuale (per riconoscere prenotazioni e luoghi esistenti): ${JSON.stringify({
              startDate: plan.trip.startDate,
              endDate: plan.trip.endDate,
              destination: plan.trip.destination.name,
              bookings: plan.bookings.map((b) => ({
                id: b.id,
                type: b.type,
                title: b.title,
                provider: b.provider,
                code: b.confirmationCode,
                start: b.start,
                end: b.end,
              })),
              places: plan.places.map((p) => ({ id: p.id, name: p.name, kind: p.kind })),
            })}
JSON Schema: ${JSON.stringify(schemaOf(DocumentResultSchema))}`,
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Ecco il documento.' },
              filePart(ctx.fileDataUrl!, input.mime, 'document.pdf'),
            ],
          },
        ],
      };
    }
    case 'booking': {
      return {
        schemaName: 'tripshare_bookings',
        schema: BookingResultSchema,
        jsonSchema: schemaOf(BookingResultSchema),
        repairs: 1,
        messages: [
          {
            role: 'system',
            content: `Estrai le prenotazioni (voli, alloggi, noleggi, treni, traghetti, parcheggi, biglietti, tour) da screenshot o PDF di conferma e rispondi SOLO con JSON secondo lo schema. Testi in ${L}.
Regole: una voce per ogni prenotazione (andata e ritorno sono due voli). "status" è "booked" se il documento è una conferma. Copia esattamente codici di prenotazione, numeri di volo, orari e importi; non inventare ciò che non c'è. Orari locali HH:MM. Anno di riferimento se manca: ${input.year}. "cost" è il totale pagato o da pagare per quella prenotazione; "paid" false se si paga sul posto. Per i voli compila "flight" con numero e aeroporti (con codice IATA). Valuta predefinita: ${input.tripCurrency}.
JSON Schema: ${JSON.stringify(schemaOf(BookingResultSchema))}`,
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Ecco la conferma di prenotazione.' },
              filePart(ctx.fileDataUrl!, input.mime, 'booking.pdf'),
            ],
          },
        ],
      };
    }
    case 'generate': {
      const { messages, response_format } = buildTripGenerationRequest(
        {
          prompt: input.prompt,
          destination: input.destination,
          startDate: input.startDate,
          endDate: input.endDate,
          travelers: input.travelers,
          departureFrom: input.departureFrom,
          currency: input.currency,
          budget: input.budget,
          style: input.style,
          today: today(),
        },
        ctx.locale,
      );
      return {
        schemaName: response_format.json_schema.name,
        schema: z.unknown(),
        jsonSchema: response_format.json_schema.schema as Record<string, unknown>,
        repairs: 2,
        messages,
        validate: (value) => {
          const parsed = parseTripDocument(value);
          if (!parsed.success) return parsed.issues;
          if (parsed.data.days.length === 0)
            return [{ path: 'days', message: 'at least one day is required' }];
          return null;
        },
      };
    }
    case 'chat': {
      return {
        schemaName: 'tripshare_assistant',
        schema: ChatResultSchema,
        jsonSchema: schemaOf(ChatResultSchema),
        repairs: 1,
        messages: [
          {
            role: 'system',
            content: `Sei l'assistente di viaggio di TripShare per un gruppo. Rispondi in ${L}, in modo concreto e breve. In "reply" puoi usare Markdown semplice (grassetto per nomi e orari importanti, elenchi per le opzioni, link alle fonti), senza HTML. Oggi è ${today()}.
Hai il programma del viaggio nel formato standard TripShare e altri dati del gruppo. Se l'utente chiede di modificare il programma (aggiungere, spostare o togliere attività, luoghi, prenotazioni, voci di budget, bagagli, giorni), proponi le modifiche in "actions" usando le operazioni dello schema e gli id esistenti; NON dire di averle applicate: l'utente le confermerà. Per una nuova attività ometti "id". Per un nuovo luogo da collegare a un'attività assegna tu un "id" breve in kebab-case non già usato e usalo in "placeIds" nella stessa risposta. Le attività vanno in giorni esistenti: se il giorno manca, crealo prima con "ensureDays" o "upsertDay". Per aggiungere o cambiare la foto di un luogo esistente usa l'operazione "setPlacePhoto" con l'id del luogo e "photo": l'indirizzo https DIRETTO di un'immagine (un file .jpg, .png o .webp, non una pagina web) che l'utente ti ha indicato nel messaggio; l'app lo scarica e lo salva. Se l'utente indica più indirizzi, uno per luogo, proponi più operazioni. Non inventare mai indirizzi di immagini: se l'utente non ne ha fornito uno, spiega che può incollarlo oppure usare "Cerca online" nella scheda del luogo. Eventuale autore o sito in "photoCredit". Non inventare prezzi o orari precisi che non conosci: indica che vanno verificati. Se l'utente racconta una spesa fatta o da fare ("ho pagato 40 € di benzina", "dobbiamo pagare il traghetto"), proponila in "expenses" usando i nomi del gruppo per "paidBy" e "splitAmong" (chi scrive è "${String(ctx.extra?.me ?? '')}"); verrà registrata solo dopo la conferma.
Rispondi SOLO con JSON secondo questo schema: ${JSON.stringify(schemaOf(ChatResultSchema))}
Dati del viaggio: ${planContext(ctx.plan!, ctx.extra)}`,
          },
          ...(ctx.history ?? []).map((m) => ({ role: m.role, content: m.content }) as ChatMessage),
          { role: 'user', content: input.message },
        ],
      };
    }
    case 'placePhoto':
      return {
        schemaName: 'tripshare_place_photo',
        schema: PlacePhotoResultSchema,
        jsonSchema: schemaOf(PlacePhotoResultSchema),
        web: true,
        repairs: 1,
        messages: [
          {
            role: 'system',
            content: `Cerca sul web fotografie reali del luogo indicato e dai fino a 6 indirizzi https DIRETTI di file immagine (.jpg, .png o .webp). Preferisci Wikimedia Commons (upload.wikimedia.org), siti ufficiali e di enti del turismo. Niente pagine web, miniature dei motori di ricerca, loghi, mappe o illustrazioni. NON inventare indirizzi: se non ne trovi di sicuri, restituisci l'elenco vuoto. Rispondi in ${L} SOLO con JSON secondo lo schema.
JSON Schema: ${JSON.stringify(schemaOf(PlacePhotoResultSchema))}`,
          },
          {
            role: 'user',
            content: JSON.stringify({
              place: { name: input.name, address: input.address },
              destination: input.destination,
            }),
          },
        ],
      };

    case 'verify': {
      const place = ctx.plan!.places.find((p) => p.id === input.placeId);
      const dates = ctx
        .plan!.days.filter((d) =>
          [...d.activities, ...d.alternatives.flatMap((a) => a.activities)].some((a) =>
            a.placeIds.includes(input.placeId),
          ),
        )
        .map((d) => d.date);
      return {
        schemaName: 'tripshare_verify',
        schema: VerifyResultSchema,
        jsonSchema: schemaOf(VerifyResultSchema),
        web: true,
        repairs: 1,
        messages: [
          {
            role: 'system',
            content: `Verifica sul web orari di apertura e prezzi di un luogo per le date indicate, preferendo il sito ufficiale. Rispondi in ${L} SOLO con JSON secondo lo schema. "verified" true solo con una fonte ufficiale citata in "sources". Indica orari validi per quelle date (stagionalità, ultimo ingresso, chiusure). Oggi è ${today()}.
JSON Schema: ${JSON.stringify(schemaOf(VerifyResultSchema))}`,
          },
          {
            role: 'user',
            content: JSON.stringify({
              place: place
                ? {
                    name: place.name,
                    address: place.address,
                    mapsQuery: place.mapsQuery,
                    currentHours: place.openingHours,
                  }
                : input.placeId,
              destination: ctx.plan!.trip.destination.name,
              dates: dates.length
                ? dates
                : [ctx.plan!.trip.startDate, ctx.plan!.trip.endDate].filter(Boolean),
              currency: ctx.plan!.trip.currency,
            }),
          },
        ],
      };
    }
    case 'schedule': {
      const plan = ctx.plan!;
      const place = plan.places.find((p) => p.id === input.placeId);
      const days = new Set(plan.days.map((d) => d.date));
      return {
        schemaName: 'tripshare_schedule',
        schema: ScheduleResultSchema,
        jsonSchema: schemaOf(ScheduleResultSchema),
        repairs: 1,
        validate: (value) =>
          days.has((value as ScheduleResult).date)
            ? null
            : [{ path: 'date', message: `date must be one of: ${[...days].join(', ')}` }],
        messages: [
          {
            role: 'system',
            content: `Sei il pianificatore di TripShare. Scegli in quale giorno del programma inserire la visita a un luogo per ridurre gli spostamenti: preferisci il giorno in cui il gruppo è già vicino (stessa zona, stesso percorso o alloggio vicino), rispetta orari di apertura e giorni di chiusura se noti ed evita i giorni già pieni. Proponi un orario che si incastri tra le attività esistenti. Testi in ${L}. Rispondi SOLO con JSON secondo lo schema: ${JSON.stringify(schemaOf(ScheduleResultSchema))}`,
          },
          {
            role: 'user',
            content: JSON.stringify({
              placeToSchedule: place ?? input.placeId,
              days: plan.days.map((d) => ({
                date: d.date,
                title: d.title,
                route: d.route,
                stayBookingId: d.stayBookingId,
                activities: d.activities.map((a) => ({
                  time: a.time,
                  endTime: a.endTime,
                  title: a.title,
                  placeIds: a.placeIds,
                })),
              })),
              places: plan.places.map((p) => ({
                id: p.id,
                name: p.name,
                address: p.address,
                location: p.location,
              })),
              lodging: plan.bookings
                .filter((b) => b.type === 'lodging')
                .map((b) => ({ id: b.id, title: b.title, start: b.start.date, end: b.end?.date })),
            }),
          },
        ],
      };
    }
    case 'packing': {
      return {
        schemaName: 'tripshare_packing',
        schema: PackingResultSchema,
        jsonSchema: schemaOf(PackingResultSchema),
        repairs: 1,
        messages: [
          {
            role: 'system',
            content: `Suggerisci cosa portare e cosa preparare prima di partire (documenti, prenotazioni, check-in) per questo viaggio di gruppo, in base a destinazione, stagione, meteo e attività. Testi in ${L}, brevi. Non ripetere le voci già presenti. Massimo 20 voci, con "reason" utile. Rispondi SOLO con JSON secondo lo schema: ${JSON.stringify(schemaOf(PackingResultSchema))}`,
          },
          { role: 'user', content: planContext(ctx.plan!, ctx.extra) },
        ],
      };
    }
  }
}

/** Valida la risposta del modello: JSON, schema ed eventuale validazione semantica. */
export function checkResult(
  spec: TaskSpec,
  content: string,
): { value: unknown } | { issues: { path: string; message: string }[] } {
  let raw: unknown;
  try {
    raw = extractJson(content);
  } catch {
    return { issues: [{ path: '(root)', message: 'the response is not valid JSON' }] };
  }
  const parsed = spec.schema.safeParse(raw);
  if (!parsed.success) {
    return {
      issues: parsed.error.issues
        .slice(0, 20)
        .map((i) => ({ path: i.path.join('.') || '(root)', message: i.message })),
    };
  }
  const issues = spec.validate?.(parsed.data);
  if (issues?.length) return { issues };
  return { value: parsed.data };
}

export { buildRepairMessage };

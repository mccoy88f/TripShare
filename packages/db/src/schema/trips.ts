import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { user } from './auth.js';

// Gli importi sono interi in unità minori (centesimi) della valuta indicata accanto.

export const trip = pgTable('trip', {
  id: uuid().primaryKey().defaultRandom(),
  title: text().notNull(),
  emoji: text(),
  description: text(),
  destination: text(),
  startDate: date(),
  endDate: date(),
  /** Valuta del viaggio: saldi e budget sono calcolati in questa valuta. */
  currency: text().notNull(),
  coverImage: text(),
  /** Autore della foto di copertina scelta da Unsplash: { name, url }. */
  coverCredit: jsonb(),
  coverColor: text(),
  /** Programma nel formato standard TripShare (TripDocument v1). */
  plan: jsonb(),
  planVersion: integer().notNull().default(0),
  createdBy: text().references(() => user.id, { onDelete: 'set null' }),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

/**
 * Partecipante a un viaggio. `userId` è nullo per i membri segnaposto (persone senza account),
 * che vengono collegati all'account quando accettano un invito.
 */
export const tripMember = pgTable(
  'trip_member',
  {
    id: uuid().primaryKey().defaultRandom(),
    tripId: uuid()
      .notNull()
      .references(() => trip.id, { onDelete: 'cascade' }),
    userId: text().references(() => user.id, { onDelete: 'set null' }),
    name: text().notNull(),
    /** Email di chi è stato invitato e non ha ancora accettato (solo per i segnaposto). */
    invitedEmail: text(),
    avatarEmoji: text(),
    avatarColor: text(),
    role: text().notNull().default('editor'),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    removedAt: timestamp({ withTimezone: true }),
    /** Il membro ha silenziato le notifiche di questo viaggio. */
    notificationsMuted: boolean().notNull().default(false),
  },
  (t) => [
    index('trip_member_trip_idx').on(t.tripId),
    index('trip_member_user_idx').on(t.userId),
    uniqueIndex('trip_member_trip_user_uq')
      .on(t.tripId, t.userId)
      .where(sql`${t.userId} is not null`),
  ],
);

export const tripInvitation = pgTable(
  'trip_invitation',
  {
    id: uuid().primaryKey().defaultRandom(),
    tripId: uuid()
      .notNull()
      .references(() => trip.id, { onDelete: 'cascade' }),
    token: text().notNull().unique(),
    /** Se impostata, l'invito è per questo indirizzo (e gli viene inviato via email). */
    email: text(),
    role: text().notNull().default('editor'),
    /** Membro segnaposto che l'invitato prenderà in carico. */
    memberId: uuid().references(() => tripMember.id, { onDelete: 'set null' }),
    maxUses: integer(),
    uses: integer().notNull().default(0),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    createdBy: text().references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    index('trip_invitation_trip_idx').on(t.tripId),
    index('trip_invitation_email_idx').on(t.email),
  ],
);

export const expense = pgTable(
  'expense',
  {
    id: uuid().primaryKey().defaultRandom(),
    tripId: uuid()
      .notNull()
      .references(() => trip.id, { onDelete: 'cascade' }),
    title: text().notNull(),
    emoji: text(),
    category: text().notNull(),
    amount: bigint({ mode: 'number' }).notNull(),
    currency: text().notNull(),
    /** Unità della valuta del viaggio per 1 unità di `currency`. */
    rate: doublePrecision().notNull().default(1),
    /** Importo convertito nella valuta del viaggio. */
    amountTrip: bigint({ mode: 'number' }).notNull(),
    date: date().notNull(),
    splitMethod: text().notNull(),
    notes: text(),
    /** Foto o PDF dello scontrino (archivio privato). */
    receipt: text(),
    /** "paid" (entra nei saldi) o "planned" (da pagare: conta solo nel budget). */
    status: text().notNull().default('paid'),
    /** Prenotazione del programma a cui si riferisce la spesa. */
    bookingId: text(),
    createdBy: text().references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp({ withTimezone: true }),
  },
  (t) => [index('expense_trip_idx').on(t.tripId, t.date)],
);

export const expensePayer = pgTable(
  'expense_payer',
  {
    expenseId: uuid()
      .notNull()
      .references(() => expense.id, { onDelete: 'cascade' }),
    memberId: uuid()
      .notNull()
      .references(() => tripMember.id, { onDelete: 'cascade' }),
    amount: bigint({ mode: 'number' }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.expenseId, t.memberId] })],
);

export const expenseShare = pgTable(
  'expense_share',
  {
    expenseId: uuid()
      .notNull()
      .references(() => expense.id, { onDelete: 'cascade' }),
    memberId: uuid()
      .notNull()
      .references(() => tripMember.id, { onDelete: 'cascade' }),
    amount: bigint({ mode: 'number' }).notNull(),
    /** Quota o percentuale indicata dall'utente, per ripresentare il modulo. */
    weight: doublePrecision(),
  },
  (t) => [primaryKey({ columns: [t.expenseId, t.memberId] })],
);

/** Rimborso tra due membri, nella valuta del viaggio. */
export const settlement = pgTable(
  'settlement',
  {
    id: uuid().primaryKey().defaultRandom(),
    tripId: uuid()
      .notNull()
      .references(() => trip.id, { onDelete: 'cascade' }),
    fromMemberId: uuid()
      .notNull()
      .references(() => tripMember.id, { onDelete: 'cascade' }),
    toMemberId: uuid()
      .notNull()
      .references(() => tripMember.id, { onDelete: 'cascade' }),
    amount: bigint({ mode: 'number' }).notNull(),
    method: text().notNull().default('manual'),
    note: text(),
    date: date().notNull(),
    createdBy: text().references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp({ withTimezone: true }),
  },
  (t) => [index('settlement_trip_idx').on(t.tripId)],
);

/** Spunte della lista bagagli: per le voci "a persona" ognuno spunta la propria. */
export const packingCheck = pgTable(
  'packing_check',
  {
    tripId: uuid()
      .notNull()
      .references(() => trip.id, { onDelete: 'cascade' }),
    itemId: text().notNull(),
    memberId: uuid()
      .notNull()
      .references(() => tripMember.id, { onDelete: 'cascade' }),
    checkedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.tripId, t.itemId, t.memberId] })],
);

/**
 * Biglietto o documento di una prenotazione (PDF, immagine, Apple Wallet, link Google Wallet
 * o solo il contenuto di un QR / codice a barre), assegnato a un partecipante o a tutti.
 * `bookingId` è l'id della prenotazione nel programma del viaggio.
 */
export const bookingTicket = pgTable(
  'booking_ticket',
  {
    id: uuid().primaryKey().defaultRandom(),
    tripId: uuid()
      .notNull()
      .references(() => trip.id, { onDelete: 'cascade' }),
    bookingId: text().notNull(),
    /** Nullo = per tutti. */
    memberId: uuid().references(() => tripMember.id, { onDelete: 'set null' }),
    label: text(),
    fileName: text(),
    /** Nome del file nell'archivio privato. */
    storageName: text(),
    mimeType: text(),
    size: integer(),
    codeFormat: text(),
    codeValue: text(),
    walletUrl: text(),
    createdBy: text().references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('booking_ticket_trip_idx').on(t.tripId, t.bookingId)],
);

/** Lavoro AI (scontrino, prenotazione, generazione, chat…) eseguito dal worker. */
export const aiJob = pgTable(
  'ai_job',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    tripId: uuid().references(() => trip.id, { onDelete: 'cascade' }),
    kind: text().notNull(),
    status: text().notNull().default('queued'),
    input: jsonb().notNull(),
    result: jsonb(),
    error: text(),
    model: text(),
    promptTokens: integer(),
    completionTokens: integer(),
    /** Costo in dollari riportato da OpenRouter (Gemini non lo riporta). */
    cost: doublePrecision(),
    /** "central" (chiave dell'istanza) o "user" (chiave personale). */
    keySource: text(),
    /** "openrouter" o "gemini". */
    provider: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    index('ai_job_user_idx').on(t.userId, t.createdAt),
    index('ai_job_trip_idx').on(t.tripId),
  ],
);

/** Conversazione con l'assistente di un viaggio (privata per ogni utente). */
export const aiConversation = pgTable(
  'ai_conversation',
  {
    id: uuid().primaryKey().defaultRandom(),
    tripId: uuid()
      .notNull()
      .references(() => trip.id, { onDelete: 'cascade' }),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    title: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('ai_conversation_trip_user_idx').on(t.tripId, t.userId, t.updatedAt)],
);

/** Messaggio di una conversazione con l'assistente. */
export const aiChatMessage = pgTable(
  'ai_chat_message',
  {
    id: uuid().primaryKey().defaultRandom(),
    tripId: uuid()
      .notNull()
      .references(() => trip.id, { onDelete: 'cascade' }),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    conversationId: uuid().references(() => aiConversation.id, { onDelete: 'cascade' }),
    role: text().notNull(),
    content: text().notNull(),
    /** Operazioni sul programma proposte dall'assistente. */
    actions: jsonb(),
    /** Spese proposte dall'assistente (da confermare). */
    expenses: jsonb(),
    appliedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('ai_chat_trip_user_idx').on(t.tripId, t.userId, t.createdAt)],
);

/** Note del viaggio: pubbliche (visibili a tutti) o private (solo per l'autore). */
export const tripNote = pgTable(
  'trip_note',
  {
    id: uuid().primaryKey().defaultRandom(),
    tripId: uuid()
      .notNull()
      .references(() => trip.id, { onDelete: 'cascade' }),
    memberId: uuid()
      .notNull()
      .references(() => tripMember.id, { onDelete: 'cascade' }),
    emoji: text(),
    title: text(),
    content: text().notNull(),
    visibility: text().notNull().default('public'),
    pinned: boolean().notNull().default(false),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('trip_note_trip_idx').on(t.tripId, t.createdAt)],
);

/**
 * Registro delle modifiche a un viaggio (aggiunta di una spesa, di un luogo…). Una riga per
 * modifica; più modifiche simili dello stesso autore in pochi minuti si fondono in una sola
 * (`count`). I testi non sono salvati: si compongono nella lingua di chi legge dai parametri.
 */
export const tripEvent = pgTable(
  'trip_event',
  {
    id: uuid().primaryKey().defaultRandom(),
    tripId: uuid()
      .notNull()
      .references(() => trip.id, { onDelete: 'cascade' }),
    /** Chi ha fatto la modifica (nullo se il membro non esiste più). */
    actorMemberId: uuid().references(() => tripMember.id, { onDelete: 'set null' }),
    /** Tipo, es. "expense.created" o "plan.place.added". */
    type: text().notNull(),
    /** Elemento interessato (id della spesa, del luogo, della prenotazione…). */
    entityId: text(),
    /** Parametri per comporre il testo: titolo, importo, data del giorno… */
    data: jsonb().notNull().default({}),
    /** Quante modifiche dello stesso tipo sono state fuse in questo evento. */
    count: integer().notNull().default(1),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('trip_event_trip_idx').on(t.tripId, t.updatedAt)],
);

/** Notifica per un destinatario: l'evento, da leggere o già letto. */
export const notification = pgTable(
  'notification',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    tripId: uuid()
      .notNull()
      .references(() => trip.id, { onDelete: 'cascade' }),
    eventId: uuid()
      .notNull()
      .references(() => tripEvent.id, { onDelete: 'cascade' }),
    readAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('notification_user_event_idx').on(t.userId, t.eventId),
    index('notification_user_idx').on(t.userId, t.readAt, t.createdAt),
  ],
);

/** Dispositivo che riceve le notifiche push (un utente può averne più d'uno). */
export const pushSubscription = pgTable(
  'push_subscription',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** Indirizzo del servizio push del browser: identifica il dispositivo. */
    endpoint: text().notNull(),
    p256dh: text().notNull(),
    auth: text().notNull(),
    userAgent: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    lastSentAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    uniqueIndex('push_subscription_endpoint_idx').on(t.endpoint),
    index('push_subscription_user_idx').on(t.userId),
  ],
);

/** Cosa notificare a un utente, per categoria (spese, programma, gruppo, note). */
export const notificationPref = pgTable('notification_pref', {
  userId: text()
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  /** Categorie disattivate. Vuoto = tutto attivo. */
  disabled: jsonb().$type<string[]>().notNull().default([]),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

/**
 * Ricordo personale: una foto o un video di chi lo carica, con data, posizione e didascalia
 * (letti dal file o impostati a mano). Se collegato a un viaggio è visibile ai suoi
 * partecipanti, a meno che l'autore lo tenga privato (`shared` = false). I file stanno
 * nell'archivio privato e si leggono solo dopo il controllo dei permessi.
 */
export const memory = pgTable(
  'memory',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** Nullo = ricordo personale non legato a un viaggio (sempre privato). */
    tripId: uuid().references(() => trip.id, { onDelete: 'set null' }),
    /** "photo" o "video". */
    kind: text().notNull(),
    /** File principale (foto ridimensionata o video ricodificato) e anteprime, nell'archivio privato. */
    storageName: text().notNull(),
    thumbName: text(),
    mimeType: text().notNull(),
    size: integer().notNull().default(0),
    width: integer(),
    height: integer(),
    durationSec: doublePrecision(),
    /** Momento dello scatto o della ripresa (assoluto); nullo se sconosciuto. */
    takenAt: timestamp({ withTimezone: true }),
    lat: doublePrecision(),
    lon: doublePrecision(),
    caption: text(),
    shared: boolean().notNull().default(true),
    /** "ready", "processing" (video in ricodifica) o "failed". */
    status: text().notNull().default('ready'),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('memory_user_idx').on(t.userId, t.takenAt),
    index('memory_trip_idx').on(t.tripId, t.takenAt),
  ],
);

import { eq, sql } from 'drizzle-orm';
import sharp from 'sharp';
import { z } from 'zod';
import { trip, type Database } from '@tripshare/db';
import {
  haversineKm,
  nightsBetween,
  isCurrencyCode,
  type CurrencyCode,
  type Locale,
} from '@tripshare/shared';
import {
  BookingSchema,
  BudgetItemSchema,
  DaySchema,
  PackingItemSchema,
  PlaceSchema,
  TipSchema,
  TripBriefSchema,
  TRANSPORT_MODES,
  parseTripDocument,
  type Booking,
  type BudgetItem,
  type Place,
  type TripBrief,
  type TripDocument,
} from '@tripshare/shared/trip-format';
import { downloadImageFromAnyUrl } from '../image-download.js';
import { searchPlaces } from '../nominatim.js';
import { searchCommons } from '../photo-search.js';
import { listMembers } from '../services/members.js';
import { prepareForStorage, readPlan } from '../services/plan.js';
import type { AiAccess } from './access.js';
import { runSpec, type AiDeps, AiJobError } from './jobs.js';
import { lang, schemaOf, today, type TaskSpec } from './tasks.js';

/**
 * Generazione di un viaggio a fasi. Ogni fase fa una richiesta più piccola all'AI, controlla il
 * risultato (schema, riferimenti, giorni, distanze) e lo aggiunge al programma: l'utente vede
 * l'avanzamento e, se una fase fallisce, si rifà solo quella. Le fasi successive ricevono ciò che
 * è stato deciso prima (la "strategia" del viaggio), così il risultato resta coerente.
 */
export const GENERATION_STEPS = [
  'strategy',
  'places',
  'days',
  'bookings',
  'budget',
  'packing',
  'photos',
] as const;
export type GenStepKey = (typeof GENERATION_STEPS)[number];

export interface GenStep {
  key: GenStepKey;
  status: 'pending' | 'running' | 'done' | 'failed';
  /** Cosa sta facendo o ha fatto, per la schermata (testo localizzato dal client). */
  detail?: { k: string; p?: Record<string, string | number> };
  /** Elementi prodotti (luoghi, giorni, prenotazioni…). */
  count?: number;
  error?: string;
}

export interface GenerationState {
  status: 'running' | 'done' | 'failed';
  steps: GenStep[];
  /** Avvisi dei controlli, per la revisione guidata. */
  warnings: { k: string; p?: Record<string, string | number> }[];
  strategy?: Strategy;
  dismissed?: boolean;
  startedAt: string;
  finishedAt?: string;
}

const modeEnum = z.enum(TRANSPORT_MODES);

const StrategySchema = z.object({
  title: z.string().min(1).max(120),
  emoji: z.string().max(16).optional(),
  summary: z.string().max(600),
  timezone: z.string().max(64).optional(),
  countryCodes: z
    .array(z.string().regex(/^[A-Z]{2}$/))
    .max(10)
    .default([]),
  coverQuery: z.string().max(120).optional(),
  arrival: z.object({
    mode: modeEnum,
    description: z.string().max(400),
    durationHours: z.number().positive().max(100).optional(),
  }),
  local: z.object({ modes: z.array(modeEnum).max(4).default([]), notes: z.string().max(400) }),
  legs: z
    .array(
      z.object({
        from: z.string().max(120),
        to: z.string().max(120),
        mode: modeEnum,
        durationMinutes: z.number().int().positive().max(6000).optional(),
        distanceKm: z.number().positive().max(20000).optional(),
        notes: z.string().max(300).optional(),
      }),
    )
    .max(12),
  bases: z
    .array(
      z.object({
        stop: z.string().max(120),
        nights: z.number().int().min(0).max(60),
        lodging: z.enum(['hotel', 'apartment', 'bnb', 'hostel', 'camping']),
        rooms: z.string().max(200),
      }),
    )
    .max(8),
  rental: z.object({ needed: z.boolean(), seats: z.number().int().positive().max(20).optional() }),
  pace: z.string().max(300),
  guidelines: z.array(z.string().max(200)).max(8).default([]),
});
export type Strategy = z.infer<typeof StrategySchema>;

const PlacesResultSchema = z.object({
  places: z
    .array(
      z.object({
        stop: z.string().max(120),
        place: PlaceSchema.omit({
          photo: true,
          photoCredit: true,
          verification: true,
          links: true,
        }),
      }),
    )
    .min(1)
    .max(60),
});

const DaysResultSchema = z.object({ days: z.array(DaySchema).min(1).max(70) });

const BookingsResultSchema = z.object({
  bookings: z.array(BookingSchema).max(60),
  stays: z.array(z.object({ date: z.iso.date(), bookingId: z.string().max(64) })).max(70),
  activityLinks: z
    .array(z.object({ activityId: z.string().max(64), bookingId: z.string().max(64) }))
    .max(60)
    .default([]),
});

const BudgetResultSchema = z.object({
  budget: z.array(BudgetItemSchema).max(80),
  exchangeRates: z.record(z.string(), z.number().positive()).optional(),
});

const PackingResultSchema = z.object({
  packing: z.array(PackingItemSchema).max(80),
  tips: z.array(TipSchema).max(12),
});

const INTENSITY = {
  easy: { label: '2-3 visite al giorno', max: 3, perDay: 3 },
  normal: { label: '4-5 visite al giorno', max: 5, perDay: 5 },
  intense: { label: '6-8 visite al giorno', max: 8, perDay: 7 },
} as const;

/** Soglia sopra la quale due visite consecutive senza uno spostamento in mezzo non hanno senso. */
const MAX_VISIT_GAP_KM = 150;
const VISIT_TYPES = new Set(['visit', 'activity', 'shopping']);

interface Issue {
  path: string;
  message: string;
}

interface Stop {
  label: string;
  lat: number;
  lon: number;
  nights: number;
}

/** Tappe del percorso; senza tappe indicate, la destinazione principale è l'unica tappa. */
function effectiveStops(brief: TripBrief, totalNights: number): Stop[] {
  if (brief.stops.length > 0) return brief.stops;
  return [{ ...brief.main, nights: totalNights }];
}

const eachDate = (start: string, end: string) => {
  const out: string[] = [];
  for (
    let d = Date.parse(`${start}T12:00:00Z`);
    d <= Date.parse(`${end}T12:00:00Z`);
    d += 86_400_000
  )
    out.push(new Date(d).toISOString().slice(0, 10));
  return out;
};

/** In quale tappa si trova (dorme) il viaggio ogni giorno: l'ultimo giorno resta nell'ultima. */
function dayStops(stops: Stop[], start: string, end: string) {
  const dates = eachDate(start, end);
  const names: string[] = [];
  stops.forEach((s) => {
    for (let i = 0; i < s.nights; i++) names.push(s.label);
  });
  return dates.map((date, i) => ({
    date,
    stop: names[i] ?? stops.at(-1)!.label,
    first: i === 0,
    last: i === dates.length - 1,
  }));
}

/** Descrizione del viaggio per i prompt. */
function describeBrief(brief: TripBrief, row: typeof trip.$inferSelect, locale: Locale) {
  const start = row.startDate!;
  const end = row.endDate!;
  const nights = nightsBetween(start, end);
  const stops = effectiveStops(brief, nights);
  const ai = brief.ai;
  const intensity = INTENSITY[ai?.intensity ?? 'normal'];
  return {
    json: JSON.stringify({
      oggi: today(),
      lingua: locale,
      destinazionePrincipale: brief.main.label,
      partenza: brief.origin?.label ?? null,
      rientro: brief.returnTo?.label ?? brief.origin?.label ?? null,
      tappeNellOrdineDelPercorso: stops.map((s) => ({ nome: s.label, notti: s.nights })),
      date: { inizio: start, fine: end, notti: nights, giorni: nights + 1 },
      viaggiatori: { adulti: brief.travelers.adults, bambiniEta: brief.travelers.children },
      valuta: row.currency,
      preferenze: ai
        ? {
            tipoDiViaggio: ai.types,
            intensita: intensity.label,
            mezziPreferiti: ai.transport,
            esperienza: ai.experience,
            fasciaBudget: ai.budget,
            alloggio: ai.lodging,
            esigenze: ai.needs,
          }
        : undefined,
      giaPrenotato: ai?.booked || undefined,
      noteDellUtente: ai?.notes || undefined,
    }),
    stops,
    start,
    end,
    nights,
    intensity,
  };
}

interface Usage {
  promptTokens: number;
  completionTokens: number;
  cost: number | null;
  model: string | null;
}

const SYSTEM_BASE = (L: string, step: string) =>
  `Sei l'assistente di viaggio di TripShare e prepari il viaggio a fasi. ${step} Rispondi SOLO con JSON secondo lo schema, senza testo prima o dopo. Testi in ${L}. Non inventare prezzi precisi, orari certi o codici di prenotazione: le stime vanno segnate come tali. Gli id sono brevi, in kebab-case e unici.`;

interface RunCtx {
  deps: AiDeps;
  db: Database;
  tripId: string;
  userId: string;
  locale: Locale;
  access: AiAccess;
  row: typeof trip.$inferSelect;
  brief: TripBrief;
  describe: ReturnType<typeof describeBrief>;
  plan: TripDocument;
  state: GenerationState;
  usage: Usage;
  /** Generazione di una sola sezione: il resto del viaggio non si tocca. */
  keep?: boolean;
}

async function saveState(ctx: RunCtx) {
  await ctx.db
    .update(trip)
    .set({ generation: ctx.state, updatedAt: new Date() })
    .where(eq(trip.id, ctx.tripId));
}

async function savePlan(ctx: RunCtx, extra: Partial<typeof trip.$inferInsert> = {}) {
  const prepared = prepareForStorage({
    ...ctx.plan,
    trip: { ...ctx.plan.trip, currency: ctx.row.currency as CurrencyCode },
  });
  ctx.plan = prepared;
  await ctx.db
    .update(trip)
    .set({
      plan: prepared,
      planVersion: sql`${trip.planVersion} + 1`,
      updatedAt: new Date(),
      ...extra,
    })
    .where(eq(trip.id, ctx.tripId));
}

async function ask(ctx: RunCtx, spec: TaskSpec) {
  const run = await runSpec(ctx.deps, ctx.access, spec, ctx.locale);
  ctx.usage.promptTokens += run.promptTokens;
  ctx.usage.completionTokens += run.completionTokens;
  if (run.cost !== null) ctx.usage.cost = (ctx.usage.cost ?? 0) + run.cost;
  ctx.usage.model = run.model;
  return run.value;
}

const norm = (s: string) => s.trim().toLowerCase();

/** Controlla il documento intero (riferimenti, date…) dopo aver applicato una fase. */
function validateDoc(doc: unknown): Issue[] | null {
  const parsed = parseTripDocument(doc);
  return parsed.success ? null : parsed.issues;
}

// ---------------------------------------------------------------------------------------------
// Fasi
// ---------------------------------------------------------------------------------------------

async function stepStrategy(ctx: RunCtx) {
  const describe = ctx.describe;
  const stops = describe.stops;
  const L = lang(ctx.locale);
  const spec: TaskSpec = {
    schemaName: 'tripshare_gen_strategy',
    schema: StrategySchema,
    jsonSchema: schemaOf(StrategySchema),
    repairs: 2,
    validate: (value) => {
      const s = value as Strategy;
      const issues: Issue[] = [];
      if (s.legs.length !== stops.length + 1)
        issues.push({
          path: 'legs',
          message: `legs must have exactly ${stops.length + 1} items: origin → first stop, between consecutive stops, last stop → return`,
        });
      if (s.bases.length !== stops.length)
        issues.push({
          path: 'bases',
          message: `bases must have exactly ${stops.length} items, one per stop`,
        });
      stops.forEach((st, i) => {
        const b = s.bases[i];
        if (b && norm(b.stop) !== norm(st.label))
          issues.push({
            path: `bases.${i}.stop`,
            message: `must be "${st.label}" (stops keep the given order)`,
          });
        if (b && b.nights !== st.nights)
          issues.push({ path: `bases.${i}.nights`, message: `must be ${st.nights}` });
      });
      return issues.length ? issues : null;
    },
    messages: [
      {
        role: 'system',
        content: `${SYSTEM_BASE(L, 'Fase 1 di 7: imposta il viaggio, scegliendo come arrivare, come spostarsi tra le tappe e sul posto e dove dormire.')}
Regole:
- Le tappe sono già nell'ordine del percorso: non riordinarle e non aggiungerne.
- "legs" ha un tratto per ogni spostamento: partenza → prima tappa, tra tappe consecutive, ultima tappa → rientro (il rientro è la partenza se non indicato diversamente).
- Scegli i mezzi con buon senso: distanze, isole (traghetti o voli), tempo, costo, preferenze e numero di persone.
- "bases" ha una voce per tappa, con le notti indicate, il tipo di alloggio adatto e come sistemare il gruppo in base ad adulti e bambini (es. "appartamento con 2 camere" oppure "2 camere doppie").
- "rental.needed" è true solo se un'auto a noleggio conviene davvero; indica i posti necessari.
- "title" breve e invitante, "summary" di due frasi.
JSON Schema: ${JSON.stringify(schemaOf(StrategySchema))}`,
      },
      { role: 'user', content: describe.json },
    ],
  };
  const value = (await ask(ctx, spec)) as Strategy;
  ctx.state.strategy = value;
  if (ctx.keep) return { count: value.legs.length };
  ctx.plan.trip = {
    ...ctx.plan.trip,
    title: value.title,
    emoji: value.emoji ?? ctx.plan.trip.emoji,
    summary: value.summary,
    timezone: value.timezone ?? ctx.plan.trip.timezone,
    coverQuery: value.coverQuery ?? ctx.plan.trip.coverQuery,
    destination: { ...ctx.plan.trip.destination, countryCodes: value.countryCodes },
    style: ctx.brief.ai?.types ?? [],
  };
  await savePlan(ctx, {
    title: value.title.slice(0, 120),
    emoji: value.emoji ?? ctx.row.emoji,
    description: value.summary,
  });
  return { count: value.legs.length };
}

async function stepPlaces(
  ctx: RunCtx,
  progress: (p: { done: number; total: number }) => Promise<void>,
) {
  const { stops, intensity, json } = ctx.describe;
  const L = lang(ctx.locale);
  const strategy = ctx.state.strategy!;
  const needed = stops.map((s) => ({
    stop: s.label,
    luoghiRichiesti: Math.max(3, Math.max(1, s.nights) * intensity.perDay),
  }));
  const total = needed.reduce((n, x) => n + x.luoghiRichiesti, 0);
  const spec: TaskSpec = {
    schemaName: 'tripshare_gen_places',
    schema: PlacesResultSchema,
    jsonSchema: schemaOf(PlacesResultSchema),
    repairs: 2,
    validate: (value) => {
      const v = value as z.infer<typeof PlacesResultSchema>;
      const issues: Issue[] = [];
      const seen = new Set<string>();
      v.places.forEach((p, i) => {
        if (seen.has(p.place.id))
          issues.push({ path: `places.${i}.place.id`, message: `duplicate id "${p.place.id}"` });
        seen.add(p.place.id);
        if (!stops.some((s) => norm(s.label) === norm(p.stop)))
          issues.push({
            path: `places.${i}.stop`,
            message: `must be one of: ${stops.map((s) => s.label).join(', ')}`,
          });
        if (p.place.kind === 'lodging')
          issues.push({ path: `places.${i}.place.kind`, message: 'lodging is not allowed here' });
      });
      needed.forEach((n) => {
        const have = v.places.filter((p) => norm(p.stop) === norm(n.stop)).length;
        const min = Math.ceil(n.luoghiRichiesti * 0.6);
        if (have < min)
          issues.push({
            path: 'places',
            message: `"${n.stop}" needs at least ${min} places, got ${have}`,
          });
      });
      return issues.length ? issues : null;
    },
    messages: [
      {
        role: 'system',
        content: `${SYSTEM_BASE(L, 'Fase 2 di 7: scegli i luoghi più interessanti di ogni tappa.')}
Regole:
- Solo luoghi reali e noti, adatti a tipo di viaggio, tipo di esperienza (local = autentico e poco turistico, alternativa = fuori dai percorsi classici, mainstream = i grandi classici), esigenze e composizione del gruppo (bambini). In "stop" scrivi il nome esatto della tappa.
- Per ogni tappa dai circa il numero di luoghi indicato in "luoghiRichiesti", mescolando visite, natura, quartieri e circa un ristorante o caffè tipico per giorno (kind "restaurant", "cafe" o "bar").
- Niente alloggi né aeroporti o stazioni (le prenotazioni vengono dopo).
- "mapsQuery" è obbligatorio: nome e città, esattamente come si cercherebbe su una mappa. "description" breve (una o due frasi). "price" solo se lo conosci, con "approximate": true; "openingHours" solo se sei sicuro, altrimenti omettilo.
- Non inventare luoghi per arrivare al numero richiesto: meglio qualcuno in meno.
JSON Schema: ${JSON.stringify(schemaOf(PlacesResultSchema))}`,
      },
      {
        role: 'user',
        content: `${json}\nStrategia già decisa: ${JSON.stringify({
          local: strategy.local,
          pace: strategy.pace,
          guidelines: strategy.guidelines,
        })}\nLuoghi richiesti per tappa: ${JSON.stringify(needed)}`,
      },
    ],
  };
  const value = (await ask(ctx, spec)) as z.infer<typeof PlacesResultSchema>;
  const places: Place[] = value.places.map((p) => ({
    ...p.place,
    verification: { status: 'unverified', sources: [] },
    tips: p.place.tips ?? [],
    links: [],
  }));

  // Ogni luogo si cerca su OpenStreetMap vicino alla sua tappa: se si trova prende le coordinate
  // (servono per le distanze), altrimenti resta segnalato come da controllare.
  const missing: string[] = [];
  let done = 0;
  await progress({ done, total: places.length });
  for (const [i, p] of value.places.entries()) {
    const stop = stops.find((s) => norm(s.label) === norm(p.stop))!;
    try {
      const hits = await searchPlaces(
        p.place.mapsQuery ?? `${p.place.name}, ${stop.label}`,
        ctx.locale,
        ctx.deps.httpFetch,
      );
      const near = hits.find((h) => haversineKm(h, stop) <= 80);
      if (near) places[i] = { ...places[i]!, location: { lat: near.lat, lng: near.lon } };
      else missing.push(p.place.name);
    } catch {
      // servizio non raggiungibile: il luogo resta senza coordinate, senza bloccare la fase
    }
    await progress({ done: ++done, total: places.length });
  }
  ctx.plan = { ...ctx.plan, places };
  await savePlan(ctx);
  for (const name of missing.slice(0, 10))
    ctx.state.warnings.push({ k: 'placeNotFound', p: { name } });
  return { count: places.length };
}

async function stepDays(ctx: RunCtx) {
  const { stops, intensity, json, start, end } = ctx.describe;
  const L = lang(ctx.locale);
  const strategy = ctx.state.strategy!;
  const schedule = dayStops(stops, start, end);
  const placeIndex = new Map(ctx.plan.places.map((p) => [p.id, p]));
  const spec: TaskSpec = {
    schemaName: 'tripshare_gen_days',
    schema: DaysResultSchema,
    jsonSchema: schemaOf(DaysResultSchema),
    repairs: 2,
    validate: (value) => {
      const v = value as z.infer<typeof DaysResultSchema>;
      const issues: Issue[] = [];
      const expected = schedule.map((d) => d.date);
      if (v.days.length !== expected.length || v.days.some((d, i) => d.date !== expected[i]))
        issues.push({
          path: 'days',
          message: `days must be exactly these dates in order: ${expected.join(', ')}`,
        });
      v.days.forEach((d, di) => {
        const visits = d.activities.filter((a) => VISIT_TYPES.has(a.type));
        if (visits.length > intensity.max)
          issues.push({
            path: `days.${di}.activities`,
            message: `${d.date} has ${visits.length} visits, at most ${intensity.max} (${intensity.label})`,
          });
        // Due visite consecutive molto lontane senza uno spostamento in mezzo non sono realistiche.
        const pts = d.activities.filter((a) => a.placeIds.length > 0);
        for (let i = 1; i < pts.length; i++) {
          const a = placeIndex.get(pts[i - 1]!.placeIds[0]!)?.location;
          const b = placeIndex.get(pts[i]!.placeIds[0]!)?.location;
          if (!a || !b) continue;
          const km = haversineKm({ lat: a.lat, lon: a.lng }, { lat: b.lat, lon: b.lng });
          const between = d.activities
            .slice(d.activities.indexOf(pts[i - 1]!), d.activities.indexOf(pts[i]!))
            .some((x) => x.type === 'travel' || x.type === 'flight');
          if (km > MAX_VISIT_GAP_KM && !between)
            issues.push({
              path: `days.${di}.activities`,
              message: `${d.date}: "${pts[i - 1]!.title}" and "${pts[i]!.title}" are ${Math.round(km)} km apart without a travel activity in between`,
            });
        }
        if (d.stayBookingId)
          issues.push({
            path: `days.${di}.stayBookingId`,
            message: 'leave stayBookingId empty (bookings come later)',
          });
      });
      if (issues.length) return issues;
      return validateDoc({ ...ctx.plan, days: v.days });
    },
    messages: [
      {
        role: 'system',
        content: `${SYSTEM_BASE(L, 'Fase 3 di 7: pianifica ogni giornata usando i luoghi scelti.')}
Regole:
- Un elemento per ognuna delle date indicate in "calendario", in ordine. In "stop" c'è dove si dorme e si trova il gruppo quel giorno: le visite sono di quella tappa. Il primo giorno comprende l'arrivo; l'ultimo il rientro.
- Usa SOLO i luoghi dell'elenco (placeIds con i loro id); non crearne di nuovi. Pasti ("meal") presso ristoranti e caffè dell'elenco. Visite (visit, activity, shopping) al massimo ${intensity.max} al giorno (${intensity.label}).
- Il giorno in cui si cambia tappa, inserisci uno spostamento (type "travel" o "flight") con "transport" coerente con "tratti" della strategia (mezzo, durata, distanza), poi check-in. Ai giorni di arrivo e partenza metti "checkin" e "checkout" dell'alloggio.
- Orari HH:MM realistici e in ordine cronologico, con distanze e orari di apertura.
- "route" elenca le tappe del giorno. "alternatives" solo per le parti legate al meteo o alla stanchezza (al massimo una o due nel viaggio).
- Non inserire "stayBookingId" né "bookingId": le prenotazioni si creano dopo. Gli id delle attività sono unici e diversi da quelli dei luoghi.
JSON Schema: ${JSON.stringify(schemaOf(DaysResultSchema))}`,
      },
      {
        role: 'user',
        content: `${json}\nStrategia: ${JSON.stringify({
          tratti: strategy.legs,
          localmente: strategy.local,
          ritmo: strategy.pace,
          alloggi: strategy.bases,
        })}\nCalendario: ${JSON.stringify(schedule)}\nLuoghi disponibili: ${JSON.stringify(
          ctx.plan.places.map((p) => ({
            id: p.id,
            nome: p.name,
            tipo: p.kind,
            tappa: stops.find((s) =>
              p.location
                ? haversineKm({ lat: p.location.lat, lon: p.location.lng }, s) <= 80
                : false,
            )?.label,
            orari: p.openingHours,
            descrizione: p.description?.slice(0, 120),
          })),
        )}`,
      },
    ],
  };
  const value = (await ask(ctx, spec)) as z.infer<typeof DaysResultSchema>;
  ctx.plan = { ...ctx.plan, days: value.days };
  await savePlan(ctx);
  return { count: value.days.length };
}

const TYPE_CATEGORY: Record<string, BudgetItem['category']> = {
  flight: 'flights',
  lodging: 'lodging',
  car_rental: 'car',
  parking: 'parking',
  train: 'transport',
  bus: 'transport',
  ferry: 'transport',
  tour: 'activities',
  ticket: 'tickets',
  insurance: 'insurance',
  other: 'other',
};

/** Ogni notte tra il primo e l'ultimo giorno deve avere un alloggio. */
function uncoveredNights(bookings: Booking[], start: string, end: string): string[] {
  const nights = eachDate(start, end).slice(0, -1);
  return nights.filter(
    (n) =>
      !bookings.some(
        (b) => b.type === 'lodging' && b.start.date <= n && (b.end?.date ?? b.start.date) > n,
      ),
  );
}

async function stepBookings(ctx: RunCtx) {
  const { json, start, end, stops } = ctx.describe;
  const L = lang(ctx.locale);
  const strategy = ctx.state.strategy!;
  const spec: TaskSpec = {
    schemaName: 'tripshare_gen_bookings',
    schema: BookingsResultSchema,
    jsonSchema: schemaOf(BookingsResultSchema),
    repairs: 2,
    validate: (value) => {
      const v = value as z.infer<typeof BookingsResultSchema>;
      const issues: Issue[] = [];
      const lodging = uncoveredNights(v.bookings, start, end);
      if (lodging.length)
        issues.push({
          path: 'bookings',
          message: `no lodging booking covers these nights: ${lodging.join(', ')} (check-in on arrival day, check-out on departure day)`,
        });
      const ids = new Set(v.bookings.map((b) => b.id));
      v.stays.forEach((s, i) => {
        if (!ids.has(s.bookingId))
          issues.push({
            path: `stays.${i}.bookingId`,
            message: `unknown booking "${s.bookingId}"`,
          });
      });
      const activityIds = new Set(ctx.plan.days.flatMap((d) => d.activities.map((a) => a.id)));
      v.activityLinks.forEach((l, i) => {
        if (!activityIds.has(l.activityId))
          issues.push({
            path: `activityLinks.${i}.activityId`,
            message: `unknown activity "${l.activityId}"`,
          });
        if (!ids.has(l.bookingId))
          issues.push({
            path: `activityLinks.${i}.bookingId`,
            message: `unknown booking "${l.bookingId}"`,
          });
      });
      if (issues.length) return issues;
      return validateDoc(applyBookings(ctx.plan, v));
    },
    messages: [
      {
        role: 'system',
        content: `${SYSTEM_BASE(L, 'Fase 4 di 7: proponi le prenotazioni (trasporti, alloggi, attrazioni) per il gruppo.')}
Regole:
- Tutte con "status" "to_book" (o "optional" per quelle facoltative), tranne ciò che l'utente dichiara già prenotato in "giaPrenotato": in quel caso "booked" con i dati che ha scritto. Mai codici di conferma né numeri di volo inventati.
- Un alloggio per ogni tappa: check-in nel giorno di arrivo, check-out nel giorno di partenza dalla tappa; ogni notte del viaggio deve essere coperta. Il titolo indica la sistemazione adatta al gruppo (es. "Appartamento con 2 camere a Palermo (4 persone)") e "cost" è una stima con "approximate": true e "basis" "per_night" o "total".
- Trasporti: voli, treni, traghetti, noleggio auto (con ritiro e riconsegna) per i "tratti" della strategia che li richiedono, con date e orari indicativi coerenti con le giornate. Non servono prenotazioni per i mezzi locali.
- Biglietti ("ticket") solo per le attrazioni dove la prenotazione serve o conviene; "cost" per persona (basis "per_person") con riduzioni per i bambini indicate nelle note.
- "stays" collega ogni notte (data) all'alloggio; "activityLinks" collega attività del programma (check-in, check-out, voli, ritiro auto, ingressi) alla loro prenotazione.
- Valuta locale per ogni importo (non quella del viaggio se diversa).
JSON Schema: ${JSON.stringify(schemaOf(BookingsResultSchema))}`,
      },
      {
        role: 'user',
        content: `${json}\nStrategia: ${JSON.stringify(strategy)}\nPrenotazioni da rispettare e persone: ${JSON.stringify(
          { viaggiatori: ctx.brief.travelers, tappe: stops.map((s) => s.label) },
        )}\nProgramma: ${JSON.stringify(
          ctx.plan.days.map((d) => ({
            data: d.date,
            attivita: d.activities.map((a) => ({
              id: a.id,
              ora: a.time,
              tipo: a.type,
              titolo: a.title,
              luoghi: a.placeIds,
            })),
          })),
        )}\nLuoghi: ${JSON.stringify(ctx.plan.places.map((p) => ({ id: p.id, nome: p.name, tipo: p.kind })))}`,
      },
    ],
  };
  const value = (await ask(ctx, spec)) as z.infer<typeof BookingsResultSchema>;
  ctx.plan = applyBookings(ctx.plan, value);
  await savePlan(ctx);
  return { count: value.bookings.length };
}

/** Aggiunge le prenotazioni proposte e le collega ai giorni (notti) e alle attività. */
function applyBookings(plan: TripDocument, v: z.infer<typeof BookingsResultSchema>): TripDocument {
  const stays = new Map(v.stays.map((s) => [s.date, s.bookingId]));
  const links = new Map(v.activityLinks.map((l) => [l.activityId, l.bookingId]));
  const bookings = v.bookings.map((b) => ({
    ...b,
    // Le prenotazioni dell'AI sono proposte: il codice di conferma c'è solo se l'utente l'ha scritto.
    confirmationCode: b.status === 'booked' ? b.confirmationCode : undefined,
  }));
  return {
    ...plan,
    bookings,
    days: plan.days.map((d) => ({
      ...d,
      stayBookingId: stays.get(d.date) ?? d.stayBookingId,
      activities: d.activities.map((a) =>
        links.has(a.id) ? { ...a, bookingId: links.get(a.id) } : a,
      ),
    })),
  };
}

async function stepBudget(ctx: RunCtx) {
  const { json } = ctx.describe;
  const L = lang(ctx.locale);
  const row = ctx.row;
  const tier = ctx.brief.ai?.budget ?? 'mid';
  // Le voci delle prenotazioni le crea il programma: restano sempre allineate ai loro costi.
  const fromBookings: BudgetItem[] = ctx.plan.bookings
    .filter((b) => b.cost)
    .map((b) => ({
      id: `budget-${b.id}`.slice(0, 64),
      title: b.title,
      category: TYPE_CATEGORY[b.type] ?? 'other',
      status: b.status === 'booked' && b.paid ? 'booked' : 'estimate',
      amount: b.cost,
      included: b.status !== 'optional',
      bookingId: b.id,
    }));
  const spec: TaskSpec = {
    schemaName: 'tripshare_gen_budget',
    schema: BudgetResultSchema,
    jsonSchema: schemaOf(BudgetResultSchema),
    repairs: 2,
    validate: (value) => {
      const v = value as z.infer<typeof BudgetResultSchema>;
      const issues: Issue[] = [];
      const ids = new Set<string>(fromBookings.map((b) => b.id));
      v.budget.forEach((b, i) => {
        if (ids.has(b.id))
          issues.push({ path: `budget.${i}.id`, message: `duplicate id "${b.id}"` });
        ids.add(b.id);
        if (!b.amount) issues.push({ path: `budget.${i}.amount`, message: 'amount is required' });
        if (b.bookingId)
          issues.push({
            path: `budget.${i}.bookingId`,
            message: 'booking costs are already included: do not link bookings',
          });
      });
      const bad = Object.keys(v.exchangeRates ?? {}).find((c) => !isCurrencyCode(c));
      if (bad) issues.push({ path: 'exchangeRates', message: `unknown currency ${bad}` });
      return issues.length ? issues : null;
    },
    messages: [
      {
        role: 'system',
        content: `${SYSTEM_BASE(L, 'Fase 5 di 7: crea il budget del viaggio con stime realistiche.')}
Regole:
- I costi delle prenotazioni (alloggi, trasporti, biglietti prenotati) sono GIÀ nel budget: non ripeterli. Aggiungi solo il resto: pasti (colazione, pranzo e cena per persona e per giorno, secondo la fascia di budget "${tier}"), trasporti locali, carburante e pedaggi se si usa l'auto, ingressi non già prenotati (dai luoghi), mance, extra e imprevisti.
- Tutte con "status" "estimate". Importi nella valuta locale con "basis" corretta ("per_person" si moltiplica per i viaggiatori, "per_day" per i giorni) e "approximate": true. Tieni conto dei bambini (ingressi gratuiti o ridotti, porzioni).
- Compila "exchangeRates" verso ${row.currency} per ogni valuta usata (quante unità di ${row.currency} vale 1 unità della valuta).
- Categorie: food, coffee, groceries, drinks, transport, fuel, parking, tickets, activities, shopping, tips, other.
JSON Schema: ${JSON.stringify(schemaOf(BudgetResultSchema))}`,
      },
      {
        role: 'user',
        content: `${json}\nGià incluso dalle prenotazioni: ${JSON.stringify(
          ctx.plan.bookings.map((b) => ({ titolo: b.title, tipo: b.type, costo: b.cost })),
        )}\nLuoghi con prezzo: ${JSON.stringify(
          ctx.plan.places.filter((p) => p.price).map((p) => ({ nome: p.name, prezzo: p.price })),
        )}\nGiorni: ${ctx.plan.days.length}`,
      },
    ],
  };
  const value = (await ask(ctx, spec)) as z.infer<typeof BudgetResultSchema>;
  const extra = value.budget.map((b) => ({ ...b, status: 'estimate' as const }));
  ctx.plan = {
    ...ctx.plan,
    budget: [...fromBookings, ...extra],
    exchangeRates: {
      ...(ctx.plan.exchangeRates ?? {}),
      ...Object.fromEntries(
        Object.entries(value.exchangeRates ?? {}).filter(([c]) => isCurrencyCode(c)),
      ),
    },
  };
  await savePlan(ctx);
  return { count: ctx.plan.budget.length };
}

async function stepPacking(ctx: RunCtx) {
  const { json, start, end } = ctx.describe;
  const L = lang(ctx.locale);
  const spec: TaskSpec = {
    schemaName: 'tripshare_gen_packing',
    schema: PackingResultSchema,
    jsonSchema: schemaOf(PackingResultSchema),
    repairs: 1,
    messages: [
      {
        role: 'system',
        content: `${SYSTEM_BASE(L, 'Fase 6 di 7: prepara la valigia e i consigli.')}
Regole:
- "packing": documenti e adempimenti prima di partire (gruppo "documents"), poi abbigliamento adatto a stagione e clima del luogo nelle date indicate, elettronica, salute, attrezzatura per le attività previste. "perPerson" true per ciò che serve a ciascuno; considera i bambini. "reason" breve quando non è ovvio.
- "tips": consigli generali su guida o mezzi, fuso orario, pagamenti, connessione, stagione e usanze locali (al massimo 8).
JSON Schema: ${JSON.stringify(schemaOf(PackingResultSchema))}`,
      },
      {
        role: 'user',
        content: `${json}\nPeriodo: ${start} → ${end}\nAttività previste: ${JSON.stringify(
          [...new Set(ctx.plan.days.flatMap((d) => d.activities.map((a) => a.title)))].slice(0, 40),
        )}\nMezzi: ${JSON.stringify(ctx.state.strategy?.local)}`,
      },
    ],
  };
  const value = (await ask(ctx, spec)) as z.infer<typeof PackingResultSchema>;
  ctx.plan = { ...ctx.plan, packing: value.packing, tips: value.tips };
  await savePlan(ctx);
  return { count: value.packing.length + value.tips.length };
}

/** Foto libere (Wikimedia Commons) per i luoghi del programma, senza chiedere nulla all'AI. */
async function stepPhotos(
  ctx: RunCtx,
  progress: (p: { done: number; total: number }) => Promise<void>,
) {
  const storage = ctx.deps.storage;
  if (!storage) return { count: 0 };
  const maxBytes = (await ctx.deps.settings.get('uploads.maxMb')) * 1024 * 1024;
  // Prima i luoghi che compaiono nel programma, nell'ordine dei giorni.
  const order = new Map<string, number>();
  ctx.plan.days.forEach((d) =>
    d.activities.forEach((a) =>
      a.placeIds.forEach((id) => order.has(id) || order.set(id, order.size)),
    ),
  );
  const targets = ctx.plan.places
    .filter((p) => !p.photo && p.kind !== 'lodging')
    .sort((a, b) => (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999))
    .slice(0, 20);
  let done = 0;
  let count = 0;
  await progress({ done, total: targets.length });
  for (const p of targets) {
    try {
      const hits = await searchCommons(p.name, ctx.deps.appName, ctx.deps.httpFetch);
      for (const hit of hits.slice(0, 3)) {
        try {
          const data = await downloadImageFromAnyUrl(hit.full, maxBytes, ctx.deps.httpFetch);
          const meta = await sharp(data, { limitInputPixels: 80_000_000 }).metadata();
          if ((meta.width ?? 0) < 500) continue;
          const photo = await storage.saveImage(data, 'place');
          const place = ctx.plan.places.find((x) => x.id === p.id)!;
          place.photo = photo;
          place.photoCredit = hit.credit ?? hit.source;
          count++;
          break;
        } catch {
          // immagine non scaricabile: si prova la successiva
        }
      }
    } catch {
      // ricerca non riuscita: il luogo resta senza foto
    }
    await progress({ done: ++done, total: targets.length });
  }
  await savePlan(ctx);
  return { count };
}

// ---------------------------------------------------------------------------------------------
// Orchestrazione
// ---------------------------------------------------------------------------------------------

export interface GenerationRange {
  /** Ultima fase da eseguire (di default l'ultima). */
  until?: GenStepKey;
  /**
   * Genera solo ciò che manca senza cambiare il resto: niente nuovo titolo, niente pulizia delle
   * fasi seguenti. Serve ai pulsanti "Proponi con l'AI" delle sezioni vuote.
   */
  keep?: boolean;
}

export function initialState(
  from: GenStepKey = 'strategy',
  previous?: GenerationState,
  range: GenerationRange = {},
): GenerationState {
  const first = GENERATION_STEPS.indexOf(from);
  if (range.keep) {
    const last = Math.max(first, GENERATION_STEPS.indexOf(range.until ?? from));
    const keys = GENERATION_STEPS.slice(first, last + 1);
    // Senza una strategia già decisa si parte da quella (senza toccare titolo e foto del viaggio).
    if (!previous?.strategy && from !== 'strategy') keys.unshift('strategy');
    return {
      status: 'running',
      startedAt: new Date().toISOString(),
      warnings: [],
      strategy: previous?.strategy,
      steps: keys.map((key) => ({ key, status: 'pending' }) satisfies GenStep),
    };
  }
  const last = GENERATION_STEPS.indexOf(range.until ?? 'photos');
  return {
    status: 'running',
    startedAt: new Date().toISOString(),
    warnings: first === 0 ? [] : (previous?.warnings ?? []),
    strategy: first === 0 ? undefined : previous?.strategy,
    steps: GENERATION_STEPS.map((key, i) => {
      const prior = previous?.steps.find((s) => s.key === key);
      return i < first && prior?.status === 'done'
        ? prior
        : ({ key, status: 'pending' } satisfies GenStep);
    }).filter((_, i) => i <= last),
  };
}

/**
 * La scheda del viaggio: quella della creazione guidata oppure, per i viaggi creati senza (o prima
 * della creazione guidata), una minima ricavata dalla destinazione cercata su OpenStreetMap.
 */
async function ensureBrief(
  deps: AiDeps,
  row: typeof trip.$inferSelect,
  members: number,
  locale: Locale,
): Promise<TripBrief> {
  const parsed = TripBriefSchema.safeParse(row.brief);
  if (parsed.success) return parsed.data;
  const name = row.destination || row.title;
  let hit: Awaited<ReturnType<typeof searchPlaces>>[number] | undefined;
  try {
    hit = (await searchPlaces(name, locale, deps.httpFetch))[0];
  } catch {
    hit = undefined;
  }
  if (!hit) throw new AiJobError('GENERATION_BRIEF_MISSING');
  const brief: TripBrief = {
    main: { label: hit.label, lat: hit.lat, lon: hit.lon },
    stops: [],
    travelers: { adults: Math.max(1, members), children: [] },
  };
  await deps.db.update(trip).set({ brief }).where(eq(trip.id, row.id));
  return brief;
}

/** Toglie dal programma ciò che le fasi da `from` in poi ricostruiscono (e i collegamenti a esso). */
function clearFrom(plan: TripDocument, from: GenStepKey): TripDocument {
  const i = GENERATION_STEPS.indexOf(from);
  let out = { ...plan };
  if (i <= GENERATION_STEPS.indexOf('places')) out = { ...out, places: [] };
  if (i <= GENERATION_STEPS.indexOf('days')) out = { ...out, days: [] };
  if (i <= GENERATION_STEPS.indexOf('bookings'))
    out = {
      ...out,
      bookings: [],
      days: out.days.map((d) => ({
        ...d,
        stayBookingId: undefined,
        activities: d.activities.map((a) => ({ ...a, bookingId: undefined })),
      })),
    };
  if (i <= GENERATION_STEPS.indexOf('budget')) out = { ...out, budget: [] };
  if (i <= GENERATION_STEPS.indexOf('packing')) out = { ...out, packing: [], tips: [] };
  return out;
}

/**
 * Esegue le fasi in ordine a partire da `from`. Se una fase non riesce si ferma lì: la
 * generazione resta "failed" e si può riprendere da quella fase.
 */
export async function runGeneration(
  deps: AiDeps,
  base: {
    userId: string;
    tripId: string;
    locale: Locale;
    access: AiAccess;
    from?: GenStepKey;
  } & GenerationRange,
): Promise<Usage & { failedStep?: GenStepKey }> {
  const { db } = deps;
  const [row] = await db.select().from(trip).where(eq(trip.id, base.tripId));
  if (!row) throw new AiJobError('TRIP_NOT_FOUND');
  if (!row.startDate || !row.endDate) throw new AiJobError('GENERATION_DATES_MISSING');
  const members = (await listMembers(db, base.tripId)).filter((m) => !m.removed);
  const brief = await ensureBrief(deps, row, members.length, base.locale);
  const from = base.from ?? 'strategy';
  const previous = (row.generation ?? undefined) as GenerationState | undefined;
  if (!base.keep && from !== 'strategy' && !previous?.strategy)
    throw new AiJobError('GENERATION_NOT_READY');
  const state = initialState(from, previous, { until: base.until, keep: base.keep });
  const plan0 = readPlan(row, members.length, base.locale);
  const ctx: RunCtx = {
    deps,
    db,
    tripId: base.tripId,
    userId: base.userId,
    locale: base.locale,
    access: base.access,
    row,
    brief,
    describe: describeBrief(brief, row, base.locale),
    // Ripartendo da una fase si riparte dal programma già costruito.
    plan: base.keep ? plan0 : clearFrom(plan0, from),
    keep: base.keep,
    state,
    usage: { promptTokens: 0, completionTokens: 0, cost: null, model: null },
  };
  await saveState(ctx);

  const runners: Record<GenStepKey, () => Promise<{ count?: number }>> = {
    strategy: () => stepStrategy(ctx),
    places: () =>
      stepPlaces(ctx, async (p) => {
        step('places').detail = { k: 'checkingPlaces', p: { done: p.done, total: p.total } };
        await saveState(ctx);
      }),
    days: () => stepDays(ctx),
    bookings: () => stepBookings(ctx),
    budget: () => stepBudget(ctx),
    packing: () => stepPacking(ctx),
    photos: () =>
      stepPhotos(ctx, async (p) => {
        step('photos').detail = { k: 'findingPhotos', p: { done: p.done, total: p.total } };
        await saveState(ctx);
      }),
  };
  const step = (key: GenStepKey) => state.steps.find((s) => s.key === key)!;

  for (const { key } of state.steps.filter((x) => x.status === 'pending')) {
    const s = step(key);
    s.status = 'running';
    s.detail = undefined;
    s.error = undefined;
    await saveState(ctx);
    try {
      const out = await runners[key]();
      s.status = 'done';
      s.count = out.count;
      s.detail = undefined;
      await saveState(ctx);
    } catch (err) {
      deps.log?.(`[ai] generazione ${base.tripId}, fase ${key}: ${String(err)}`);
      s.status = 'failed';
      s.error = err instanceof Error ? err.message.slice(0, 200) : 'AI_FAILED';
      state.status = 'failed';
      await saveState(ctx);
      return { ...ctx.usage, failedStep: key };
    }
  }
  // Un controllo finale sul risultato: budget in fascia, ogni luogo in un giorno.
  addFinalWarnings(ctx);
  state.status = 'done';
  state.finishedAt = new Date().toISOString();
  await saveState(ctx);
  return ctx.usage;
}

/** Avvisi per la revisione: cose che l'utente dovrebbe guardare. */
function addFinalWarnings(ctx: RunCtx) {
  const { plan, state } = ctx;
  const used = new Set(plan.days.flatMap((d) => d.activities.flatMap((a) => a.placeIds)));
  const unused = plan.places.filter((p) => !used.has(p.id));
  if (unused.length > 0) state.warnings.push({ k: 'placesUnused', p: { count: unused.length } });
  const noLocation = plan.places.filter((p) => !p.location).length;
  if (noLocation > 0) state.warnings.push({ k: 'placesToCheck', p: { count: noLocation } });
}

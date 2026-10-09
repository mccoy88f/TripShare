import { TRPCError } from '@trpc/server';
import { and, count, eq, isNull } from 'drizzle-orm';
import { ZodError } from 'zod';
import { trip, tripMember, type Database } from '@tripshare/db';
import { isCurrencyCode, isLocale, type Locale } from '@tripshare/shared';
import {
  PlanOpError,
  TripDocumentSchema,
  emptyPlan,
  normalizePlan,
  type TripDocument,
} from '@tripshare/shared/trip-format';

type TripRow = typeof trip.$inferSelect;

export async function activeMemberCount(db: Database, tripId: string) {
  const [row] = await db
    .select({ value: count() })
    .from(tripMember)
    .where(and(eq(tripMember.tripId, tripId), isNull(tripMember.removedAt)));
  return row?.value ?? 1;
}

/**
 * Programma del viaggio nel formato standard. I dati principali (titolo, date, valuta,
 * destinazione) arrivano sempre dalla riga del viaggio, che resta la fonte autorevole.
 */
export function readPlan(row: TripRow, members: number, locale: Locale = 'it'): TripDocument {
  const currency = isCurrencyCode(row.currency) ? row.currency : 'EUR';
  let plan: TripDocument;
  const parsed = row.plan ? TripDocumentSchema.safeParse(row.plan) : null;
  if (parsed?.success) plan = parsed.data;
  else {
    plan = emptyPlan({
      title: row.title,
      emoji: row.emoji,
      destination: row.destination,
      startDate: row.startDate,
      endDate: row.endDate,
      currency,
      travelers: members,
      language: isLocale(locale) ? locale : 'it',
    });
  }
  const first = plan.days[0]?.date;
  const last = plan.days.at(-1)?.date;
  const min = (a?: string | null, b?: string) => (a && b ? (a < b ? a : b) : (a ?? b ?? undefined));
  const max = (a?: string | null, b?: string) => (a && b ? (a > b ? a : b) : (a ?? b ?? undefined));
  return {
    ...plan,
    trip: {
      ...plan.trip,
      title: row.title,
      emoji: row.emoji ?? undefined,
      summary: row.description ?? plan.trip.summary,
      destination: {
        ...plan.trip.destination,
        name: row.destination || plan.trip.destination.name || row.title,
      },
      // I giorni del programma restano validi anche se le date del viaggio vengono ristrette.
      startDate: min(row.startDate, first),
      endDate: max(row.endDate, last),
      currency,
      travelers: members > 1 ? members : plan.trip.travelers,
    },
  };
}

export function prepareForStorage(plan: TripDocument): TripDocument {
  return normalizePlan(TripDocumentSchema.parse(plan));
}

/** Converte gli errori di validazione e delle operazioni in errori tRPC leggibili. */
export function planError(err: unknown): never {
  if (err instanceof TRPCError) throw err;
  if (err instanceof PlanOpError)
    throw new TRPCError({ code: 'BAD_REQUEST', message: err.message });
  if (err instanceof ZodError) {
    const first = err.issues[0];
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `PLAN_INVALID:${first ? `${first.path.join('.')}: ${first.message}` : ''}`,
    });
  }
  throw err;
}

const PLACE_PHOTO = /^\/api\/files\/place-[a-f0-9]{32}\.webp$/;

/**
 * Elimina i file delle foto dei luoghi che non compaiono più nel programma (luogo tolto,
 * foto sostituita o programma azzerato). Le foto esterne (https) non sono nostre.
 */
export async function removeOrphanPhotos(
  storage: { removeByUrl(url: string): Promise<void> } | undefined,
  before: TripDocument | undefined,
  after: TripDocument | undefined,
) {
  if (!storage || !before) return;
  const kept = new Set((after?.places ?? []).map((p) => p.photo));
  for (const p of before.places)
    if (p.photo && PLACE_PHOTO.test(p.photo) && !kept.has(p.photo))
      await storage.removeByUrl(p.photo).catch(() => undefined);
}

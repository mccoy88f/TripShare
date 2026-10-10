import { and, desc, eq, gt, isNull, lt, sql } from 'drizzle-orm';
import { notification, tripEvent, tripMember, type Database } from '@tripshare/db';
import type { TripDocument } from '@tripshare/shared/trip-format';

/**
 * Registro delle modifiche a un viaggio e notifiche ai membri. Ogni modifica diventa un evento
 * (tipo + parametri, i testi si compongono nel client nella lingua di chi legge) e una notifica
 * per ogni altro membro con un account. Modifiche simili dello stesso autore ravvicinate si
 * fondono in un solo evento ("Marco ha aggiunto 4 attività"). Il registro non deve mai far
 * fallire la modifica da cui nasce: gli errori si ignorano.
 */
export const EVENT_TYPES = [
  'expense.created',
  'expense.updated',
  'expense.deleted',
  'expense.paid',
  'settlement.created',
  'plan.activity.added',
  'plan.activity.updated',
  'plan.activity.deleted',
  'plan.day.added',
  'plan.day.deleted',
  'plan.place.added',
  'plan.place.updated',
  'plan.place.photo',
  'plan.place.deleted',
  'plan.booking.added',
  'plan.booking.updated',
  'plan.booking.deleted',
  'plan.budget.added',
  'plan.budget.updated',
  'plan.budget.deleted',
  'plan.packing.added',
  'plan.packing.deleted',
  'plan.tips.updated',
  'plan.replaced',
  'ticket.added',
  'note.created',
  'note.updated',
  'member.joined',
  'member.left',
  'member.role',
  'trip.updated',
  'trip.reset',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export type EventData = Record<string, string | number | boolean | null | undefined>;

/** Finestra entro cui modifiche simili dello stesso autore si fondono. */
export const COALESCE_MS = 5 * 60 * 1000;

export interface RecordedEvent {
  eventId: string;
  tripId: string;
  type: EventType;
  /** Utenti a cui è stata creata o riattivata la notifica. */
  recipients: string[];
  /** true se l'evento è nuovo, false se ne ha fuso uno recente. */
  created: boolean;
}

/** Hook chiamato dopo ogni evento registrato (tempo reale, push). */
type EventListener = (event: RecordedEvent) => void;
const listeners = new Set<EventListener>();
export const onRecordedEvent = (fn: EventListener) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export interface EventInput {
  tripId: string;
  /** Utente che ha fatto la modifica: non riceve la notifica. */
  actorUserId: string;
  type: EventType;
  entityId?: string | null;
  data?: EventData;
}

export async function recordEvent(db: Database, input: EventInput): Promise<RecordedEvent | null> {
  const members = await db
    .select({ id: tripMember.id, userId: tripMember.userId })
    .from(tripMember)
    .where(and(eq(tripMember.tripId, input.tripId), isNull(tripMember.removedAt)));
  const actor = members.find((m) => m.userId === input.actorUserId);
  const recipients = members
    .filter((m) => m.userId && m.userId !== input.actorUserId)
    .map((m) => m.userId!);
  if (recipients.length === 0) return null;

  const now = new Date();
  const data = (input.data ?? {}) as Record<string, unknown>;
  // Le modifiche allo stesso elemento si fondono per elemento, le altre per tipo.
  const sameEntity = input.type.endsWith('.updated') || input.type === 'plan.place.photo';
  const [recent] = await db
    .select()
    .from(tripEvent)
    .where(
      and(
        eq(tripEvent.tripId, input.tripId),
        eq(tripEvent.type, input.type),
        actor ? eq(tripEvent.actorMemberId, actor.id) : isNull(tripEvent.actorMemberId),
        gt(tripEvent.updatedAt, new Date(now.getTime() - COALESCE_MS)),
        ...(sameEntity && input.entityId ? [eq(tripEvent.entityId, input.entityId)] : []),
      ),
    )
    .orderBy(desc(tripEvent.updatedAt))
    .limit(1);

  let eventId: string;
  let created = false;
  if (recent) {
    eventId = recent.id;
    await db
      .update(tripEvent)
      .set({
        count: sql`${tripEvent.count} + 1`,
        entityId: input.entityId ?? recent.entityId,
        data,
        updatedAt: now,
      })
      .where(eq(tripEvent.id, recent.id));
  } else {
    const [row] = await db
      .insert(tripEvent)
      .values({
        tripId: input.tripId,
        actorMemberId: actor?.id ?? null,
        type: input.type,
        entityId: input.entityId ?? null,
        data,
      })
      .returning({ id: tripEvent.id });
    eventId = row!.id;
    created = true;
  }
  // Una notifica fusa torna "da leggere" e risale in cima.
  await db
    .insert(notification)
    .values(recipients.map((userId) => ({ userId, tripId: input.tripId, eventId })))
    .onConflictDoUpdate({
      target: [notification.userId, notification.eventId],
      set: { readAt: null, createdAt: now },
    });
  const recorded: RecordedEvent = {
    eventId,
    tripId: input.tripId,
    type: input.type,
    recipients,
    created,
  };
  for (const fn of listeners) {
    try {
      fn(recorded);
    } catch {
      // un ascoltatore che fallisce non deve bloccare gli altri
    }
  }
  return recorded;
}

/** Registra un evento senza mai propagare errori. */
export async function notifyTrip(
  db: Database,
  input: EventInput,
  log?: (msg: string) => void,
): Promise<void> {
  try {
    await recordEvent(db, input);
  } catch (err) {
    log?.(`[events] ${input.type}: ${String(err)}`);
  }
}

/** Elimina gli eventi (e quindi le notifiche) più vecchi di `days` giorni. */
export async function pruneEvents(db: Database, days = 90) {
  const cutoff = new Date(Date.now() - days * 86_400_000);
  const rows = await db
    .delete(tripEvent)
    .where(lt(tripEvent.updatedAt, cutoff))
    .returning({ id: tripEvent.id });
  return rows.length;
}

// --- Cosa è cambiato nel programma ---------------------------------------------------------

export interface PlanChange {
  type: EventType;
  entityId: string;
  data: EventData;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const MAX_CHANGES = 30;

/** Differenze tra due versioni del programma, una per elemento aggiunto, cambiato o tolto. */
export function diffPlan(before: TripDocument, after: TripDocument): PlanChange[] {
  const out: PlanChange[] = [];
  const push = (type: EventType, entityId: string, data: EventData) =>
    out.length < MAX_CHANGES && out.push({ type, entityId, data });

  const compare = <T extends { id?: string }>(
    prev: T[],
    next: T[],
    types: { added: EventType; updated?: EventType; deleted: EventType },
    describe: (x: T) => EventData,
    photoOnly?: (a: T, b: T) => boolean,
  ) => {
    const before = new Map(prev.map((x) => [x.id!, x]));
    const after = new Map(next.map((x) => [x.id!, x]));
    for (const [id, x] of after) {
      const old = before.get(id);
      if (!old) push(types.added, id, describe(x));
      else if (!same(old, x)) {
        if (photoOnly?.(old, x)) push('plan.place.photo', id, describe(x));
        else if (types.updated) push(types.updated, id, describe(x));
      }
    }
    for (const [id, x] of before) if (!after.has(id)) push(types.deleted, id, describe(x));
  };

  const activities = (doc: TripDocument) =>
    doc.days.flatMap((d) =>
      [...d.activities, ...d.alternatives.flatMap((a) => a.activities)].map((a) => ({
        ...a,
        date: d.date,
      })),
    );
  compare(
    activities(before),
    activities(after),
    {
      added: 'plan.activity.added',
      updated: 'plan.activity.updated',
      deleted: 'plan.activity.deleted',
    },
    (a) => ({ title: a.title, date: a.date }),
  );
  compare(
    before.days.map((d) => ({ ...d, id: d.date })),
    after.days.map((d) => ({ ...d, id: d.date })),
    { added: 'plan.day.added', deleted: 'plan.day.deleted' },
    (d) => ({ title: d.title, date: d.date }),
  );
  const stripPhoto = (p: { photo?: string; photoCredit?: string }) => {
    const { photo: _p, photoCredit: _c, ...rest } = p as Record<string, unknown>;
    void _p;
    void _c;
    return rest;
  };
  compare(
    before.places,
    after.places,
    { added: 'plan.place.added', updated: 'plan.place.updated', deleted: 'plan.place.deleted' },
    (p) => ({ title: p.name }),
    (a, b) => same(stripPhoto(a), stripPhoto(b)),
  );
  compare(
    before.bookings,
    after.bookings,
    {
      added: 'plan.booking.added',
      updated: 'plan.booking.updated',
      deleted: 'plan.booking.deleted',
    },
    (b) => ({ title: b.title, date: b.start.date }),
  );
  compare(
    before.budget,
    after.budget,
    { added: 'plan.budget.added', updated: 'plan.budget.updated', deleted: 'plan.budget.deleted' },
    (b) => ({ title: b.title }),
  );
  compare(
    before.packing,
    after.packing,
    { added: 'plan.packing.added', deleted: 'plan.packing.deleted' },
    (p) => ({ title: p.item }),
  );
  if (!same(before.tips, after.tips)) push('plan.tips.updated', 'tips', {});
  return out;
}

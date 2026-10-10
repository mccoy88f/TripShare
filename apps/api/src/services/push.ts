import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import webpush from 'web-push';
import {
  notification,
  pushSubscription,
  trip,
  tripEvent,
  tripMember,
  user,
  type Database,
} from '@tripshare/db';
import { formatNotification, isLocale, notificationUrl } from '@tripshare/shared';
import type { Queue } from 'bullmq';
import type { SettingsService } from '../settings.js';
import { onRecordedEvent } from './events.js';

/**
 * Notifiche push (Web Push): arrivano anche con l'app chiusa. Le chiavi VAPID si generano al
 * primo avvio e restano nelle impostazioni (cifrate). Il testo si compone qui, nella lingua di
 * ogni destinatario, con gli stessi testi dell'app.
 */
export const NOTIFY_QUEUE = 'notify';

export interface PushPayload {
  title: string;
  body: string;
  /** Indirizzo relativo da aprire al tocco. */
  url: string;
  /** Notifiche con lo stesso tag si sostituiscono. */
  tag: string;
}

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** Invia una notifica a un dispositivo; con 404 o 410 l'errore ha `statusCode` e il dispositivo va tolto. */
export type PushSender = (target: PushTarget, payload: PushPayload) => Promise<void>;

export async function ensureVapid(settings: SettingsService) {
  const existing = await settings.get('push.vapid');
  if (existing) return existing;
  const keys = webpush.generateVAPIDKeys();
  await settings.set('push.vapid', keys);
  return keys;
}

export function createWebPushSender(settings: SettingsService, subject: string): PushSender {
  return async (target, payload) => {
    const vapid = await ensureVapid(settings);
    await webpush.sendNotification(
      { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
      JSON.stringify(payload),
      {
        TTL: 60 * 60 * 12,
        urgency: 'normal',
        vapidDetails: { subject, publicKey: vapid.publicKey, privateKey: vapid.privateKey },
      },
    );
  };
}

export interface PushDeps {
  db: Database;
  sender: PushSender;
  log?: (msg: string) => void;
}

/** Manda un messaggio a tutti i dispositivi di un utente; toglie quelli non più validi. */
export async function pushToUser(
  deps: PushDeps,
  userId: string,
  payload: PushPayload,
): Promise<number> {
  const subs = await deps.db
    .select()
    .from(pushSubscription)
    .where(eq(pushSubscription.userId, userId));
  let sent = 0;
  for (const sub of subs) {
    try {
      await deps.sender(sub, payload);
      sent++;
      await deps.db
        .update(pushSubscription)
        .set({ lastSentAt: new Date() })
        .where(eq(pushSubscription.id, sub.id));
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        await deps.db.delete(pushSubscription).where(eq(pushSubscription.id, sub.id));
      } else deps.log?.(`[push] invio non riuscito (${status ?? 'errore'}): ${String(err)}`);
    }
  }
  return sent;
}

/** Notifica push di un evento a chi ha una notifica da leggere e almeno un dispositivo. */
export async function sendEventPush(deps: PushDeps, eventId: string): Promise<number> {
  const [event] = await deps.db
    .select({
      id: tripEvent.id,
      tripId: tripEvent.tripId,
      type: tripEvent.type,
      entityId: tripEvent.entityId,
      data: tripEvent.data,
      count: tripEvent.count,
      tripTitle: trip.title,
      tripEmoji: trip.emoji,
      actorName: sql<string | null>`coalesce(${user.name}, ${tripMember.name})`,
    })
    .from(tripEvent)
    .innerJoin(trip, eq(trip.id, tripEvent.tripId))
    .leftJoin(tripMember, eq(tripMember.id, tripEvent.actorMemberId))
    .leftJoin(user, eq(user.id, tripMember.userId))
    .where(eq(tripEvent.id, eventId));
  if (!event) return 0;
  const rows = await deps.db
    .select({ userId: notification.userId })
    .from(notification)
    .where(and(eq(notification.eventId, eventId), isNull(notification.readAt)));
  const userIds = rows.map((r) => r.userId);
  if (userIds.length === 0) return 0;
  const withDevices = await deps.db
    .select({ userId: pushSubscription.userId })
    .from(pushSubscription)
    .where(inArray(pushSubscription.userId, userIds));
  const targets = [...new Set(withDevices.map((d) => d.userId))];
  if (targets.length === 0) return 0;
  const locales = await deps.db
    .select({ id: user.id, locale: user.locale })
    .from(user)
    .where(inArray(user.id, targets));
  let sent = 0;
  for (const { id, locale } of locales) {
    const lang = isLocale(locale) ? locale : 'it';
    const data = (event.data ?? {}) as Record<string, unknown>;
    sent += await pushToUser(deps, id, {
      title: `${event.tripEmoji ? `${event.tripEmoji} ` : ''}${event.tripTitle}`,
      body: formatNotification(
        lang,
        { type: event.type, count: event.count, data },
        event.actorName,
      ),
      url: notificationUrl(event.tripId, event.type, event.entityId, data),
      tag: event.id,
    });
  }
  return sent;
}

/**
 * Dopo ogni nuovo evento accoda l'invio delle notifiche push (al worker); senza coda, come nei
 * test, le invia subito. Le modifiche fuse in un evento già notificato non rinviano la push.
 */
export function registerPushDelivery(deps: {
  db: Database;
  sender?: PushSender;
  queue?: Queue<{ eventId: string }>;
  log?: (msg: string) => void;
}) {
  return onRecordedEvent((e) => {
    if (!e.created || e.recipients.length === 0 || !e.eventId) return;
    if (deps.queue) {
      void deps.queue
        .add(
          'push',
          { eventId: e.eventId },
          {
            attempts: 3,
            backoff: { type: 'exponential', delay: 5000 },
            removeOnComplete: true,
            removeOnFail: 100,
          },
        )
        .catch((err: unknown) => deps.log?.(`[push] coda: ${String(err)}`));
    } else if (deps.sender) {
      void sendEventPush({ db: deps.db, sender: deps.sender, log: deps.log }, e.eventId).catch(
        (err: unknown) => deps.log?.(`[push] ${String(err)}`),
      );
    }
  });
}

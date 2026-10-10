import type { Redis } from 'ioredis';
import { onRecordedEvent, type EventData, type RecordedEvent } from './events.js';

/**
 * Aggiornamenti in tempo reale: ogni modifica a un viaggio arriva subito ai dispositivi aperti dei
 * suoi membri (Server-Sent Events). Con Redis i messaggi passano da un canale comune, così
 * funziona anche con più istanze dell'API; senza, restano nel processo.
 */
export interface RealtimeMessage {
  tripId: string;
  /** Tipo dell'evento (es. "expense.created") o "packing" per le spunte. */
  kind: string;
  eventId?: string;
  entityId?: string | null;
  data?: EventData;
  count?: number;
  actorUserId: string;
  actorName?: string | null;
  /** Membri a cui recapitare il messaggio. */
  users: string[];
  /** Tra questi, chi riceve anche la notifica (non l'autore, né chi la silenzia). */
  notify: string[];
}

type Writer = (message: RealtimeMessage) => void;
const clients = new Map<string, Set<Writer>>();

export function subscribeUser(userId: string, write: Writer) {
  let set = clients.get(userId);
  if (!set) clients.set(userId, (set = new Set()));
  set.add(write);
  return () => {
    set.delete(write);
    if (set.size === 0) clients.delete(userId);
  };
}

/** Consegna ai dispositivi collegati a questo processo. */
export function dispatchLocal(message: RealtimeMessage) {
  for (const userId of message.users)
    for (const write of clients.get(userId) ?? [])
      try {
        write(message);
      } catch {
        // una connessione chiusa si pulisce da sola
      }
}

const CHANNEL = 'tripshare:realtime';

export interface Realtime {
  publish(message: RealtimeMessage): Promise<void>;
  close(): Promise<void>;
}

export function createRealtime(redis?: Redis): Realtime {
  let sub: Redis | undefined;
  if (redis) {
    sub = redis.duplicate();
    void sub.subscribe(CHANNEL).catch(() => undefined);
    sub.on('message', (_channel, raw) => {
      try {
        dispatchLocal(JSON.parse(raw) as RealtimeMessage);
      } catch {
        // messaggio non valido: ignorato
      }
    });
  }
  const publish = async (message: RealtimeMessage) => {
    if (redis) await redis.publish(CHANNEL, JSON.stringify(message)).catch(() => undefined);
    else dispatchLocal(message);
  };
  const stop = onRecordedEvent((e: RecordedEvent) => {
    void publish({
      tripId: e.tripId,
      kind: e.type,
      eventId: e.eventId,
      entityId: e.entityId,
      data: e.data,
      count: e.count,
      actorUserId: e.actorUserId,
      actorName: e.actorName,
      users: e.members,
      notify: e.recipients,
    });
  });
  return {
    publish,
    async close() {
      stop();
      await sub?.quit().catch(() => undefined);
    },
  };
}

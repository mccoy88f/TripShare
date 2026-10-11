import type { Redis } from 'ioredis';
import { onRecordedEvent, type EventData, type RecordedEvent } from './events.js';

/**
 * Aggiornamenti in tempo reale: ogni modifica a un viaggio arriva subito ai dispositivi aperti dei
 * suoi membri (Server-Sent Events). Con Redis i messaggi passano da un canale comune, così
 * funziona anche con più istanze dell'API; senza, restano nel processo.
 */
interface RealtimeMessage {
  tripId: string;
  /** Tipo dell'evento (es. "expense.created") o "packing" per le spunte. */
  kind: string;
  eventId?: string;
  entityId?: string | null;
  data?: EventData;
  count?: number;
  actorUserId: string;
  actorName?: string | null;
  actor?: RecordedEvent['actor'];
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
function dispatchLocal(message: RealtimeMessage) {
  for (const userId of message.users)
    for (const write of clients.get(userId) ?? [])
      try {
        write(message);
      } catch {
        // una connessione chiusa si pulisce da sola
      }
}

const CHANNEL = 'tripshare:realtime';
const AI_CHANNEL = 'tripshare:ai';

/**
 * Avanzamento di un lavoro AI per chi lo ha richiesto: `done` ed `error` chiudono l'attesa senza
 * dover chiedere ogni tanto al server; `delta` porta il testo della risposta man mano che arriva.
 */
export interface AiEvent {
  userId: string;
  jobId: string;
  phase: 'done' | 'error' | 'delta';
  /** Solo per `error`: codice dell'errore. */
  error?: string;
  /** Solo per `delta`: testo della risposta scritto finora (sostituisce quello precedente). */
  text?: string;
}

type AiWriter = (event: AiEvent) => void;
const aiClients = new Map<string, Set<AiWriter>>();

export function subscribeUserAi(userId: string, write: AiWriter) {
  let set = aiClients.get(userId);
  if (!set) aiClients.set(userId, (set = new Set()));
  set.add(write);
  return () => {
    set.delete(write);
    if (set.size === 0) aiClients.delete(userId);
  };
}

/** Consegna un evento AI ai dispositivi collegati a questo processo. */
export function dispatchAiLocal(event: AiEvent) {
  for (const write of aiClients.get(event.userId) ?? [])
    try {
      write(event);
    } catch {
      // una connessione chiusa si pulisce da sola
    }
}

/** Pubblica gli eventi AI dal worker: con Redis arrivano a qualunque istanza dell'API. */
export function createAiEmitter(redis?: Redis): (event: AiEvent) => void {
  return (event) => {
    if (redis) void redis.publish(AI_CHANNEL, JSON.stringify(event)).catch(() => undefined);
    else dispatchAiLocal(event);
  };
}

interface Realtime {
  publish(message: RealtimeMessage): Promise<void>;
  close(): Promise<void>;
}

export function createRealtime(redis?: Redis): Realtime {
  let sub: Redis | undefined;
  if (redis) {
    sub = redis.duplicate();
    void sub.subscribe(CHANNEL, AI_CHANNEL).catch(() => undefined);
    sub.on('message', (channel, raw) => {
      try {
        if (channel === AI_CHANNEL) dispatchAiLocal(JSON.parse(raw) as AiEvent);
        else dispatchLocal(JSON.parse(raw) as RealtimeMessage);
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
      actor: e.actor,
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

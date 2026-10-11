/**
 * Eventi sui lavori AI arrivati dal flusso in tempo reale: la fine di un lavoro (così non serve
 * chiedere ogni tanto al server) e il testo della risposta della chat mentre viene scritta.
 */
export interface AiEventMessage {
  jobId: string;
  phase: 'done' | 'error' | 'delta';
  error?: string;
  text?: string;
}

/** Eventi di fine lavoro: se arrivano prima che qualcuno li aspetti non si perdono. */
const finished = new Map<string, number>();
const waiters = new Map<string, Set<() => void>>();
const deltaListeners = new Set<(event: AiEventMessage) => void>();
let connected = false;

export const setAiConnected = (value: boolean) => {
  connected = value;
};
/** Il flusso in tempo reale è attivo: i controlli periodici servono solo da rete di sicurezza. */
export const aiConnected = () => connected;

export function pushAiEvent(event: AiEventMessage) {
  if (event.phase === 'delta') {
    for (const listener of deltaListeners) listener(event);
    return;
  }
  const now = Date.now();
  finished.set(event.jobId, now);
  for (const [id, at] of finished) if (now - at > 60_000) finished.delete(id);
  const waiting = waiters.get(event.jobId);
  if (!waiting) return;
  // Chi aspettava è stato avvisato: l'evento non serve più.
  finished.delete(event.jobId);
  for (const wake of [...waiting]) wake();
}

/** Attende la fine del lavoro (o `ms` millisecondi, se prima non arriva nulla). */
export function waitForAiEvent(jobId: string, ms: number): Promise<void> {
  if (finished.delete(jobId)) return Promise.resolve();
  return new Promise((resolve) => {
    let set = waiters.get(jobId);
    if (!set) waiters.set(jobId, (set = new Set()));
    const done = () => {
      clearTimeout(timer);
      set.delete(done);
      if (set.size === 0) waiters.delete(jobId);
      resolve();
    };
    const timer = setTimeout(done, ms);
    set.add(done);
  });
}

export function onAiDelta(jobId: string, callback: (text: string) => void) {
  const listener = (event: AiEventMessage) => {
    if (event.jobId === jobId && event.text !== undefined) callback(event.text);
  };
  deltaListeners.add(listener);
  return () => void deltaListeners.delete(listener);
}

import { dispatchAiLocal } from '../services/realtime.js';
import type { AppServices } from '../trpc/init.js';
import type { AiDeps } from './jobs.js';

/** Dipendenze dei lavori AI a partire dai servizi dell'API. */
export function aiDeps(services: AppServices): AiDeps {
  const queue = services.aiQueue;
  return {
    db: services.db,
    settings: services.settings,
    storage: services.storage,
    encryptionKey: services.env.ENCRYPTION_KEY,
    appUrl: services.env.APP_URL,
    appName: services.env.APP_NAME,
    searxngUrl: services.env.SEARXNG_URL,
    httpFetch: services.httpFetch,
    enqueue: queue
      ? async (jobId) => {
          await queue.add('run', { jobId }, { removeOnComplete: 1000, removeOnFail: 1000 });
        }
      : undefined,
    // Senza worker il lavoro gira nel processo dell'API, che ha già i dispositivi collegati.
    emit: queue ? undefined : dispatchAiLocal,
    log: (msg) => console.warn(msg),
  };
}

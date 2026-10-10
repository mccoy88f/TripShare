import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { createDb, runMigrations } from '@tripshare/db';
import { AI_QUEUE } from './ai/jobs.js';
import { MEDIA_QUEUE } from './services/memories.js';
import { pruneEvents } from './services/events.js';
import { ensureVapid, NOTIFY_QUEUE } from './services/push.js';
import { createAuth } from './auth.js';
import { bootstrap } from './bootstrap.js';
import {
  EMAIL_QUEUE,
  createDirectEmailSender,
  createQueuedEmailSender,
  type EmailJob,
} from './email/index.js';
import { envWarnings, loadEnv } from './env.js';
import { buildServer } from './server.js';
import { SettingsService } from './settings.js';
import { FileStorage } from './storage.js';

const env = loadEnv();
const logger =
  env.NODE_ENV === 'development'
    ? { level: 'info', transport: { target: 'pino-pretty' } }
    : { level: process.env.LOG_LEVEL ?? 'info' };

if (process.env.SKIP_MIGRATIONS !== 'true') await runMigrations(env.DATABASE_URL);

const { db, close } = createDb(env.DATABASE_URL);
const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
const emailQueue = new Queue<EmailJob>(EMAIL_QUEUE, { connection: redis });
const email = createQueuedEmailSender(emailQueue);
const aiQueue = new Queue<{ jobId: string }>(AI_QUEUE, { connection: redis });
const notifyQueue = new Queue<{ eventId: string }>(NOTIFY_QUEUE, { connection: redis });
const mediaQueue = new Queue<{ memoryId: string }>(MEDIA_QUEUE, { connection: redis });
const direct = createDirectEmailSender(env);
const settings = new SettingsService(db, env.ENCRYPTION_KEY);
const auth = createAuth({ env, db, settings, email });
// Le chiavi per le notifiche push si creano subito, una volta sola.
await ensureVapid(settings);
const storage = new FileStorage(env.UPLOADS_DIR);
await storage.init();

const app = await buildServer(
  {
    env,
    db,
    auth,
    settings,
    email,
    redis,
    emailQueue,
    aiQueue,
    notifyQueue,
    mediaQueue,
    sendDirect: direct.send,
    storage,
    verifySmtp: async () => {
      await direct.transport.verify();
    },
  },
  { logger },
);

for (const warning of envWarnings(env)) app.log.warn(warning);

direct.transport.verify().then(
  () => app.log.info(`SMTP pronto (${env.smtp.host}:${env.smtp.port}), mittente ${env.smtp.from}`),
  (err: Error) => app.log.error(`SMTP non raggiungibile: ${err.message}`),
);

await bootstrap({ env, db, auth, settings, log: app.log });

// Il registro delle modifiche tiene 90 giorni: la pulizia gira all'avvio e poi ogni 6 ore.
const prune = () =>
  pruneEvents(db).catch((err: unknown) => app.log.warn(`[events] pulizia: ${String(err)}`));
void prune();
const pruneTimer = setInterval(() => void prune(), 6 * 3600 * 1000);

const shutdown = async () => {
  clearInterval(pruneTimer);
  await app.close();
  await emailQueue.close();
  await aiQueue.close();
  await notifyQueue.close();
  await mediaQueue.close();
  redis.disconnect();
  await close();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

await app.listen({ port: env.PORT, host: env.HOST });

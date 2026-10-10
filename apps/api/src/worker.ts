import { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { createDb } from '@tripshare/db';
import { AI_QUEUE, processAiJob } from './ai/jobs.js';
import { EMAIL_QUEUE, createDirectEmailSender, type EmailJob } from './email/index.js';
import { envWarnings, loadEnv } from './env.js';
import { createWebPushSender, NOTIFY_QUEUE, sendEventPush } from './services/push.js';
import { SettingsService } from './settings.js';
import { FileStorage } from './storage.js';

// Worker per i lavori in background: invio delle email e lavori AI (scontrini, prenotazioni,
// generazione dei viaggi, assistente…), così le richieste lunghe non bloccano l'API.
const env = loadEnv();
const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
const sender = createDirectEmailSender(env);
const { db, close } = createDb(env.DATABASE_URL);
const storage = new FileStorage(env.UPLOADS_DIR);
await storage.init();

const emailWorker = new Worker<EmailJob>(
  EMAIL_QUEUE,
  async (job) => {
    await sender.send(job.data);
    return { to: job.data.to, kind: job.data.template.kind };
  },
  { connection, concurrency: 4 },
);

emailWorker.on('completed', (job) =>
  console.log(`[email] inviata ${job.data.template.kind} a ${job.data.to}`),
);
emailWorker.on('failed', (job, err) =>
  console.error(
    `[email] errore ${job?.data.template.kind} a ${job?.data.to} (tentativo ${job?.attemptsMade}): ${err.message}`,
  ),
);

const aiWorker = new Worker<{ jobId: string }>(
  AI_QUEUE,
  async (job) => {
    // Le impostazioni possono cambiare dal pannello admin: si rileggono a ogni lavoro.
    const fresh = new SettingsService(db, env.ENCRYPTION_KEY);
    await processAiJob(
      {
        db,
        settings: fresh,
        storage,
        encryptionKey: env.ENCRYPTION_KEY,
        appUrl: env.APP_URL,
        appName: env.APP_NAME,
        log: (msg) => console.warn(msg),
      },
      job.data.jobId,
    );
  },
  { connection, concurrency: 4 },
);
aiWorker.on('failed', (job, err) =>
  console.error(`[ai] lavoro ${job?.data.jobId} non riuscito: ${err.message}`),
);

// Notifiche push dei viaggi: il testo si compone qui, nella lingua di ogni destinatario.
const notifyWorker = new Worker<{ eventId: string }>(
  NOTIFY_QUEUE,
  async (job) => {
    const fresh = new SettingsService(db, env.ENCRYPTION_KEY);
    const sender = createWebPushSender(
      fresh,
      `mailto:${env.SUPERADMIN_EMAIL ?? 'admin@localhost'}`,
    );
    return sendEventPush({ db, sender, log: (msg) => console.warn(msg) }, job.data.eventId);
  },
  { connection, concurrency: 4 },
);
notifyWorker.on('failed', (job, err) =>
  console.error(`[push] evento ${job?.data.eventId} non inviato: ${err.message}`),
);

for (const warning of envWarnings(env)) console.warn(`[config] ${warning}`);
console.log(`Worker avviato, SMTP ${env.smtp.host}:${env.smtp.port}`);

const shutdown = async () => {
  await emailWorker.close();
  await aiWorker.close();
  await notifyWorker.close();
  connection.disconnect();
  await close();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

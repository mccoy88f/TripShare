import { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { EMAIL_QUEUE, createDirectEmailSender, type EmailJob } from './email/index.js';
import { envWarnings, loadEnv } from './env.js';

// Worker per i lavori in background. Per ora gestisce l'invio delle email; nelle fasi successive
// si aggiungono le code per AI, immagini, notifiche push ed export.
const env = loadEnv();
const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
const sender = createDirectEmailSender(env);

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

for (const warning of envWarnings(env)) console.warn(`[config] ${warning}`);
console.log(`Worker avviato, SMTP ${env.smtp.host}:${env.smtp.port}`);

const shutdown = async () => {
  await emailWorker.close();
  connection.disconnect();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

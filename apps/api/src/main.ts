import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { createDb, runMigrations } from '@tripshare/db';
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
const direct = createDirectEmailSender(env);
const settings = new SettingsService(db, env.ENCRYPTION_KEY);
const auth = createAuth({ env, db, settings, email });

const app = await buildServer(
  {
    env,
    db,
    auth,
    settings,
    email,
    redis,
    emailQueue,
    sendDirect: direct.send,
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

const shutdown = async () => {
  await app.close();
  await emailQueue.close();
  redis.disconnect();
  await close();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

await app.listen({ port: env.PORT, host: env.HOST });

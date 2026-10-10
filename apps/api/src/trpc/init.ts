import { initTRPC, TRPCError } from '@trpc/server';
import type { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import type { Database } from '@tripshare/db';
import type { Auth, AuthSession } from '../auth.js';
import type { EmailJob, EmailSender } from '../email/index.js';
import type { Env } from '../env.js';
import type { SettingsService } from '../settings.js';
import type { FileStorage } from '../storage.js';

export interface AppServices {
  env: Env;
  db: Database;
  auth: Auth;
  settings: SettingsService;
  email: EmailSender;
  redis?: Redis;
  emailQueue?: Queue<EmailJob>;
  /** Invio diretto, senza coda, per l'email di prova del pannello. */
  sendDirect?: (job: EmailJob) => Promise<void>;
  verifySmtp?: () => Promise<void>;
  storage?: FileStorage;
  /** fetch per le chiamate esterne (OpenRouter), sostituibile nei test. */
  httpFetch?: typeof fetch;
  /** Coda dei lavori AI (eseguiti dal worker). Senza coda girano nel processo dell'API. */
  aiQueue?: Queue<{ jobId: string }>;
  /** Coda dei messaggi push (inviati dal worker). Senza coda e senza mittente non si inviano. */
  notifyQueue?: Queue<{ eventId: string }>;
  /** Mittente delle notifiche push, sostituibile nei test. */
  pushSender?: (
    target: { endpoint: string; p256dh: string; auth: string },
    payload: { title: string; body: string; url: string; tag: string },
  ) => Promise<void>;
  /** Nei test: esegue i lavori AI in modo sincrono. */
  aiWait?: boolean;
  /** Tasso di cambio (iniettabile nei test). */
  fxRate?: (from: string, to: string, date?: string) => Promise<{ rate: number; date: string }>;
}

export interface Context extends AppServices {
  session: AuthSession | null;
  ip?: string;
}

const t = initTRPC.context<Context>().create();

export const router = t.router;
export const publicProcedure = t.procedure;

export const authedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.session) throw new TRPCError({ code: 'UNAUTHORIZED' });
  return next({ ctx: { ...ctx, session: ctx.session, user: ctx.session.user } });
});

export const superadminProcedure = authedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== 'superadmin') throw new TRPCError({ code: 'FORBIDDEN' });
  return next();
});

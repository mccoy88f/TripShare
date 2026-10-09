import { initTRPC, TRPCError } from '@trpc/server';
import type { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import type { Database } from '@tripshare/db';
import type { Auth, AuthSession } from '../auth.js';
import type { EmailJob, EmailSender } from '../email/index.js';
import type { Env } from '../env.js';
import type { SettingsService } from '../settings.js';

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

import { count, desc, eq, gte, ilike, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { aiJob, auditLog, user } from '@tripshare/db';
import { TRPCError } from '@trpc/server';
import { checkGeminiKey, clearGeminiCache, listGeminiModels } from '../gemini.js';
import { checkKey, clearModelsCache, listModels } from '../openrouter.js';
import { SETTINGS, isSettingKey, type SettingKey } from '../settings.js';
import { router, superadminProcedure } from '../trpc/init.js';
import type { Context } from '../trpc/init.js';

async function audit(
  ctx: Context,
  action: string,
  data?: Record<string, unknown>,
  target?: { type: string; id: string },
) {
  await ctx.db.insert(auditLog).values({
    actorId: ctx.session?.user.id ?? null,
    action,
    targetType: target?.type,
    targetId: target?.id,
    data: data ?? null,
    ip: ctx.ip,
  });
}

async function check(
  fn: () => Promise<unknown>,
): Promise<{ ok: boolean; error?: string; ms: number }> {
  const start = performance.now();
  try {
    await fn();
    return { ok: true, ms: Math.round(performance.now() - start) };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      ms: Math.round(performance.now() - start),
    };
  }
}

export const adminRouter = router({
  settings: router({
    list: superadminProcedure.query(({ ctx }) => ctx.settings.listForAdmin()),

    update: superadminProcedure
      .input(z.object({ key: z.string(), value: z.unknown() }))
      .mutation(async ({ ctx, input }) => {
        if (!isSettingKey(input.key))
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'UNKNOWN_SETTING' });
        const key: SettingKey = input.key;
        const parsed = SETTINGS[key].schema.safeParse(input.value);
        if (!parsed.success) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: parsed.error.issues[0]?.message ?? 'INVALID_VALUE',
          });
        }
        await ctx.settings.set(key, parsed.data as never, ctx.session!.user.id);
        if (key === 'openrouter.apiKey') clearModelsCache();
        if (key === 'gemini.apiKey') clearGeminiCache();
        await audit(ctx, 'settings.update', {
          key,
          value: SETTINGS[key].secret ? '[secret]' : parsed.data,
        });
        return { ok: true };
      }),
  }),

  gemini: router({
    /** Modelli disponibili per la chiave Gemini configurata. */
    models: superadminProcedure
      .input(z.object({ refresh: z.boolean().optional() }).optional())
      .query(async ({ ctx, input }) => {
        const key = await ctx.settings.get('gemini.apiKey');
        try {
          return await listGeminiModels(key, ctx.httpFetch, input?.refresh);
        } catch (err) {
          throw new TRPCError({
            code: 'BAD_GATEWAY',
            message: err instanceof Error ? err.message : 'GEMINI_UNAVAILABLE',
          });
        }
      }),

    checkKey: superadminProcedure.mutation(async ({ ctx }) => {
      const key = await ctx.settings.get('gemini.apiKey');
      if (!key) throw new TRPCError({ code: 'BAD_REQUEST', message: 'GEMINI_NO_KEY' });
      try {
        return await checkGeminiKey(key, ctx.httpFetch);
      } catch (err) {
        throw new TRPCError({
          code: 'BAD_GATEWAY',
          message: err instanceof Error ? err.message : 'GEMINI_UNAVAILABLE',
        });
      }
    }),
  }),

  /** Uso dell'AI nel mese corrente, per utente e per provider. */
  aiUsage: superadminProcedure.query(async ({ ctx }) => {
    const start = new Date();
    start.setUTCDate(1);
    start.setUTCHours(0, 0, 0, 0);
    const rows = await ctx.db
      .select({
        userId: aiJob.userId,
        name: user.name,
        email: user.email,
        provider: aiJob.provider,
        keySource: aiJob.keySource,
        requests: count(),
        errors: sql<number>`count(*) filter (where ${aiJob.status} = 'error')`,
        tokens: sql<number>`coalesce(sum(${aiJob.promptTokens}), 0) + coalesce(sum(${aiJob.completionTokens}), 0)`,
        cost: sql<number>`coalesce(sum(${aiJob.cost}), 0)`,
      })
      .from(aiJob)
      .innerJoin(user, eq(user.id, aiJob.userId))
      .where(gte(aiJob.createdAt, start))
      .groupBy(aiJob.userId, user.name, user.email, aiJob.provider, aiJob.keySource)
      .orderBy(desc(count()));
    return rows.map((r) => ({
      ...r,
      errors: Number(r.errors),
      tokens: Number(r.tokens),
      cost: Number(r.cost),
    }));
  }),

  openrouter: router({
    /** Modelli disponibili su OpenRouter, con prezzi e tipo di input. */
    models: superadminProcedure
      .input(z.object({ refresh: z.boolean().optional() }).optional())
      .query(async ({ ctx, input }) => {
        const key = await ctx.settings.get('openrouter.apiKey');
        try {
          return await listModels(key, ctx.httpFetch, input?.refresh);
        } catch (err) {
          throw new TRPCError({
            code: 'BAD_GATEWAY',
            message: err instanceof Error ? err.message : 'OPENROUTER_UNAVAILABLE',
          });
        }
      }),

    checkKey: superadminProcedure.mutation(async ({ ctx }) => {
      const key = await ctx.settings.get('openrouter.apiKey');
      if (!key) throw new TRPCError({ code: 'BAD_REQUEST', message: 'OPENROUTER_NO_KEY' });
      try {
        return await checkKey(key, ctx.httpFetch);
      } catch (err) {
        throw new TRPCError({
          code: 'BAD_GATEWAY',
          message: err instanceof Error ? err.message : 'OPENROUTER_UNAVAILABLE',
        });
      }
    }),
  }),

  users: router({
    list: superadminProcedure
      .input(
        z.object({
          search: z.string().max(100).optional(),
          limit: z.number().int().min(1).max(100).default(25),
          offset: z.number().int().min(0).default(0),
        }),
      )
      .query(async ({ ctx, input }) => {
        const where = input.search
          ? or(ilike(user.email, `%${input.search}%`), ilike(user.name, `%${input.search}%`))
          : undefined;
        const [rows, [total]] = await Promise.all([
          ctx.db
            .select({
              id: user.id,
              name: user.name,
              email: user.email,
              emailVerified: user.emailVerified,
              image: user.image,
              avatarEmoji: user.avatarEmoji,
              role: user.role,
              banned: user.banned,
              locale: user.locale,
              createdAt: user.createdAt,
            })
            .from(user)
            .where(where)
            .orderBy(desc(user.createdAt))
            .limit(input.limit)
            .offset(input.offset),
          ctx.db.select({ value: count() }).from(user).where(where),
        ]);
        return { rows, total: total?.value ?? 0 };
      }),
  }),

  system: router({
    status: superadminProcedure.query(async ({ ctx }) => {
      const [database, redis, smtp] = await Promise.all([
        check(() => ctx.db.execute(sql`select 1`)),
        check(async () => {
          if (!ctx.redis) throw new Error('not configured');
          await ctx.redis.ping();
        }),
        check(async () => {
          if (!ctx.verifySmtp) throw new Error('not configured');
          await ctx.verifySmtp();
        }),
      ]);
      const emailQueue = ctx.emailQueue
        ? await ctx.emailQueue.getJobCounts('waiting', 'active', 'failed', 'delayed')
        : null;
      const [users] = await ctx.db.select({ value: count() }).from(user);
      return {
        services: { database, redis, smtp },
        smtp: {
          host: ctx.env.smtp.host,
          port: ctx.env.smtp.port,
          secure: ctx.env.smtp.secure,
          user: ctx.env.smtp.auth?.user ?? null,
          from: ctx.env.smtp.from,
          fromIsDefault: !ctx.env.SMTP_FROM,
        },
        emailQueue,
        users: users?.value ?? 0,
        version: process.env.APP_VERSION ?? 'dev',
      };
    }),

    sendTestEmail: superadminProcedure
      .input(z.object({ to: z.email().optional() }))
      .mutation(async ({ ctx, input }) => {
        const to = input.to ?? ctx.session!.user.email;
        const job = {
          to,
          locale: ctx.session!.user.locale === 'en' ? 'en' : 'it',
          template: { kind: 'test' },
        } as const;
        try {
          if (ctx.sendDirect) await ctx.sendDirect(job);
          else await ctx.email.send(job);
        } catch (err) {
          throw new TRPCError({
            code: 'BAD_GATEWAY',
            message: err instanceof Error ? err.message : 'SMTP_ERROR',
          });
        }
        await audit(ctx, 'email.test', { to });
        return { ok: true, to };
      }),

    audit: superadminProcedure
      .input(z.object({ limit: z.number().int().min(1).max(200).default(50) }))
      .query(({ ctx, input }) =>
        ctx.db.select().from(auditLog).orderBy(desc(auditLog.createdAt)).limit(input.limit),
      ),
  }),
});

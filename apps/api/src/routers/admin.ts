import { count, desc, eq, gte, ilike, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { aiJob, auditLog, user } from '@tripshare/db';
import { TRPCError } from '@trpc/server';
import { complete } from '../ai/client.js';
import { checkGeminiKey, clearGeminiCache, listGeminiModels } from '../gemini.js';
import { clearGroqCache, listGroqModels } from '../groq.js';
import { checkKey, clearModelsCache, listModels } from '../openrouter.js';
import { clearCooldowns } from '../ai/access.js';
import { maskSecret } from '../crypto.js';
import { AiProfileSchema, SETTINGS, isSettingKey, type SettingKey } from '../settings.js';
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

const PROVIDERS = ['openrouter', 'gemini', 'groq'] as const;

async function savedProfile(ctx: Context, id: string) {
  const profile = (await ctx.settings.get('ai.profiles')).find((p) => p.id === id);
  if (!profile) throw new TRPCError({ code: 'NOT_FOUND', message: 'PROFILE_NOT_FOUND' });
  return profile;
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
        // Le configurazioni AI hanno la loro rotta (le chiavi non tornano mai al client).
        if (key === 'ai.profiles')
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'UNKNOWN_SETTING' });
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

  /** Configurazioni AI centrali (provider, chiave, modello e riserva) in ordine di priorità. */
  aiProfiles: router({
    list: superadminProcedure.query(async ({ ctx }) => {
      const profiles = await ctx.settings.get('ai.profiles');
      const legacyProvider = await ctx.settings.get('ai.provider');
      const legacyKey = await ctx.settings.get(
        legacyProvider === 'gemini' ? 'gemini.apiKey' : 'openrouter.apiKey',
      );
      return {
        profiles: profiles.map(({ apiKey, ...p }) => ({ ...p, keyPreview: maskSecret(apiKey) })),
        // Con l'elenco vuoto valgono ancora le impostazioni storiche: si possono importare.
        legacy: profiles.length === 0 && legacyKey ? { provider: legacyProvider } : null,
      };
    }),

    /**
     * Salva l'elenco nell'ordine ricevuto. Per le configurazioni già esistenti la chiave si può
     * omettere: resta quella salvata.
     */
    save: superadminProcedure
      .input(
        z.object({
          profiles: z
            .array(
              AiProfileSchema.omit({ apiKey: true }).extend({
                apiKey: z.string().min(10).max(300).optional(),
              }),
            )
            .max(12),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const saved = new Map((await ctx.settings.get('ai.profiles')).map((p) => [p.id, p]));
        const next = input.profiles.map((p) => {
          const apiKey = p.apiKey ?? saved.get(p.id)?.apiKey;
          if (!apiKey) throw new TRPCError({ code: 'BAD_REQUEST', message: 'AI_KEY_REQUIRED' });
          return { ...p, apiKey };
        });
        if (new Set(next.map((p) => p.id)).size !== next.length)
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'DUPLICATE_ID' });
        await ctx.settings.set('ai.profiles', next, ctx.session!.user.id);
        clearModelsCache();
        clearGeminiCache();
        clearGroqCache();
        clearCooldowns();
        await audit(ctx, 'settings.update', {
          key: 'ai.profiles',
          value: next.map((p) => ({
            id: p.id,
            name: p.name,
            provider: p.provider,
            model: p.model,
            backupModel: p.backupModel,
            enabled: p.enabled,
          })),
        });
        return { ok: true };
      }),

    /** Crea la prima configurazione dalle impostazioni storiche (provider, chiave e modello). */
    importLegacy: superadminProcedure.mutation(async ({ ctx }) => {
      if ((await ctx.settings.get('ai.profiles')).length > 0) return { ok: true };
      const provider = await ctx.settings.get('ai.provider');
      const gemini = provider === 'gemini';
      const apiKey = await ctx.settings.get(gemini ? 'gemini.apiKey' : 'openrouter.apiKey');
      if (!apiKey) throw new TRPCError({ code: 'BAD_REQUEST', message: 'AI_NOT_CONFIGURED' });
      const models = await ctx.settings.get(gemini ? 'gemini.models' : 'openrouter.models');
      await ctx.settings.set(
        'ai.profiles',
        [
          {
            id: 'principale',
            name: gemini ? 'Gemini' : 'OpenRouter',
            provider,
            apiKey,
            model: models.planner,
            backupModel: models.fallbacks[0] ?? null,
            enabled: true,
          },
        ],
        ctx.session!.user.id,
      );
      return { ok: true };
    }),

    /** Modelli disponibili per il provider e la chiave di una configurazione salvata. */
    models: superadminProcedure
      .input(z.object({ id: z.string(), refresh: z.boolean().optional() }))
      .query(async ({ ctx, input }) => {
        const profile = await savedProfile(ctx, input.id);
        try {
          if (profile.provider === 'groq')
            return await listGroqModels(profile.apiKey, ctx.httpFetch, input.refresh);
          return profile.provider === 'gemini'
            ? await listGeminiModels(profile.apiKey, ctx.httpFetch, input.refresh)
            : await listModels(profile.apiKey, ctx.httpFetch, input.refresh);
        } catch (err) {
          throw new TRPCError({
            code: 'BAD_GATEWAY',
            message: err instanceof Error ? err.message : 'AI_UNAVAILABLE',
          });
        }
      }),

    /**
     * Verifica una chiave prima di aggiungerla: se il provider la accetta restituisce l'elenco
     * dei modelli disponibili, da cui scegliere il modello e la riserva.
     */
    verify: superadminProcedure
      .input(z.object({ provider: z.enum(PROVIDERS), apiKey: z.string().min(10).max(300) }))
      .mutation(async ({ ctx, input }) => {
        try {
          if (input.provider === 'groq')
            return await listGroqModels(input.apiKey, ctx.httpFetch, true);
          if (input.provider === 'gemini')
            return await listGeminiModels(input.apiKey, ctx.httpFetch, true);
          // OpenRouter elenca i modelli anche senza chiave: la chiave si controlla a parte.
          await checkKey(input.apiKey, ctx.httpFetch);
          return await listModels(input.apiKey, ctx.httpFetch, true);
        } catch (err) {
          throw new TRPCError({
            code: 'BAD_GATEWAY',
            message: err instanceof Error ? err.message : 'AI_UNAVAILABLE',
          });
        }
      }),

    /**
     * Prova reale di un modello (senza riserva): una piccola richiesta JSON. Per le
     * configurazioni già salvate la chiave si può omettere.
     */
    test: superadminProcedure
      .input(
        z.object({
          id: z.string().optional(),
          provider: z.enum(PROVIDERS),
          apiKey: z.string().min(10).max(300).optional(),
          model: z.string().min(1).max(200),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const apiKey =
          input.apiKey ?? (input.id ? (await savedProfile(ctx, input.id)).apiKey : null);
        if (!apiKey) throw new TRPCError({ code: 'BAD_REQUEST', message: 'AI_KEY_REQUIRED' });
        const start = performance.now();
        try {
          const res = await complete({
            provider: input.provider,
            apiKey,
            model: input.model,
            fallbacks: [],
            messages: [
              {
                role: 'system',
                content: 'Rispondi solo con JSON: {"ok": true, "saluto": "<una parola>"}',
              },
              { role: 'user', content: 'Prova di connessione da TripShare.' },
            ],
            jsonSchema: { name: 'tripshare_test', schema: { type: 'object' } },
            appUrl: ctx.env.APP_URL,
            appName: ctx.env.APP_NAME,
            fetchImpl: ctx.httpFetch,
            timeoutMs: 60_000,
          });
          return {
            ok: true as const,
            model: res.model,
            ms: Math.round(performance.now() - start),
            content: res.content.slice(0, 300),
          };
        } catch (err) {
          return {
            ok: false as const,
            model: input.model,
            ms: Math.round(performance.now() - start),
            error: err instanceof Error ? err.message : String(err),
          };
        }
      }),
  }),

  /** Ultimi errori dei lavori AI, per capire cosa non va. */
  aiErrors: superadminProcedure.query(async ({ ctx }) =>
    ctx.db
      .select({
        id: aiJob.id,
        kind: aiJob.kind,
        provider: aiJob.provider,
        model: aiJob.model,
        error: aiJob.error,
        attempts: aiJob.attempts,
        createdAt: aiJob.createdAt,
      })
      .from(aiJob)
      .where(eq(aiJob.status, 'error'))
      .orderBy(desc(aiJob.createdAt))
      .limit(10),
  ),

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

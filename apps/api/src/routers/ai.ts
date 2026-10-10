import { TRPCError } from '@trpc/server';
import { and, desc, eq, gte, isNull, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { aiChatMessage, aiConversation, aiJob, trip, userSecret } from '@tripshare/db';
import { AI_PROVIDERS, monthlyCentralUsage, userKeys } from '../ai/access.js';
import { aiDeps } from '../ai/deps.js';
import { initialState, type GenerationState } from '../ai/generation.js';
import { AiJobError, chatHistory, startAiJob } from '../ai/jobs.js';
import { AiInputSchema } from '../ai/tasks.js';
import { encrypt, maskSecret } from '../crypto.js';
import { checkGeminiKey } from '../gemini.js';
import { checkKey } from '../openrouter.js';
import { requireMember } from '../services/trips.js';
import { authedProcedure, router } from '../trpc/init.js';

/** Ruolo minimo nel viaggio per ogni compito AI. */
const MIN_ROLE = {
  receipt: 'editor',
  booking: 'editor',
  generate: 'editor',
  generateTrip: 'owner',
  refine: 'editor',
  verify: 'editor',
  placePhoto: 'editor',
  packing: 'editor',
  schedule: 'editor',
  document: 'editor',
  chat: 'viewer',
} as const;

export const aiRouter = router({
  /** Stato dell'AI per l'utente: modalità, chiavi personali e consumo della quota centrale. */
  status: authedProcedure.query(async ({ ctx }) => {
    const s = ctx.settings;
    const [mode, provider, orKey, gKey, quotaUsd, quotaRequests, keys, usage] = await Promise.all([
      s.get('openrouter.mode'),
      s.get('ai.provider'),
      s.get('openrouter.apiKey'),
      s.get('gemini.apiKey'),
      s.get('openrouter.monthlyQuotaUsd'),
      s.get('ai.monthlyRequests'),
      userKeys(ctx.db, ctx.env.ENCRYPTION_KEY, ctx.user.id),
      monthlyCentralUsage(ctx.db, ctx.user.id),
    ]);
    const centralReady = !!(provider === 'gemini' ? gKey : orKey);
    const hasOwn = !!(keys.openrouter || keys.gemini);
    return {
      mode,
      centralProvider: provider,
      centralReady: mode !== 'per_user' && centralReady,
      available: hasOwn && mode !== 'central' ? true : mode !== 'per_user' && centralReady,
      keys: {
        openrouter: keys.openrouter ? maskSecret(keys.openrouter) : null,
        gemini: keys.gemini ? maskSecret(keys.gemini) : null,
      },
      preferred: keys.preferred,
      usage: { ...usage, quotaUsd, quotaRequests },
    };
  }),

  /** Salva (dopo averla verificata) o rimuove una chiave personale. */
  setKey: authedProcedure
    .input(
      z.object({
        provider: z.enum(AI_PROVIDERS),
        key: z.string().trim().min(10).max(300).nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if ((await ctx.settings.get('openrouter.mode')) === 'central')
        throw new TRPCError({ code: 'FORBIDDEN', message: 'AI_OWN_KEYS_DISABLED' });
      if (input.key) {
        try {
          if (input.provider === 'gemini') await checkGeminiKey(input.key, ctx.httpFetch);
          else await checkKey(input.key, ctx.httpFetch);
        } catch {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'AI_INVALID_KEY' });
        }
      }
      const value = input.key ? encrypt(input.key, ctx.env.ENCRYPTION_KEY) : null;
      const column = input.provider === 'gemini' ? 'geminiKey' : 'openrouterKey';
      await ctx.db
        .insert(userSecret)
        .values({ userId: ctx.user.id, [column]: value, aiProvider: input.provider })
        .onConflictDoUpdate({
          target: userSecret.userId,
          set: {
            [column]: value,
            ...(input.key ? { aiProvider: input.provider } : {}),
            updatedAt: new Date(),
          },
        });
      return { ok: true };
    }),

  setPreferred: authedProcedure
    .input(z.object({ provider: z.enum(AI_PROVIDERS) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .insert(userSecret)
        .values({ userId: ctx.user.id, aiProvider: input.provider })
        .onConflictDoUpdate({
          target: userSecret.userId,
          set: { aiProvider: input.provider, updatedAt: new Date() },
        });
      return { ok: true };
    }),

  /** Avvia un lavoro AI; il risultato si legge con `job`. */
  start: authedProcedure
    .input(z.object({ tripId: z.uuid().nullable(), input: AiInputSchema }))
    .mutation(async ({ ctx, input }) => {
      if (input.tripId) {
        await requireMember(ctx.db, input.tripId, ctx.user.id, MIN_ROLE[input.input.kind]);
      } else if (input.input.kind !== 'generate') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'TRIP_REQUIRED' });
      }
      let job = input.input;
      if (job.kind === 'generateTrip' && input.tripId) {
        const [row] = await ctx.db
          .select({ generation: trip.generation, updatedAt: trip.updatedAt })
          .from(trip)
          .where(eq(trip.id, input.tripId));
        const current = row?.generation as GenerationState | null;
        // Una generazione in corso (non ferma da più di 4 minuti) non si avvia due volte.
        if (current?.status === 'running' && Date.now() - row!.updatedAt.getTime() < 4 * 60_000)
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'GENERATION_RUNNING' });
        await ctx.db
          .update(trip)
          .set({
            generation: initialState(job.from ?? 'strategy', current ?? undefined, {
              until: job.until,
              keep: job.keep,
              skip: job.skip,
            }),
          })
          .where(eq(trip.id, input.tripId));
      }
      if (job.kind === 'chat' && input.tripId) {
        // Ogni messaggio appartiene a una conversazione: se manca se ne apre una nuova.
        let conversationId = job.conversationId;
        if (conversationId) {
          const [own] = await ctx.db
            .select({ id: aiConversation.id })
            .from(aiConversation)
            .where(
              and(
                eq(aiConversation.id, conversationId),
                eq(aiConversation.tripId, input.tripId),
                eq(aiConversation.userId, ctx.user.id),
              ),
            );
          if (!own) throw new TRPCError({ code: 'NOT_FOUND', message: 'CONVERSATION_NOT_FOUND' });
        } else {
          const title = job.message.replace(/\s+/g, ' ').trim().slice(0, 60);
          const [created] = await ctx.db
            .insert(aiConversation)
            .values({ tripId: input.tripId, userId: ctx.user.id, title })
            .returning({ id: aiConversation.id });
          conversationId = created!.id;
        }
        job = { ...job, conversationId };
      }
      try {
        const started = await startAiJob(aiDeps(ctx), ctx.user.id, input.tripId, job, {
          wait: ctx.aiWait,
        });
        return {
          ...started,
          conversationId: job.kind === 'chat' ? (job.conversationId ?? null) : null,
        };
      } catch (err) {
        if (err instanceof AiJobError)
          throw new TRPCError({ code: 'BAD_REQUEST', message: err.message });
        throw err;
      }
    }),

  job: authedProcedure.input(z.object({ id: z.uuid() })).query(async ({ ctx, input }) => {
    const [job] = await ctx.db
      .select({
        id: aiJob.id,
        kind: aiJob.kind,
        status: aiJob.status,
        result: aiJob.result,
        error: aiJob.error,
        model: aiJob.model,
        provider: aiJob.provider,
      })
      .from(aiJob)
      .where(and(eq(aiJob.id, input.id), eq(aiJob.userId, ctx.user.id)));
    if (!job) throw new TRPCError({ code: 'NOT_FOUND' });
    return job;
  }),

  /** Avanzamento della generazione a fasi di un viaggio. */
  generation: router({
    state: authedProcedure.input(z.object({ tripId: z.uuid() })).query(async ({ ctx, input }) => {
      await requireMember(ctx.db, input.tripId, ctx.user.id);
      const [row] = await ctx.db
        .select({ generation: trip.generation })
        .from(trip)
        .where(eq(trip.id, input.tripId));
      const state = (row?.generation ?? null) as GenerationState | null;
      return state ? { ...state, strategy: undefined } : null;
    }),
    /** Chiude il riepilogo della generazione (non si mostra più). */
    dismiss: authedProcedure
      .input(z.object({ tripId: z.uuid() }))
      .mutation(async ({ ctx, input }) => {
        await requireMember(ctx.db, input.tripId, ctx.user.id, 'editor');
        await ctx.db
          .update(trip)
          .set({
            generation: sql`case when ${trip.generation} is null then null else jsonb_set(${trip.generation}, '{dismissed}', 'true'::jsonb) end`,
          })
          .where(eq(trip.id, input.tripId));
        return { ok: true };
      }),
  }),

  chat: router({
    /** Conversazioni dell'utente nel viaggio (la più recente per prima). */
    conversations: authedProcedure
      .input(z.object({ tripId: z.uuid() }))
      .query(async ({ ctx, input }) => {
        await requireMember(ctx.db, input.tripId, ctx.user.id);
        return ctx.db
          .select()
          .from(aiConversation)
          .where(
            and(eq(aiConversation.tripId, input.tripId), eq(aiConversation.userId, ctx.user.id)),
          )
          .orderBy(desc(aiConversation.updatedAt));
      }),

    history: authedProcedure
      .input(z.object({ tripId: z.uuid(), conversationId: z.uuid() }))
      .query(async ({ ctx, input }) => {
        await requireMember(ctx.db, input.tripId, ctx.user.id);
        return chatHistory(ctx.db, input.tripId, ctx.user.id, input.conversationId);
      }),

    /** Elimina una conversazione con tutti i suoi messaggi. */
    remove: authedProcedure
      .input(z.object({ tripId: z.uuid(), conversationId: z.uuid() }))
      .mutation(async ({ ctx, input }) => {
        await requireMember(ctx.db, input.tripId, ctx.user.id);
        await ctx.db
          .delete(aiConversation)
          .where(
            and(
              eq(aiConversation.id, input.conversationId),
              eq(aiConversation.tripId, input.tripId),
              eq(aiConversation.userId, ctx.user.id),
            ),
          );
        return { ok: true };
      }),

    /**
     * "Ripeti": toglie dalla conversazione un messaggio e tutto ciò che viene dopo. Per un
     * messaggio dell'assistente si riparte dalla domanda che lo precede. Restituisce il testo
     * della domanda, da rimandare.
     */
    retry: authedProcedure
      .input(z.object({ tripId: z.uuid(), conversationId: z.uuid(), messageId: z.uuid() }))
      .mutation(async ({ ctx, input }) => {
        await requireMember(ctx.db, input.tripId, ctx.user.id);
        const own = and(
          eq(aiChatMessage.tripId, input.tripId),
          eq(aiChatMessage.userId, ctx.user.id),
          eq(aiChatMessage.conversationId, input.conversationId),
        );
        const [target] = await ctx.db
          .select()
          .from(aiChatMessage)
          .where(and(own, eq(aiChatMessage.id, input.messageId)));
        if (!target) throw new TRPCError({ code: 'NOT_FOUND', message: 'MESSAGE_NOT_FOUND' });
        const [anchor] =
          target.role === 'user'
            ? [target]
            : await ctx.db
                .select()
                .from(aiChatMessage)
                .where(
                  and(
                    own,
                    eq(aiChatMessage.role, 'user'),
                    lte(aiChatMessage.createdAt, target.createdAt),
                  ),
                )
                .orderBy(desc(aiChatMessage.createdAt))
                .limit(1);
        if (!anchor) throw new TRPCError({ code: 'NOT_FOUND', message: 'MESSAGE_NOT_FOUND' });
        const removed = await ctx.db
          .delete(aiChatMessage)
          .where(and(own, gte(aiChatMessage.createdAt, anchor.createdAt)))
          .returning({ id: aiChatMessage.id });
        return { message: anchor.content, removed: removed.length };
      }),

    /** Segna come applicate le modifiche proposte da un messaggio dell'assistente. */
    markApplied: authedProcedure
      .input(z.object({ tripId: z.uuid(), messageId: z.uuid() }))
      .mutation(async ({ ctx, input }) => {
        await requireMember(ctx.db, input.tripId, ctx.user.id, 'editor');
        await ctx.db
          .update(aiChatMessage)
          .set({ appliedAt: new Date() })
          .where(
            and(
              eq(aiChatMessage.id, input.messageId),
              eq(aiChatMessage.tripId, input.tripId),
              eq(aiChatMessage.userId, ctx.user.id),
              isNull(aiChatMessage.appliedAt),
            ),
          );
        return { ok: true };
      }),
  }),
});

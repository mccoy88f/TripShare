import { and, count, eq } from 'drizzle-orm';
import { z } from 'zod';
import { pushSubscription } from '@tripshare/db';
import { createWebPushSender, ensureVapid, pushToUser } from '../services/push.js';
import { authedProcedure, router } from '../trpc/init.js';

/** Dispositivi che ricevono le notifiche push dell'utente. */
export const pushRouter = router({
  /** Chiave pubblica da usare per iscrivere il dispositivo. */
  config: authedProcedure.query(async ({ ctx }) => {
    const { publicKey } = await ensureVapid(ctx.settings);
    const [row] = await ctx.db
      .select({ n: count() })
      .from(pushSubscription)
      .where(eq(pushSubscription.userId, ctx.user.id));
    return { publicKey, devices: Number(row?.n ?? 0) };
  }),

  subscribe: authedProcedure
    .input(
      z.object({
        endpoint: z.url().max(2000),
        keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(10).max(100) }),
        userAgent: z.string().max(300).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Lo stesso dispositivo (endpoint) passa all'utente che si è collegato per ultimo.
      await ctx.db
        .insert(pushSubscription)
        .values({
          userId: ctx.user.id,
          endpoint: input.endpoint,
          p256dh: input.keys.p256dh,
          auth: input.keys.auth,
          userAgent: input.userAgent ?? null,
        })
        .onConflictDoUpdate({
          target: pushSubscription.endpoint,
          set: {
            userId: ctx.user.id,
            p256dh: input.keys.p256dh,
            auth: input.keys.auth,
            userAgent: input.userAgent ?? null,
          },
        });
      return { ok: true };
    }),

  unsubscribe: authedProcedure
    .input(z.object({ endpoint: z.url().max(2000) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(pushSubscription)
        .where(
          and(
            eq(pushSubscription.userId, ctx.user.id),
            eq(pushSubscription.endpoint, input.endpoint),
          ),
        );
      return { ok: true };
    }),

  /** Manda una notifica di prova ai dispositivi dell'utente. */
  test: authedProcedure.mutation(async ({ ctx }) => {
    const sender =
      ctx.pushSender ??
      createWebPushSender(ctx.settings, `mailto:${ctx.env.SUPERADMIN_EMAIL ?? 'admin@localhost'}`);
    const lang = ctx.user.locale === 'en' ? 'en' : 'it';
    const sent = await pushToUser({ db: ctx.db, sender }, ctx.user.id, {
      title: ctx.env.APP_NAME,
      body: lang === 'en' ? 'Notifications are working.' : 'Le notifiche funzionano.',
      url: '/app',
      tag: 'test',
    });
    return { sent };
  }),
});

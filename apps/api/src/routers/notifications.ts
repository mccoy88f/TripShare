import { and, count, desc, eq, inArray, isNull, lt } from 'drizzle-orm';
import { z } from 'zod';
import { notification, trip, tripEvent, tripMember, user } from '@tripshare/db';
import { authedProcedure, router, type Context } from '../trpc/init.js';

/** Viaggi di cui l'utente fa ancora parte: le notifiche degli altri non si vedono più. */
async function activeTripIds(ctx: Context & { user: { id: string } }, only?: string) {
  const rows = await ctx.db
    .select({ id: tripMember.tripId })
    .from(tripMember)
    .where(
      and(
        eq(tripMember.userId, ctx.user.id),
        isNull(tripMember.removedAt),
        ...(only ? [eq(tripMember.tripId, only)] : []),
      ),
    );
  return rows.map((r) => r.id);
}

export const notificationsRouter = router({
  /** Notifiche dalla più recente, a pagine; `before` è la data dell'ultima ricevuta. */
  list: authedProcedure
    .input(
      z.object({
        tripId: z.uuid().optional(),
        before: z.iso.datetime().optional(),
        limit: z.number().int().min(1).max(60).default(30),
      }),
    )
    .query(async ({ ctx, input }) => {
      const tripIds = await activeTripIds(ctx, input.tripId);
      if (tripIds.length === 0) return { items: [], hasMore: false };
      const rows = await ctx.db
        .select({
          id: notification.id,
          readAt: notification.readAt,
          createdAt: notification.createdAt,
          tripId: notification.tripId,
          tripTitle: trip.title,
          tripEmoji: trip.emoji,
          event: {
            id: tripEvent.id,
            type: tripEvent.type,
            entityId: tripEvent.entityId,
            data: tripEvent.data,
            count: tripEvent.count,
          },
          actorName: tripMember.name,
          actorUserName: user.name,
          actorImage: user.image,
          actorEmoji: user.avatarEmoji,
          actorColor: user.avatarColor,
        })
        .from(notification)
        .innerJoin(tripEvent, eq(tripEvent.id, notification.eventId))
        .innerJoin(trip, eq(trip.id, notification.tripId))
        .leftJoin(tripMember, eq(tripMember.id, tripEvent.actorMemberId))
        .leftJoin(user, eq(user.id, tripMember.userId))
        .where(
          and(
            eq(notification.userId, ctx.user.id),
            inArray(notification.tripId, tripIds),
            ...(input.before ? [lt(notification.createdAt, new Date(input.before))] : []),
          ),
        )
        .orderBy(desc(notification.createdAt))
        .limit(input.limit + 1);
      const page = rows.slice(0, input.limit);
      return {
        hasMore: rows.length > input.limit,
        items: page.map((r) => ({
          id: r.id,
          read: !!r.readAt,
          createdAt: r.createdAt,
          tripId: r.tripId,
          tripTitle: r.tripTitle,
          tripEmoji: r.tripEmoji,
          event: r.event,
          actor: r.actorName
            ? {
                name: r.actorUserName ?? r.actorName,
                image: r.actorImage ?? null,
                avatarEmoji: r.actorEmoji ?? null,
                avatarColor: r.actorColor ?? null,
              }
            : null,
        })),
      };
    }),

  /** Quante notifiche non lette, in totale e per viaggio. */
  unread: authedProcedure.query(async ({ ctx }) => {
    const tripIds = await activeTripIds(ctx);
    if (tripIds.length === 0) return { total: 0, byTrip: {} as Record<string, number> };
    const rows = await ctx.db
      .select({ tripId: notification.tripId, n: count() })
      .from(notification)
      .where(
        and(
          eq(notification.userId, ctx.user.id),
          isNull(notification.readAt),
          inArray(notification.tripId, tripIds),
        ),
      )
      .groupBy(notification.tripId);
    const byTrip: Record<string, number> = {};
    let total = 0;
    for (const r of rows) {
      byTrip[r.tripId] = Number(r.n);
      total += Number(r.n);
    }
    return { total, byTrip };
  }),

  markRead: authedProcedure
    .input(z.object({ ids: z.array(z.uuid()).min(1).max(100) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(notification)
        .set({ readAt: new Date() })
        .where(
          and(
            eq(notification.userId, ctx.user.id),
            inArray(notification.id, input.ids),
            isNull(notification.readAt),
          ),
        );
      return { ok: true };
    }),

  markAllRead: authedProcedure
    .input(z.object({ tripId: z.uuid().optional() }).optional())
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(notification)
        .set({ readAt: new Date() })
        .where(
          and(
            eq(notification.userId, ctx.user.id),
            isNull(notification.readAt),
            ...(input?.tripId ? [eq(notification.tripId, input.tripId)] : []),
          ),
        );
      return { ok: true };
    }),
});

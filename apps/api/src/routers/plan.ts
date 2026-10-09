import { TRPCError } from '@trpc/server';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { packingCheck, trip } from '@tripshare/db';
import { applyPlanOps, parseTripDocument, PlanOpSchema } from '@tripshare/shared/trip-format';
import { activeMemberCount, planError, prepareForStorage, readPlan } from '../services/plan.js';
import { requireMember } from '../services/trips.js';
import { authedProcedure, router } from '../trpc/init.js';
import { forecast, forecastWindow, geocode } from '../weather.js';

const localeOf = (l: unknown) => (l === 'en' ? 'en' : 'it');

export const planRouter = router({
  get: authedProcedure.input(z.object({ tripId: z.uuid() })).query(async ({ ctx, input }) => {
    const { trip: row } = await requireMember(ctx.db, input.tripId, ctx.user.id);
    const [members, checks] = await Promise.all([
      activeMemberCount(ctx.db, input.tripId),
      ctx.db.select().from(packingCheck).where(eq(packingCheck.tripId, input.tripId)),
    ]);
    const byItem: Record<string, string[]> = {};
    for (const c of checks) (byItem[c.itemId] ??= []).push(c.memberId);
    return {
      plan: readPlan(row, members, localeOf(ctx.session?.user.locale)),
      version: row.planVersion,
      checks: byItem,
    };
  }),

  /** Applica una o più operazioni in modo atomico (riga bloccata durante la modifica). */
  applyOps: authedProcedure
    .input(z.object({ tripId: z.uuid(), ops: z.array(PlanOpSchema).min(1).max(200) }))
    .mutation(async ({ ctx, input }) => {
      await requireMember(ctx.db, input.tripId, ctx.user.id, 'editor');
      const members = await activeMemberCount(ctx.db, input.tripId);
      try {
        return await ctx.db.transaction(async (tx) => {
          const [row] = await tx.select().from(trip).where(eq(trip.id, input.tripId)).for('update');
          if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
          const next = prepareForStorage(
            applyPlanOps(readPlan(row, members, localeOf(ctx.session?.user.locale)), input.ops),
          );
          const [updated] = await tx
            .update(trip)
            .set({ plan: next, planVersion: sql`${trip.planVersion} + 1`, updatedAt: new Date() })
            .where(eq(trip.id, input.tripId))
            .returning({ version: trip.planVersion });
          return { version: updated!.version };
        });
      } catch (err) {
        planError(err);
      }
    }),

  /**
   * Sostituisce l'intero programma con un documento nel formato standard (import o AI).
   * Con `updateTrip` aggiorna anche titolo, emoji, destinazione e date del viaggio.
   */
  replace: authedProcedure
    .input(
      z.object({ tripId: z.uuid(), plan: z.unknown(), updateTrip: z.boolean().default(false) }),
    )
    .mutation(async ({ ctx, input }) => {
      const { trip: row } = await requireMember(ctx.db, input.tripId, ctx.user.id, 'editor');
      const parsed = parseTripDocument(input.plan);
      if (!parsed.success) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `PLAN_INVALID:${parsed.issues
            .slice(0, 5)
            .map((i) => `${i.path}: ${i.message}`)
            .join('; ')}`,
        });
      }
      const plan = prepareForStorage({
        ...parsed.data,
        trip: { ...parsed.data.trip, currency: row.currency as typeof parsed.data.trip.currency },
      });
      await ctx.db
        .update(trip)
        .set({
          plan,
          planVersion: sql`${trip.planVersion} + 1`,
          updatedAt: new Date(),
          ...(input.updateTrip
            ? {
                title: plan.trip.title,
                emoji: plan.trip.emoji ?? row.emoji,
                destination: plan.trip.destination.name,
                description: plan.trip.summary ?? row.description,
                startDate: plan.trip.startDate ?? row.startDate,
                endDate: plan.trip.endDate ?? row.endDate,
              }
            : {}),
        })
        .where(eq(trip.id, input.tripId));
      return { ok: true };
    }),

  togglePacking: authedProcedure
    .input(z.object({ tripId: z.uuid(), itemId: z.string().min(1).max(64), checked: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const { member } = await requireMember(ctx.db, input.tripId, ctx.user.id);
      if (input.checked) {
        await ctx.db
          .insert(packingCheck)
          .values({ tripId: input.tripId, itemId: input.itemId, memberId: member.id })
          .onConflictDoNothing();
      } else {
        await ctx.db
          .delete(packingCheck)
          .where(
            and(
              eq(packingCheck.tripId, input.tripId),
              eq(packingCheck.itemId, input.itemId),
              eq(packingCheck.memberId, member.id),
            ),
          );
      }
      return { ok: true };
    }),

  weather: authedProcedure.input(z.object({ tripId: z.uuid() })).query(async ({ ctx, input }) => {
    const { trip: row } = await requireMember(ctx.db, input.tripId, ctx.user.id);
    const plan = readPlan(row, 1);
    const start = plan.trip.startDate;
    const end = plan.trip.endDate ?? start;
    if (!start || !end) return { status: 'NO_DATES' as const, days: [] };
    const window = forecastWindow(start, end);
    if (!window)
      return {
        status:
          start > new Date().toISOString().slice(0, 10) ? ('TOO_FAR' as const) : ('PAST' as const),
        days: [],
      };
    const located = plan.places.find((p) => p.location)?.location;
    try {
      const point =
        located ??
        (await geocode(
          plan.trip.destination.name,
          localeOf(ctx.session?.user.locale),
          ctx.httpFetch,
        ));
      if (!point) return { status: 'NO_LOCATION' as const, days: [] };
      const days = await forecast(point, window.from, window.to, ctx.httpFetch);
      return {
        status: 'OK' as const,
        location: 'name' in point ? point.name : plan.trip.destination.name,
        days,
      };
    } catch {
      return { status: 'UNAVAILABLE' as const, days: [] };
    }
  }),
});

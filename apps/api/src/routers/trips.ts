import { TRPCError } from '@trpc/server';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { expense, trip, tripMember, user } from '@tripshare/db';
import { CURRENCY_CODES } from '@tripshare/shared';
import { computeLedgers, requireMember } from '../services/trips.js';
import { listMembers } from '../services/members.js';
import { authedProcedure, router } from '../trpc/init.js';

const IsoDate = z.iso.date();
const Emoji = z.string().max(16);
const Color = z.string().regex(/^#[0-9a-f]{6}$/i);

const TripInput = z
  .object({
    title: z.string().trim().min(1).max(120),
    emoji: Emoji.nullable().optional(),
    description: z.string().trim().max(1000).nullable().optional(),
    destination: z.string().trim().max(120).nullable().optional(),
    startDate: IsoDate.nullable().optional(),
    endDate: IsoDate.nullable().optional(),
    currency: z.enum(CURRENCY_CODES),
    coverColor: Color.nullable().optional(),
  })
  .refine((v) => !v.startDate || !v.endDate || v.endDate >= v.startDate, {
    message: 'END_BEFORE_START',
    path: ['endDate'],
  });

export const tripsRouter = router({
  list: authedProcedure.query(async ({ ctx }) => {
    const mine = await ctx.db
      .select({ trip, memberId: tripMember.id, role: tripMember.role })
      .from(tripMember)
      .innerJoin(trip, eq(trip.id, tripMember.tripId))
      .where(and(eq(tripMember.userId, ctx.user.id), isNull(tripMember.removedAt)))
      .orderBy(desc(trip.startDate), desc(trip.createdAt));
    const ids = mine.map((m) => m.trip.id);
    const [ledgers, members] = await Promise.all([
      computeLedgers(ctx.db, ids),
      Promise.all(ids.map((id) => listMembers(ctx.db, id))),
    ]);
    return mine.map((m, i) => {
      const ledger = ledgers.get(m.trip.id)!;
      return {
        ...m.trip,
        role: m.role,
        myMemberId: m.memberId,
        myBalance: ledger.balances[m.memberId] ?? 0,
        total: ledger.total,
        members: members[i]!.filter((x) => !x.removed),
      };
    });
  }),

  get: authedProcedure.input(z.object({ id: z.uuid() })).query(async ({ ctx, input }) => {
    const { member, trip: t } = await requireMember(ctx.db, input.id, ctx.user.id);
    const [members, ledgers, paypalEnabled] = await Promise.all([
      listMembers(ctx.db, input.id),
      computeLedgers(ctx.db, [input.id]),
      ctx.settings.get('payments.paypalEnabled'),
    ]);
    return {
      ...t,
      role: member.role,
      myMemberId: member.id,
      members: members.map((m) => ({ ...m, paypalMe: paypalEnabled ? m.paypalMe : null })),
      ledger: ledgers.get(input.id)!,
    };
  }),

  create: authedProcedure.input(TripInput).mutation(async ({ ctx, input }) => {
    const [me] = await ctx.db.select().from(user).where(eq(user.id, ctx.user.id));
    return ctx.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(trip)
        .values({ ...input, createdBy: ctx.user.id })
        .returning();
      await tx.insert(tripMember).values({
        tripId: created!.id,
        userId: ctx.user.id,
        name: me?.name ?? ctx.user.name,
        role: 'owner',
      });
      return { id: created!.id };
    });
  }),

  update: authedProcedure
    .input(z.object({ id: z.uuid(), data: TripInput }))
    .mutation(async ({ ctx, input }) => {
      const { trip: current } = await requireMember(ctx.db, input.id, ctx.user.id, 'owner');
      if (input.data.currency !== current.currency) {
        const [any] = await ctx.db
          .select({ id: expense.id })
          .from(expense)
          .where(and(eq(expense.tripId, input.id), isNull(expense.deletedAt)))
          .limit(1);
        if (any) throw new TRPCError({ code: 'BAD_REQUEST', message: 'CURRENCY_LOCKED' });
      }
      await ctx.db
        .update(trip)
        .set({ ...input.data, updatedAt: new Date() })
        .where(eq(trip.id, input.id));
      return { ok: true };
    }),

  removeCover: authedProcedure
    .input(z.object({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { trip: t } = await requireMember(ctx.db, input.id, ctx.user.id, 'editor');
      await ctx.db
        .update(trip)
        .set({ coverImage: null, updatedAt: new Date() })
        .where(eq(trip.id, input.id));
      await ctx.storage?.removeByUrl(t.coverImage);
      return { ok: true };
    }),

  delete: authedProcedure.input(z.object({ id: z.uuid() })).mutation(async ({ ctx, input }) => {
    const { trip: t } = await requireMember(ctx.db, input.id, ctx.user.id, 'owner');
    await ctx.db.delete(trip).where(eq(trip.id, input.id));
    await ctx.storage?.removeByUrl(t.coverImage);
    return { ok: true };
  }),

  members: router({
    addPlaceholder: authedProcedure
      .input(
        z.object({
          tripId: z.uuid(),
          name: z.string().trim().min(1).max(80),
          avatarEmoji: Emoji.nullable().optional(),
          avatarColor: Color.nullable().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        await requireMember(ctx.db, input.tripId, ctx.user.id, 'editor');
        const [m] = await ctx.db
          .insert(tripMember)
          .values({
            tripId: input.tripId,
            name: input.name,
            avatarEmoji: input.avatarEmoji,
            avatarColor: input.avatarColor,
          })
          .returning({ id: tripMember.id });
        return m!;
      }),

    update: authedProcedure
      .input(
        z.object({
          tripId: z.uuid(),
          memberId: z.uuid(),
          role: z.enum(['owner', 'editor', 'viewer']).optional(),
          name: z.string().trim().min(1).max(80).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const { member: me } = await requireMember(ctx.db, input.tripId, ctx.user.id, 'editor');
        const [target] = await ctx.db
          .select()
          .from(tripMember)
          .where(and(eq(tripMember.id, input.memberId), eq(tripMember.tripId, input.tripId)));
        if (!target) throw new TRPCError({ code: 'NOT_FOUND' });
        const patch: Partial<typeof tripMember.$inferInsert> = {};
        if (input.name !== undefined) {
          if (target.userId)
            throw new TRPCError({ code: 'BAD_REQUEST', message: 'NAME_FROM_PROFILE' });
          patch.name = input.name;
        }
        if (input.role !== undefined && input.role !== target.role) {
          if (me.role !== 'owner') throw new TRPCError({ code: 'FORBIDDEN' });
          if (!target.userId)
            throw new TRPCError({ code: 'BAD_REQUEST', message: 'PLACEHOLDER_ROLE' });
          if (target.role === 'owner') await ensureAnotherOwner(ctx, input.tripId, target.id);
          patch.role = input.role;
        }
        if (Object.keys(patch).length)
          await ctx.db.update(tripMember).set(patch).where(eq(tripMember.id, target.id));
        return { ok: true };
      }),

    remove: authedProcedure
      .input(z.object({ tripId: z.uuid(), memberId: z.uuid() }))
      .mutation(async ({ ctx, input }) => {
        const { member: me } = await requireMember(ctx.db, input.tripId, ctx.user.id);
        const [target] = await ctx.db
          .select()
          .from(tripMember)
          .where(
            and(
              eq(tripMember.id, input.memberId),
              eq(tripMember.tripId, input.tripId),
              isNull(tripMember.removedAt),
            ),
          );
        if (!target) throw new TRPCError({ code: 'NOT_FOUND' });
        // Si può uscire da soli; per togliere altri serve essere proprietari.
        if (target.id !== me.id && me.role !== 'owner') throw new TRPCError({ code: 'FORBIDDEN' });
        if (target.role === 'owner') await ensureAnotherOwner(ctx, input.tripId, target.id);
        // Il membro resta nello storico delle spese: viene solo segnato come rimosso.
        await ctx.db
          .update(tripMember)
          .set({ removedAt: new Date(), role: 'viewer' })
          .where(eq(tripMember.id, target.id));
        return { ok: true };
      }),
  }),
});

async function ensureAnotherOwner(
  ctx: { db: import('@tripshare/db').Database },
  tripId: string,
  exceptId: string,
) {
  const owners = await ctx.db
    .select({ id: tripMember.id })
    .from(tripMember)
    .where(
      and(
        eq(tripMember.tripId, tripId),
        eq(tripMember.role, 'owner'),
        isNull(tripMember.removedAt),
      ),
    );
  if (!owners.some((o) => o.id !== exceptId)) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'LAST_OWNER' });
  }
}

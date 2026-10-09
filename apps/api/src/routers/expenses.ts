import { TRPCError } from '@trpc/server';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';
import {
  expense,
  expensePayer,
  expenseShare,
  settlement,
  tripMember,
  type Database,
} from '@tripshare/db';
import {
  CURRENCY_CODES,
  EXPENSE_CATEGORY_KEYS,
  computeShares,
  convertMinor,
  type CurrencyCode,
  type SplitInput,
} from '@tripshare/shared';
import { getRate } from '../fx.js';
import { requireMember } from '../services/trips.js';
import { authedProcedure, router, type Context } from '../trpc/init.js';

const MemberId = z.uuid();
const Minor = z.number().int().positive().max(1e12);

const SplitSchema = z.discriminatedUnion('method', [
  z.object({ method: z.literal('equal'), members: z.array(MemberId).min(1) }),
  z.object({
    method: z.literal('shares'),
    shares: z.record(MemberId, z.number().min(0).max(1000)),
  }),
  z.object({
    method: z.literal('percent'),
    percents: z.record(MemberId, z.number().min(0).max(100)),
  }),
  z.object({ method: z.literal('exact'), amounts: z.record(MemberId, z.number().int().min(0)) }),
]);

const ExpenseInput = z.object({
  tripId: z.uuid(),
  title: z.string().trim().min(1).max(160),
  emoji: z.string().max(16).nullable().optional(),
  category: z.enum(EXPENSE_CATEGORY_KEYS),
  amount: Minor,
  currency: z.enum(CURRENCY_CODES),
  /** Unità della valuta del viaggio per 1 unità della valuta della spesa. Se manca, si usa la BCE. */
  rate: z.number().positive().max(1e6).optional(),
  date: z.iso.date(),
  payers: z.array(z.object({ memberId: MemberId, amount: z.number().int().min(0) })).min(1),
  split: SplitSchema,
  notes: z.string().trim().max(1000).nullable().optional(),
  /** "planned": da pagare, conta nel budget ma non nei saldi finché non viene pagata. */
  status: z.enum(['paid', 'planned']).default('paid'),
  bookingId: z.string().max(64).nullable().optional(),
  /** Scontrino caricato con /api/trips/:id/ai-files. */
  receipt: z
    .string()
    .regex(/^[a-f0-9]{32}\.[a-z0-9]{1,8}$/)
    .nullable()
    .optional(),
});
type ExpenseInputT = z.infer<typeof ExpenseInput>;

async function activeMemberIds(db: Database, tripId: string) {
  const rows = await db
    .select({ id: tripMember.id, removedAt: tripMember.removedAt })
    .from(tripMember)
    .where(eq(tripMember.tripId, tripId));
  return {
    all: new Set(rows.map((r) => r.id)),
    active: new Set(rows.filter((r) => !r.removedAt).map((r) => r.id)),
  };
}

function weightsOf(split: z.infer<typeof SplitSchema>): Record<string, number | null> {
  switch (split.method) {
    case 'equal':
      return Object.fromEntries(split.members.map((m) => [m, null]));
    case 'shares':
      return split.shares;
    case 'percent':
      return split.percents;
    case 'exact':
      return Object.fromEntries(Object.keys(split.amounts).map((m) => [m, null]));
  }
}

/** Valida l'input e calcola quote, pagatori e importo convertito. */
async function prepare(
  ctx: Context,
  input: ExpenseInputT,
  tripCurrency: CurrencyCode,
  allowedMembers: Set<string>,
) {
  const memberIds = [
    ...input.payers.map((p) => p.memberId),
    ...Object.keys(weightsOf(input.split)),
  ];
  if (memberIds.some((id) => !allowedMembers.has(id)))
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'UNKNOWN_MEMBER' });
  if (new Set(input.payers.map((p) => p.memberId)).size !== input.payers.length) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'DUPLICATE_PAYER' });
  }
  if (input.payers.reduce((a, p) => a + p.amount, 0) !== input.amount) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'PAYERS_MUST_SUM_TO_TOTAL' });
  }
  let shares: Record<string, number>;
  try {
    shares = computeShares(input.amount, input.split as SplitInput);
  } catch (err) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: err instanceof Error ? err.message : 'INVALID_SPLIT',
    });
  }
  if (Object.values(shares).every((v) => v === 0))
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'EMPTY_SPLIT' });

  let rate = 1;
  if (input.currency !== tripCurrency) {
    if (input.rate) rate = input.rate;
    else {
      try {
        rate = (await (ctx.fxRate ?? getRate)(input.currency, tripCurrency, input.date)).rate;
      } catch {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'FX_UNAVAILABLE' });
      }
    }
  }
  const amountTrip = convertMinor(input.amount, input.currency, tripCurrency, rate);
  if (amountTrip <= 0) throw new TRPCError({ code: 'BAD_REQUEST', message: 'AMOUNT_TOO_SMALL' });
  return { shares, rate, amountTrip, weights: weightsOf(input.split) };
}

async function writeParts(
  tx: Parameters<Parameters<Database['transaction']>[0]>[0],
  expenseId: string,
  input: ExpenseInputT,
  shares: Record<string, number>,
  weights: Record<string, number | null>,
) {
  await tx.delete(expensePayer).where(eq(expensePayer.expenseId, expenseId));
  await tx.delete(expenseShare).where(eq(expenseShare.expenseId, expenseId));
  const payers = input.payers.filter((p) => p.amount > 0);
  if (payers.length) await tx.insert(expensePayer).values(payers.map((p) => ({ expenseId, ...p })));
  const shareRows = Object.entries(shares)
    .filter(([id, amount]) => amount > 0 || weights[id] !== undefined)
    .map(([memberId, amount]) => ({
      expenseId,
      memberId,
      amount,
      weight: weights[memberId] ?? null,
    }));
  if (shareRows.length) await tx.insert(expenseShare).values(shareRows);
}

export const expensesRouter = router({
  list: authedProcedure.input(z.object({ tripId: z.uuid() })).query(async ({ ctx, input }) => {
    await requireMember(ctx.db, input.tripId, ctx.user.id);
    const rows = await ctx.db
      .select()
      .from(expense)
      .where(and(eq(expense.tripId, input.tripId), isNull(expense.deletedAt)))
      .orderBy(desc(expense.date), desc(expense.createdAt));
    const ids = rows.map((r) => r.id);
    const [payers, shares] = ids.length
      ? await Promise.all([
          ctx.db.select().from(expensePayer).where(inArray(expensePayer.expenseId, ids)),
          ctx.db.select().from(expenseShare).where(inArray(expenseShare.expenseId, ids)),
        ])
      : [[], []];
    return rows.map((r) => ({
      ...r,
      payers: payers
        .filter((p) => p.expenseId === r.id)
        .map(({ memberId, amount }) => ({ memberId, amount })),
      shares: shares
        .filter((s) => s.expenseId === r.id)
        .map(({ memberId, amount, weight }) => ({ memberId, amount, weight })),
    }));
  }),

  create: authedProcedure.input(ExpenseInput).mutation(async ({ ctx, input }) => {
    const { trip } = await requireMember(ctx.db, input.tripId, ctx.user.id, 'editor');
    const { active } = await activeMemberIds(ctx.db, input.tripId);
    const prepared = await prepare(ctx, input, trip.currency as CurrencyCode, active);
    return ctx.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(expense)
        .values({
          tripId: input.tripId,
          title: input.title,
          emoji: input.emoji,
          category: input.category,
          amount: input.amount,
          currency: input.currency,
          rate: prepared.rate,
          amountTrip: prepared.amountTrip,
          date: input.date,
          splitMethod: input.split.method,
          notes: input.notes,
          status: input.status,
          bookingId: input.bookingId ?? null,
          receipt: input.receipt ?? null,
          createdBy: ctx.user.id,
        })
        .returning({ id: expense.id });
      await writeParts(tx, row!.id, input, prepared.shares, prepared.weights);
      return { id: row!.id };
    });
  }),

  update: authedProcedure
    .input(ExpenseInput.extend({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { trip } = await requireMember(ctx.db, input.tripId, ctx.user.id, 'editor');
      const [current] = await ctx.db
        .select({ id: expense.id })
        .from(expense)
        .where(
          and(
            eq(expense.id, input.id),
            eq(expense.tripId, input.tripId),
            isNull(expense.deletedAt),
          ),
        );
      if (!current) throw new TRPCError({ code: 'NOT_FOUND' });
      // Nelle modifiche restano validi anche i membri usciti dal viaggio dopo la spesa.
      const { all } = await activeMemberIds(ctx.db, input.tripId);
      const prepared = await prepare(ctx, input, trip.currency as CurrencyCode, all);
      await ctx.db.transaction(async (tx) => {
        await tx
          .update(expense)
          .set({
            title: input.title,
            emoji: input.emoji,
            category: input.category,
            amount: input.amount,
            currency: input.currency,
            rate: prepared.rate,
            amountTrip: prepared.amountTrip,
            date: input.date,
            splitMethod: input.split.method,
            notes: input.notes,
            status: input.status,
            bookingId: input.bookingId ?? null,
            ...(input.receipt !== undefined ? { receipt: input.receipt } : {}),
            updatedAt: new Date(),
          })
          .where(eq(expense.id, input.id));
        await writeParts(tx, input.id, input, prepared.shares, prepared.weights);
      });
      return { ok: true };
    }),

  /** Segna come pagata una spesa prevista (o la riporta a "da pagare"). */
  setStatus: authedProcedure
    .input(
      z.object({
        tripId: z.uuid(),
        id: z.uuid(),
        status: z.enum(['paid', 'planned']),
        date: z.iso.date().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireMember(ctx.db, input.tripId, ctx.user.id, 'editor');
      const [row] = await ctx.db
        .update(expense)
        .set({
          status: input.status,
          ...(input.date ? { date: input.date } : {}),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(expense.id, input.id),
            eq(expense.tripId, input.tripId),
            isNull(expense.deletedAt),
          ),
        )
        .returning({ id: expense.id });
      if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
      return { ok: true };
    }),

  delete: authedProcedure
    .input(z.object({ tripId: z.uuid(), id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      await requireMember(ctx.db, input.tripId, ctx.user.id, 'editor');
      await ctx.db
        .update(expense)
        .set({ deletedAt: new Date() })
        .where(and(eq(expense.id, input.id), eq(expense.tripId, input.tripId)));
      return { ok: true };
    }),

  rate: authedProcedure
    .input(
      z.object({
        from: z.enum(CURRENCY_CODES),
        to: z.enum(CURRENCY_CODES),
        date: z.iso.date().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      try {
        return await (ctx.fxRate ?? getRate)(input.from, input.to, input.date);
      } catch {
        throw new TRPCError({ code: 'BAD_GATEWAY', message: 'FX_UNAVAILABLE' });
      }
    }),
});

export const settlementsRouter = router({
  list: authedProcedure.input(z.object({ tripId: z.uuid() })).query(async ({ ctx, input }) => {
    await requireMember(ctx.db, input.tripId, ctx.user.id);
    return ctx.db
      .select()
      .from(settlement)
      .where(and(eq(settlement.tripId, input.tripId), isNull(settlement.deletedAt)))
      .orderBy(desc(settlement.date), desc(settlement.createdAt));
  }),

  create: authedProcedure
    .input(
      z.object({
        tripId: z.uuid(),
        fromMemberId: MemberId,
        toMemberId: MemberId,
        amount: Minor,
        method: z.enum(['manual', 'paypal']).default('manual'),
        note: z.string().trim().max(300).optional(),
        date: z.iso.date(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { member } = await requireMember(ctx.db, input.tripId, ctx.user.id);
      // Un rimborso può registrarlo chi lo paga, chi lo riceve, oppure un editor del viaggio.
      const involved = member.id === input.fromMemberId || member.id === input.toMemberId;
      if (!involved && member.role === 'viewer') throw new TRPCError({ code: 'FORBIDDEN' });
      if (input.fromMemberId === input.toMemberId)
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'SAME_MEMBER' });
      const { all } = await activeMemberIds(ctx.db, input.tripId);
      if (!all.has(input.fromMemberId) || !all.has(input.toMemberId)) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'UNKNOWN_MEMBER' });
      }
      const [row] = await ctx.db
        .insert(settlement)
        .values({ ...input, createdBy: ctx.user.id })
        .returning({ id: settlement.id });
      return row!;
    }),

  delete: authedProcedure
    .input(z.object({ tripId: z.uuid(), id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { member } = await requireMember(ctx.db, input.tripId, ctx.user.id);
      const [row] = await ctx.db
        .select()
        .from(settlement)
        .where(
          and(
            eq(settlement.id, input.id),
            eq(settlement.tripId, input.tripId),
            isNull(settlement.deletedAt),
          ),
        );
      if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
      const involved = member.id === row.fromMemberId || member.id === row.toMemberId;
      if (!involved && member.role !== 'owner') throw new TRPCError({ code: 'FORBIDDEN' });
      await ctx.db
        .update(settlement)
        .set({ deletedAt: new Date() })
        .where(eq(settlement.id, row.id));
      return { ok: true };
    }),
});

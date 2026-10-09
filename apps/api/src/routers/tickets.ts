import { TRPCError } from '@trpc/server';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { bookingTicket, tripMember } from '@tripshare/db';
import { requireMember } from '../services/trips.js';
import { authedProcedure, router, type Context } from '../trpc/init.js';

export const TICKET_CODE_FORMATS = [
  'QRCode',
  'AztecCode',
  'PDF417',
  'DataMatrix',
  'Code128',
  'Code39',
  'EAN13',
  'EAN8',
  'UPCA',
  'ITF',
] as const;

const WalletUrl = z
  .url()
  .max(2000)
  .refine((u) => u.startsWith('https://'), 'HTTPS_ONLY');

async function checkMember(ctx: Context, tripId: string, memberId: string | null | undefined) {
  if (!memberId) return;
  const [m] = await ctx.db
    .select({ id: tripMember.id })
    .from(tripMember)
    .where(and(eq(tripMember.id, memberId), eq(tripMember.tripId, tripId)));
  if (!m) throw new TRPCError({ code: 'BAD_REQUEST', message: 'UNKNOWN_MEMBER' });
}

export const ticketsRouter = router({
  list: authedProcedure.input(z.object({ tripId: z.uuid() })).query(async ({ ctx, input }) => {
    await requireMember(ctx.db, input.tripId, ctx.user.id);
    const rows = await ctx.db
      .select()
      .from(bookingTicket)
      .where(eq(bookingTicket.tripId, input.tripId))
      .orderBy(asc(bookingTicket.bookingId), asc(bookingTicket.createdAt));
    return rows.map(({ storageName, ...r }) => ({
      ...r,
      hasFile: !!storageName,
      fileUrl: storageName ? `/api/trips/${input.tripId}/tickets/${r.id}/file` : null,
    }));
  }),

  /** Biglietto senza file: solo codice (QR, Aztec…) e/o link Google Wallet. */
  createCode: authedProcedure
    .input(
      z
        .object({
          tripId: z.uuid(),
          bookingId: z.string().min(1).max(64),
          memberId: z.uuid().nullable().optional(),
          label: z.string().trim().max(120).optional(),
          codeFormat: z.enum(TICKET_CODE_FORMATS).optional(),
          codeValue: z.string().max(4000).optional(),
          walletUrl: WalletUrl.optional(),
        })
        .refine((v) => (v.codeFormat && v.codeValue) || v.walletUrl, 'CODE_OR_WALLET_REQUIRED'),
    )
    .mutation(async ({ ctx, input }) => {
      await requireMember(ctx.db, input.tripId, ctx.user.id, 'editor');
      await checkMember(ctx, input.tripId, input.memberId);
      const [row] = await ctx.db
        .insert(bookingTicket)
        .values({ ...input, memberId: input.memberId ?? null, createdBy: ctx.user.id })
        .returning({ id: bookingTicket.id });
      return row!;
    }),

  update: authedProcedure
    .input(
      z.object({
        tripId: z.uuid(),
        id: z.uuid(),
        memberId: z.uuid().nullable().optional(),
        label: z.string().trim().max(120).nullable().optional(),
        codeFormat: z.enum(TICKET_CODE_FORMATS).nullable().optional(),
        codeValue: z.string().max(4000).nullable().optional(),
        walletUrl: WalletUrl.nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireMember(ctx.db, input.tripId, ctx.user.id, 'editor');
      await checkMember(ctx, input.tripId, input.memberId);
      const { tripId, id, ...patch } = input;
      await ctx.db
        .update(bookingTicket)
        .set(patch)
        .where(and(eq(bookingTicket.id, id), eq(bookingTicket.tripId, tripId)));
      return { ok: true };
    }),

  delete: authedProcedure
    .input(z.object({ tripId: z.uuid(), id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      await requireMember(ctx.db, input.tripId, ctx.user.id, 'editor');
      const [row] = await ctx.db
        .delete(bookingTicket)
        .where(and(eq(bookingTicket.id, input.id), eq(bookingTicket.tripId, input.tripId)))
        .returning({ storageName: bookingTicket.storageName });
      await ctx.storage?.removePrivate(row?.storageName);
      return { ok: true };
    }),
});

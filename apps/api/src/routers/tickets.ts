import { TRPCError } from '@trpc/server';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { bookingTicket, tripMember } from '@tripshare/db';
import { notifyTrip } from '../services/events.js';
import { requireMember } from '../services/trips.js';
import { infoFromGoogleWalletUrl, infoFromPkpass, type PassInfo } from '../services/wallet-pass.js';
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

/** Biglietti Wallet già letti per ricavarne codice e prenotazione: non si rileggono ogni volta. */
const walletChecked = new Set<string>();

export const ticketsRouter = router({
  list: authedProcedure.input(z.object({ tripId: z.uuid() })).query(async ({ ctx, input }) => {
    await requireMember(ctx.db, input.tripId, ctx.user.id);
    const query = () =>
      ctx.db
        .select()
        .from(bookingTicket)
        .where(eq(bookingTicket.tripId, input.tripId))
        .orderBy(asc(bookingTicket.bookingId), asc(bookingTicket.createdAt));
    let rows = await query();
    // I biglietti Wallet (anche caricati prima che si leggesse il file) senza codice o senza
    // numero di prenotazione: li si ricava ora, una volta sola per biglietto.
    let found = false;
    for (const r of rows) {
      const isPass = r.mimeType === 'application/vnd.apple.pkpass' || !!r.walletUrl;
      if (!isPass || (r.codeValue && r.reference) || walletChecked.has(r.id)) continue;
      walletChecked.add(r.id);
      let info: PassInfo = { code: null, reference: null };
      if (r.mimeType === 'application/vnd.apple.pkpass' && r.storageName) {
        const data = await ctx.storage?.readPrivate(r.storageName);
        if (data) info = infoFromPkpass(data);
      } else if (r.walletUrl) info = infoFromGoogleWalletUrl(r.walletUrl);
      const patch: Partial<typeof bookingTicket.$inferInsert> = {};
      if (!r.codeValue && info.code) {
        patch.codeFormat = info.code.format;
        patch.codeValue = info.code.value;
      }
      if (!r.reference && info.reference) patch.reference = info.reference;
      if (Object.keys(patch).length === 0) continue;
      await ctx.db.update(bookingTicket).set(patch).where(eq(bookingTicket.id, r.id));
      found = true;
    }
    if (found) rows = await query();
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
      // Dal link Google Wallet si ricavano anche il codice e il numero di prenotazione.
      const wallet = input.walletUrl ? infoFromGoogleWalletUrl(input.walletUrl) : null;
      const walletCode = !input.codeValue && wallet?.code ? wallet.code : null;
      const [row] = await ctx.db
        .insert(bookingTicket)
        .values({
          ...input,
          ...(walletCode
            ? { codeFormat: walletCode.format as never, codeValue: walletCode.value }
            : {}),
          reference: wallet?.reference ?? null,
          memberId: input.memberId ?? null,
          createdBy: ctx.user.id,
        })
        .returning({ id: bookingTicket.id });
      await notifyTrip(ctx.db, {
        tripId: input.tripId,
        actorUserId: ctx.user.id,
        type: 'ticket.added',
        entityId: input.bookingId,
        data: { title: input.label },
      });
      return row!;
    }),

  /** Biglietto da un file già caricato per l'AI (la foto della carta d'imbarco). */
  fromAiFile: authedProcedure
    .input(
      z.object({
        tripId: z.uuid(),
        bookingId: z.string().min(1).max(64),
        file: z.string().regex(/^[a-f0-9]{32}\.(jpg|png|webp|gif|pdf)$/),
        memberId: z.uuid().nullable().optional(),
        label: z.string().trim().max(120).optional(),
        codeFormat: z.enum(TICKET_CODE_FORMATS).optional(),
        codeValue: z.string().max(4000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireMember(ctx.db, input.tripId, ctx.user.id, 'editor');
      await checkMember(ctx, input.tripId, input.memberId);
      const data = await ctx.storage?.readPrivate(input.file);
      if (!data || !ctx.storage)
        throw new TRPCError({ code: 'NOT_FOUND', message: 'FILE_NOT_FOUND' });
      // Copia separata: il biglietto e lo scontrino della spesa si possono eliminare a parte.
      const ext = input.file.split('.').pop()!;
      const storageName = await ctx.storage.savePrivate(data, ext);
      const mime =
        ext === 'pdf' ? 'application/pdf' : ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
      const [row] = await ctx.db
        .insert(bookingTicket)
        .values({
          tripId: input.tripId,
          bookingId: input.bookingId,
          memberId: input.memberId ?? null,
          label: input.label ?? null,
          fileName: `${input.label ?? 'ticket'}.${ext}`.slice(0, 200),
          storageName,
          mimeType: mime,
          size: data.length,
          codeFormat: input.codeValue ? (input.codeFormat ?? null) : null,
          codeValue: input.codeFormat ? (input.codeValue ?? null) : null,
          createdBy: ctx.user.id,
        })
        .returning({ id: bookingTicket.id });
      await notifyTrip(ctx.db, {
        tripId: input.tripId,
        actorUserId: ctx.user.id,
        type: 'ticket.added',
        entityId: input.bookingId,
        data: { title: input.label },
      });
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
      // Un nuovo link Wallet va riletto per ricavarne il codice.
      walletChecked.delete(id);
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

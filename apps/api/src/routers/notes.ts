import { TRPCError } from '@trpc/server';
import { and, desc, eq, or } from 'drizzle-orm';
import { z } from 'zod';
import { tripNote } from '@tripshare/db';
import { notifyTrip } from '../services/events.js';
import { requireMember } from '../services/trips.js';
import { authedProcedure, router } from '../trpc/init.js';

const NoteInput = z.object({
  tripId: z.uuid(),
  emoji: z.string().max(16).nullable().optional(),
  title: z.string().trim().max(160).nullable().optional(),
  content: z.string().trim().min(1).max(10000),
  visibility: z.enum(['public', 'private']),
  pinned: z.boolean().optional(),
});

/**
 * Note del viaggio. Ognuno vede le note pubbliche e le proprie private; può modificarle solo
 * l'autore, mentre il proprietario del viaggio può eliminare anche le note pubbliche degli altri.
 * Anche chi ha il ruolo "può solo vedere" può scrivere le proprie note.
 */
export const notesRouter = router({
  list: authedProcedure.input(z.object({ tripId: z.uuid() })).query(async ({ ctx, input }) => {
    const { member } = await requireMember(ctx.db, input.tripId, ctx.user.id);
    return ctx.db
      .select()
      .from(tripNote)
      .where(
        and(
          eq(tripNote.tripId, input.tripId),
          or(eq(tripNote.visibility, 'public'), eq(tripNote.memberId, member.id)),
        ),
      )
      .orderBy(desc(tripNote.pinned), desc(tripNote.updatedAt));
  }),

  create: authedProcedure.input(NoteInput).mutation(async ({ ctx, input }) => {
    const { member } = await requireMember(ctx.db, input.tripId, ctx.user.id);
    const [row] = await ctx.db
      .insert(tripNote)
      .values({
        tripId: input.tripId,
        memberId: member.id,
        emoji: input.emoji ?? null,
        title: input.title || null,
        content: input.content,
        visibility: input.visibility,
        pinned: input.pinned ?? false,
      })
      .returning({ id: tripNote.id });
    // Le note private non si notificano a nessuno.
    if (input.visibility === 'public')
      await notifyTrip(ctx.db, {
        tripId: input.tripId,
        actorUserId: ctx.user.id,
        type: 'note.created',
        entityId: row!.id,
        data: { title: input.title || input.content.slice(0, 60) },
      });
    return row!;
  }),

  update: authedProcedure
    .input(NoteInput.extend({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { member } = await requireMember(ctx.db, input.tripId, ctx.user.id);
      const [previous] = await ctx.db
        .select({ visibility: tripNote.visibility })
        .from(tripNote)
        .where(and(eq(tripNote.id, input.id), eq(tripNote.tripId, input.tripId)));
      const [row] = await ctx.db
        .update(tripNote)
        .set({
          emoji: input.emoji ?? null,
          title: input.title || null,
          content: input.content,
          visibility: input.visibility,
          pinned: input.pinned ?? false,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(tripNote.id, input.id),
            eq(tripNote.tripId, input.tripId),
            eq(tripNote.memberId, member.id),
          ),
        )
        .returning({ id: tripNote.id });
      if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
      // Una nota resa pubblica è una novità; una nota che resta o diventa privata non si notifica.
      if (input.visibility === 'public')
        await notifyTrip(ctx.db, {
          tripId: input.tripId,
          actorUserId: ctx.user.id,
          type: previous?.visibility === 'public' ? 'note.updated' : 'note.created',
          entityId: row.id,
          data: { title: input.title || input.content.slice(0, 60) },
        });
      return { ok: true };
    }),

  delete: authedProcedure
    .input(z.object({ tripId: z.uuid(), id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { member } = await requireMember(ctx.db, input.tripId, ctx.user.id);
      const [note] = await ctx.db
        .select()
        .from(tripNote)
        .where(and(eq(tripNote.id, input.id), eq(tripNote.tripId, input.tripId)));
      const allowed =
        note &&
        (note.memberId === member.id || (note.visibility === 'public' && member.role === 'owner'));
      if (!allowed) throw new TRPCError({ code: 'NOT_FOUND' });
      await ctx.db.delete(tripNote).where(eq(tripNote.id, note.id));
      return { ok: true };
    }),
});

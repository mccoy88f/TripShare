import { randomBytes } from 'node:crypto';
import { TRPCError } from '@trpc/server';
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { trip, tripInvitation, tripMember, user, type Database } from '@tripshare/db';
import { isLocale } from '@tripshare/shared';
import { listMembers } from '../services/members.js';
import { requireMember } from '../services/trips.js';
import { authedProcedure, publicProcedure, router } from '../trpc/init.js';

const DAYS = 24 * 3600 * 1000;

/** Invito valido (non revocato, non scaduto, con usi disponibili) dato il token. */
export async function findValidInvitation(db: Database, token: string) {
  const [row] = await db
    .select({ invitation: tripInvitation, trip })
    .from(tripInvitation)
    .innerJoin(trip, eq(trip.id, tripInvitation.tripId))
    .where(
      and(
        eq(tripInvitation.token, token),
        isNull(tripInvitation.revokedAt),
        gt(tripInvitation.expiresAt, new Date()),
      ),
    );
  if (!row) return null;
  const { invitation } = row;
  if (invitation.maxUses !== null && invitation.uses >= invitation.maxUses) return null;
  return row;
}

/** Esiste un invito valido per questo indirizzo email (per la modalità "solo su invito")? */
export async function hasPendingInvitationFor(db: Database, email: string) {
  const [row] = await db
    .select({ id: tripInvitation.id })
    .from(tripInvitation)
    .where(
      and(
        sql`lower(${tripInvitation.email}) = ${email.toLowerCase()}`,
        isNull(tripInvitation.revokedAt),
        gt(tripInvitation.expiresAt, new Date()),
        sql`(${tripInvitation.maxUses} is null or ${tripInvitation.uses} < ${tripInvitation.maxUses})`,
      ),
    )
    .limit(1);
  return !!row;
}

export const invitationsRouter = router({
  list: authedProcedure.input(z.object({ tripId: z.uuid() })).query(async ({ ctx, input }) => {
    await requireMember(ctx.db, input.tripId, ctx.user.id, 'editor');
    return ctx.db
      .select()
      .from(tripInvitation)
      .where(
        and(
          eq(tripInvitation.tripId, input.tripId),
          isNull(tripInvitation.revokedAt),
          gt(tripInvitation.expiresAt, new Date()),
        ),
      )
      .orderBy(desc(tripInvitation.createdAt));
  }),

  create: authedProcedure
    .input(
      z.object({
        tripId: z.uuid(),
        email: z.email().optional(),
        /** Nome con cui l'invitato compare nel viaggio finché non accetta. */
        name: z.string().trim().min(1).max(80).optional(),
        /** Se manca: il ruolo dell'invito precedente alla stessa persona, altrimenti "editor". */
        role: z.enum(['editor', 'viewer']).optional(),
        memberId: z.uuid().optional(),
        expiresInDays: z.number().int().min(1).max(90).default(14),
        maxUses: z.number().int().min(1).max(100).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { trip: t } = await requireMember(ctx.db, input.tripId, ctx.user.id, 'editor');
      let memberId = input.memberId;
      const email = input.email?.toLowerCase();
      if (memberId) {
        const [placeholder] = await ctx.db
          .select()
          .from(tripMember)
          .where(
            and(
              eq(tripMember.id, memberId),
              eq(tripMember.tripId, input.tripId),
              isNull(tripMember.userId),
            ),
          );
        if (!placeholder)
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'NOT_A_PLACEHOLDER' });
        if (email && placeholder.invitedEmail !== email) {
          await ctx.db
            .update(tripMember)
            .set({ invitedEmail: email })
            .where(eq(tripMember.id, memberId));
        }
      } else if (email) {
        // Chi è invitato via email compare subito nel viaggio come partecipante in attesa:
        // gli si possono già assegnare spese, biglietti e bagagli. Accettando l'invito ne prende il posto.
        const [alreadyMember] = await ctx.db
          .select({ id: tripMember.id })
          .from(tripMember)
          .innerJoin(user, eq(user.id, tripMember.userId))
          .where(
            and(
              eq(tripMember.tripId, input.tripId),
              isNull(tripMember.removedAt),
              sql`lower(${user.email}) = ${email}`,
            ),
          );
        if (alreadyMember) throw new TRPCError({ code: 'BAD_REQUEST', message: 'ALREADY_MEMBER' });
        const [existing] = await ctx.db
          .select({ id: tripMember.id })
          .from(tripMember)
          .where(
            and(
              eq(tripMember.tripId, input.tripId),
              isNull(tripMember.userId),
              isNull(tripMember.removedAt),
              eq(tripMember.invitedEmail, email),
            ),
          );
        if (existing) memberId = existing.id;
        else {
          const [created] = await ctx.db
            .insert(tripMember)
            .values({
              tripId: input.tripId,
              name: input.name ?? email.split('@')[0]!.slice(0, 80),
              invitedEmail: email,
            })
            .returning({ id: tripMember.id });
          memberId = created!.id;
        }
      }
      let role = input.role;
      if (memberId) {
        const [previous] = await ctx.db
          .select({ role: tripInvitation.role })
          .from(tripInvitation)
          .where(
            and(eq(tripInvitation.tripId, input.tripId), eq(tripInvitation.memberId, memberId)),
          )
          .orderBy(desc(tripInvitation.createdAt))
          .limit(1);
        role ??= previous?.role === 'viewer' ? 'viewer' : undefined;
        // Un solo invito attivo per persona: quello nuovo sostituisce i precedenti.
        await ctx.db
          .update(tripInvitation)
          .set({ revokedAt: new Date() })
          .where(
            and(
              eq(tripInvitation.tripId, input.tripId),
              eq(tripInvitation.memberId, memberId),
              isNull(tripInvitation.revokedAt),
            ),
          );
      }
      const token = randomBytes(18).toString('base64url');
      const [created] = await ctx.db
        .insert(tripInvitation)
        .values({
          tripId: input.tripId,
          token,
          email,
          role: role ?? 'editor',
          memberId,
          // Un invito via email (o per un segnaposto) vale per una persona sola.
          maxUses: email || memberId ? 1 : (input.maxUses ?? null),
          expiresAt: new Date(Date.now() + input.expiresInDays * DAYS),
          createdBy: ctx.user.id,
        })
        .returning();
      const url = `${ctx.env.appOrigin}/invite/${token}`;
      if (input.email) {
        const [existing] = await ctx.db
          .select({ locale: user.locale })
          .from(user)
          .where(eq(user.email, input.email.toLowerCase()));
        const locale = isLocale(existing?.locale)
          ? existing.locale
          : ctx.session!.user.locale === 'en'
            ? 'en'
            : 'it';
        await ctx.email.send({
          to: input.email,
          locale,
          template: {
            kind: 'trip-invite',
            url,
            inviter: ctx.user.name,
            tripTitle: t.title,
            tripEmoji: t.emoji,
          },
        });
      }
      return { ...created!, url, memberId: memberId ?? null };
    }),

  revoke: authedProcedure
    .input(z.object({ tripId: z.uuid(), id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      await requireMember(ctx.db, input.tripId, ctx.user.id, 'editor');
      await ctx.db
        .update(tripInvitation)
        .set({ revokedAt: new Date() })
        .where(and(eq(tripInvitation.id, input.id), eq(tripInvitation.tripId, input.tripId)));
      return { ok: true };
    }),

  /** Anteprima pubblica dell'invito, mostrata prima della registrazione o dell'accesso. */
  preview: publicProcedure
    .input(z.object({ token: z.string().min(10).max(64) }))
    .query(async ({ ctx, input }) => {
      const row = await findValidInvitation(ctx.db, input.token);
      if (!row) return { valid: false as const };
      const members = (await listMembers(ctx.db, row.trip.id)).filter((m) => !m.removed);
      const [inviter] = row.invitation.createdBy
        ? await ctx.db
            .select({ name: user.name })
            .from(user)
            .where(eq(user.id, row.invitation.createdBy))
        : [];
      const alreadyMember = ctx.session
        ? members.some((m) => m.userId === ctx.session!.user.id)
        : false;
      return {
        valid: true as const,
        tripId: row.trip.id,
        alreadyMember,
        trip: {
          title: row.trip.title,
          emoji: row.trip.emoji,
          destination: row.trip.destination,
          startDate: row.trip.startDate,
          endDate: row.trip.endDate,
          coverImage: row.trip.coverImage,
          coverColor: row.trip.coverColor,
        },
        inviter: inviter?.name ?? null,
        email: row.invitation.email,
        role: row.invitation.role,
        members: members.map((m) => ({
          id: m.id,
          name: m.name,
          image: m.image,
          avatarEmoji: m.avatarEmoji,
          avatarColor: m.avatarColor,
          placeholder: m.placeholder,
        })),
        /** Segnaposto che si può prendere in carico ("sono io"). */
        claimable: row.invitation.memberId
          ? members.filter((m) => m.id === row.invitation.memberId)
          : members
              .filter((m) => m.placeholder)
              .map((m) => ({
                id: m.id,
                name: m.name,
                avatarEmoji: m.avatarEmoji,
                avatarColor: m.avatarColor,
              })),
      };
    }),

  accept: authedProcedure
    .input(z.object({ token: z.string().min(10).max(64), claimMemberId: z.uuid().optional() }))
    .mutation(async ({ ctx, input }) => {
      const row = await findValidInvitation(ctx.db, input.token);
      if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'INVITATION_INVALID' });
      const { invitation } = row;
      if (invitation.email && invitation.email !== ctx.user.email.toLowerCase()) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'INVITATION_OTHER_EMAIL' });
      }
      const [existing] = await ctx.db
        .select()
        .from(tripMember)
        .where(and(eq(tripMember.tripId, invitation.tripId), eq(tripMember.userId, ctx.user.id)));
      if (existing && !existing.removedAt) return { tripId: invitation.tripId };

      // Se esiste un partecipante in attesa con la mia email, prendo il suo posto.
      const [pendingForMe] = await ctx.db
        .select({ id: tripMember.id })
        .from(tripMember)
        .where(
          and(
            eq(tripMember.tripId, invitation.tripId),
            isNull(tripMember.userId),
            isNull(tripMember.removedAt),
            eq(tripMember.invitedEmail, ctx.user.email.toLowerCase()),
          ),
        );
      const claimId = invitation.memberId ?? input.claimMemberId ?? pendingForMe?.id;
      await ctx.db.transaction(async (tx) => {
        if (existing) {
          // Rientro dopo essere uscito dal viaggio: il vecchio membro torna attivo.
          await tx
            .update(tripMember)
            .set({ removedAt: null, role: invitation.role })
            .where(eq(tripMember.id, existing.id));
        } else if (claimId) {
          const claimed = await tx
            .update(tripMember)
            .set({
              userId: ctx.user.id,
              role: invitation.role,
              name: ctx.user.name,
              avatarEmoji: null,
              avatarColor: null,
              invitedEmail: null,
            })
            .where(
              and(
                eq(tripMember.id, claimId),
                eq(tripMember.tripId, invitation.tripId),
                isNull(tripMember.userId),
                isNull(tripMember.removedAt),
              ),
            )
            .returning({ id: tripMember.id });
          if (claimed.length === 0)
            throw new TRPCError({ code: 'CONFLICT', message: 'PLACEHOLDER_TAKEN' });
        } else {
          await tx.insert(tripMember).values({
            tripId: invitation.tripId,
            userId: ctx.user.id,
            name: ctx.user.name,
            role: invitation.role,
          });
        }
        await tx
          .update(tripInvitation)
          .set({ uses: sql`${tripInvitation.uses} + 1` })
          .where(eq(tripInvitation.id, invitation.id));
      });
      return { tripId: invitation.tripId };
    }),
});

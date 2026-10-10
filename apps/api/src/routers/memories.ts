import { TRPCError } from '@trpc/server';
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { memory, trip, user } from '@tripshare/db';
import { reversePlace, searchPlaces } from '../nominatim.js';
import { visibleTo } from '../services/memories.js';
import { requireMember } from '../services/trips.js';
import { authedProcedure, router } from '../trpc/init.js';

const userLanguage = (u: { locale?: unknown }) => (u.locale === 'en' ? 'en' : 'it');

const when = sql<Date>`coalesce(${memory.takenAt}, ${memory.createdAt})`;

/**
 * Ricordi: foto e video personali con data e posizione. Ognuno vede i propri; nella scheda di
 * un viaggio si vedono anche quelli che gli altri partecipanti hanno condiviso. Il caricamento
 * dei file è in `/api/memories` (multipart), la lettura in `/api/memories/:id/file`.
 */
export const memoriesRouter = router({
  list: authedProcedure
    .input(z.object({ tripId: z.uuid().optional() }))
    .query(async ({ ctx, input }) => {
      if (input.tripId) await requireMember(ctx.db, input.tripId, ctx.user.id);
      const rows = await ctx.db
        .select({
          id: memory.id,
          kind: memory.kind,
          mimeType: memory.mimeType,
          width: memory.width,
          height: memory.height,
          durationSec: memory.durationSec,
          takenAt: memory.takenAt,
          createdAt: memory.createdAt,
          lat: memory.lat,
          lon: memory.lon,
          placeName: memory.placeName,
          caption: memory.caption,
          shared: memory.shared,
          status: memory.status,
          tripId: memory.tripId,
          tripTitle: trip.title,
          ownerId: user.id,
          ownerName: user.name,
          ownerImage: user.image,
          ownerEmoji: user.avatarEmoji,
          ownerColor: user.avatarColor,
        })
        .from(memory)
        .innerJoin(user, eq(user.id, memory.userId))
        .leftJoin(trip, eq(trip.id, memory.tripId))
        .where(
          input.tripId
            ? and(eq(memory.tripId, input.tripId), visibleTo(ctx.user.id))
            : eq(memory.userId, ctx.user.id),
        )
        .orderBy(desc(when))
        .limit(2000);
      return rows.map(({ ownerId, ownerName, ownerImage, ownerEmoji, ownerColor, ...r }) => ({
        ...r,
        takenAt: r.takenAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
        mine: ownerId === ctx.user.id,
        owner: {
          name: ownerName,
          image: ownerImage,
          avatarEmoji: ownerEmoji,
          avatarColor: ownerColor,
        },
      }));
    }),

  /** Cerca un luogo per nome (OpenStreetMap) per indicare dove è stato scattato un ricordo. */
  searchPlace: authedProcedure
    .input(z.object({ query: z.string().trim().min(2).max(160) }))
    .query(async ({ ctx, input }) => {
      try {
        return await searchPlaces(input.query, userLanguage(ctx.user), ctx.httpFetch);
      } catch {
        throw new TRPCError({ code: 'BAD_GATEWAY', message: 'PLACE_SEARCH_FAILED' });
      }
    }),

  /** Nome del luogo che corrisponde a un punto sulla mappa. */
  reverse: authedProcedure
    .input(z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) }))
    .query(async ({ ctx, input }) => {
      try {
        return {
          label: await reversePlace(input.lat, input.lon, userLanguage(ctx.user), ctx.httpFetch),
        };
      } catch {
        return { label: null };
      }
    }),

  update: authedProcedure
    .input(
      z.object({
        id: z.uuid(),
        caption: z.string().trim().max(1000).nullable().optional(),
        takenAt: z.iso.datetime().nullable().optional(),
        lat: z.number().min(-90).max(90).nullable().optional(),
        lon: z.number().min(-180).max(180).nullable().optional(),
        placeName: z.string().trim().max(200).nullable().optional(),
        shared: z.boolean().optional(),
        tripId: z.uuid().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select()
        .from(memory)
        .where(and(eq(memory.id, input.id), eq(memory.userId, ctx.user.id)));
      if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'MEMORY_NOT_FOUND' });
      if (input.tripId) await requireMember(ctx.db, input.tripId, ctx.user.id);
      const set: Partial<typeof memory.$inferInsert> = {};
      if (input.caption !== undefined) set.caption = input.caption || null;
      if (input.takenAt !== undefined) set.takenAt = input.takenAt ? new Date(input.takenAt) : null;
      if (input.lat !== undefined || input.lon !== undefined) {
        // Le coordinate vanno sempre in coppia.
        const lat = input.lat === undefined ? row.lat : input.lat;
        const lon = input.lon === undefined ? row.lon : input.lon;
        set.lat = lat !== null && lon !== null ? lat : null;
        set.lon = lat !== null && lon !== null ? lon : null;
      }
      if (input.placeName !== undefined) set.placeName = input.placeName || null;
      // Senza posizione non c'è un nome di luogo.
      if (set.lat === null) set.placeName = null;
      if (input.tripId !== undefined) set.tripId = input.tripId;
      if (input.shared !== undefined) set.shared = input.shared;
      if (Object.keys(set).length > 0)
        await ctx.db.update(memory).set(set).where(eq(memory.id, input.id));
      return { ok: true };
    }),

  delete: authedProcedure.input(z.object({ id: z.uuid() })).mutation(async ({ ctx, input }) => {
    const [row] = await ctx.db
      .delete(memory)
      .where(and(eq(memory.id, input.id), eq(memory.userId, ctx.user.id)))
      .returning({ storageName: memory.storageName, thumbName: memory.thumbName });
    if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'MEMORY_NOT_FOUND' });
    await ctx.storage?.removePrivate(row.storageName);
    await ctx.storage?.removePrivate(row.thumbName);
    return { ok: true };
  }),
});

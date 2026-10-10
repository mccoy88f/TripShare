import { TRPCError } from '@trpc/server';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { packingCheck, trip } from '@tripshare/db';
import { applyPlanOps, parseTripDocument, PlanOpSchema } from '@tripshare/shared/trip-format';
import {
  activeMemberCount,
  planError,
  prepareForStorage,
  readPlan,
  removeOrphanPhotos,
} from '../services/plan.js';
import { downloadImage, ImageDownloadError } from '../image-download.js';
import { searchCommons } from '../photo-search.js';
import { requireMember } from '../services/trips.js';
import { authedProcedure, router } from '../trpc/init.js';
import { forecast, forecastWindow, geocode } from '../weather.js';

const localeOf = (l: unknown) => (l === 'en' ? 'en' : 'it');

type PlanOpInput = z.infer<typeof PlanOpSchema>;
const MAX_PHOTO_DOWNLOADS = 8;

/** Sostituisce gli indirizzi https delle foto dei luoghi con file salvati su TripShare. */
async function localizePhotoOps(
  ctx: {
    storage?: { saveImage(data: Buffer, preset: 'place'): Promise<string> };
    settings: { get(key: 'uploads.maxMb'): Promise<number> };
    httpFetch?: typeof fetch;
  },
  ops: PlanOpInput[],
): Promise<{ ops: PlanOpInput[]; failed: string[] }> {
  const failed: string[] = [];
  const external = (url: string | undefined) => !!url && url.startsWith('https://');
  if (
    !ctx.storage ||
    !ops.some((o) =>
      o.type === 'setPlacePhoto'
        ? external(o.photo)
        : o.type === 'upsertPlace' && external(o.place.photo),
    )
  )
    return { ops, failed };
  const maxBytes = (await ctx.settings.get('uploads.maxMb')) * 1024 * 1024;
  const cache = new Map<string, string | null>();
  let downloads = 0;
  const save = async (url: string) => {
    if (cache.has(url)) return cache.get(url)!;
    let saved: string | null = null;
    if (downloads++ < MAX_PHOTO_DOWNLOADS) {
      try {
        saved = await ctx.storage!.saveImage(
          await downloadImage(url, maxBytes, ctx.httpFetch),
          'place',
        );
      } catch {
        saved = null;
      }
    }
    cache.set(url, saved);
    return saved;
  };
  const out: PlanOpInput[] = [];
  for (const op of ops) {
    if (op.type === 'setPlacePhoto' && external(op.photo)) {
      const saved = await save(op.photo!);
      if (saved) out.push({ ...op, photo: saved });
      else failed.push(op.id);
    } else if (op.type === 'upsertPlace' && external(op.place.photo)) {
      const saved = await save(op.place.photo!);
      if (saved) out.push({ ...op, place: { ...op.place, photo: saved } });
      else {
        failed.push(op.place.id ?? op.place.name);
        const { photo: _photo, photoCredit: _credit, ...place } = op.place;
        void _photo;
        void _credit;
        out.push({ ...op, place });
      }
    } else out.push(op);
  }
  return { ops: out, failed };
}

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
      // Le foto indicate con un indirizzo (ad es. dall'assistente) si scaricano e si salvano qui;
      // quelle che non si riescono a scaricare vengono tolte e segnalate, il resto si applica.
      const { ops, failed } = await localizePhotoOps(ctx, input.ops);
      try {
        let before: ReturnType<typeof readPlan> | undefined;
        let after: ReturnType<typeof readPlan> | undefined;
        const result = await ctx.db.transaction(async (tx) => {
          const [row] = await tx.select().from(trip).where(eq(trip.id, input.tripId)).for('update');
          if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
          before = readPlan(row, members, localeOf(ctx.session?.user.locale));
          const next = prepareForStorage(applyPlanOps(before, ops));
          after = next;
          const [updated] = await tx
            .update(trip)
            .set({ plan: next, planVersion: sql`${trip.planVersion} + 1`, updatedAt: new Date() })
            .where(eq(trip.id, input.tripId))
            .returning({ version: trip.planVersion });
          return { version: updated!.version };
        });
        await removeOrphanPhotos(ctx.storage, before, after);
        return { ...result, photoFailures: failed };
      } catch (err) {
        planError(err);
      }
    }),

  /** Cerca foto di un luogo su Wikimedia Commons (libere, con autore e licenza). */
  placePhotoSearch: authedProcedure
    .input(z.object({ tripId: z.uuid(), query: z.string().trim().min(2).max(120) }))
    .query(async ({ ctx, input }) => {
      await requireMember(ctx.db, input.tripId, ctx.user.id, 'editor');
      try {
        return await searchCommons(
          input.query,
          (await ctx.settings.get('general.appName')) ?? ctx.env.APP_NAME,
          ctx.httpFetch,
        );
      } catch (err) {
        throw new TRPCError({
          code: 'BAD_GATEWAY',
          message: err instanceof Error ? err.message : 'PHOTO_SEARCH_UNAVAILABLE',
        });
      }
    }),

  /** Scarica la foto scelta dalla ricerca e la salva; restituisce l'URL da usare nel luogo. */
  placePhotoFromUrl: authedProcedure
    .input(z.object({ tripId: z.uuid(), url: z.url().max(2000) }))
    .mutation(async ({ ctx, input }) => {
      await requireMember(ctx.db, input.tripId, ctx.user.id, 'editor');
      if (!ctx.storage) throw new TRPCError({ code: 'BAD_REQUEST', message: 'NO_STORAGE' });
      const maxMb = await ctx.settings.get('uploads.maxMb');
      try {
        const data = await downloadImage(input.url, maxMb * 1024 * 1024, ctx.httpFetch);
        return { url: await ctx.storage.saveImage(data, 'place') };
      } catch (err) {
        throw new TRPCError({
          code: err instanceof ImageDownloadError ? 'BAD_REQUEST' : 'UNPROCESSABLE_CONTENT',
          message: err instanceof ImageDownloadError ? err.message : 'INVALID_IMAGE',
        });
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
      const previous = readPlan(row, await activeMemberCount(ctx.db, input.tripId));
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
      await removeOrphanPhotos(ctx.storage, previous, plan);
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
    const language = localeOf(ctx.session?.user.locale);
    const find = (q: string | undefined) =>
      q ? geocode(q, language, ctx.httpFetch).catch(() => null) : Promise.resolve(null);
    try {
      // Località di riferimento del viaggio: un luogo con coordinate, la destinazione o, se non
      // si trova (es. "Scozia"), la prima tappa dei giorni.
      const located = plan.places.find((p) => p.location)?.location;
      let base: { name: string; lat: number; lng: number } | null = located
        ? { name: plan.trip.destination.name, ...located }
        : await find(plan.trip.destination.name);
      for (const d of plan.days) {
        if (base) break;
        base = await find(d.route[0]);
      }
      if (!base) return { status: 'NO_LOCATION' as const, days: [] };

      // Ogni giorno usa la sua località: dove si dorme se c'è un alloggio, altrimenti la prima tappa.
      const dayPlace = new Map<string, { name: string; lat: number; lng: number }>();
      for (const d of plan.days) {
        if (d.date < window.from || d.date > window.to) continue;
        const stop = d.stayBookingId ? d.route.at(-1) : d.route[0];
        dayPlace.set(d.date, (await find(stop)) ?? base);
      }
      const points = new Map<string, { name: string; lat: number; lng: number }>();
      const keyOf = (p: { lat: number; lng: number }) => `${p.lat.toFixed(2)},${p.lng.toFixed(2)}`;
      for (const p of [base, ...dayPlace.values()]) points.set(keyOf(p), p);
      const forecasts = new Map<string, Awaited<ReturnType<typeof forecast>>>();
      for (const [key, p] of points)
        forecasts.set(key, await forecast(p, window.from, window.to, ctx.httpFetch));
      const days = forecasts.get(keyOf(base))!.map((w) => {
        const p = dayPlace.get(w.date) ?? base;
        const own = forecasts.get(keyOf(p))?.find((x) => x.date === w.date);
        return { ...(own ?? w), place: own ? p.name : base.name };
      });
      return { status: 'OK' as const, location: base.name, days };
    } catch {
      return { status: 'UNAVAILABLE' as const, days: [] };
    }
  }),
});

import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { searchPlaces } from '../nominatim.js';
import { authedProcedure, router } from '../trpc/init.js';

/** Ricerca di luoghi (OpenStreetMap) per destinazioni, tappe e punto di partenza. */
export const geoRouter = router({
  search: authedProcedure
    .input(z.object({ query: z.string().trim().min(2).max(160) }))
    .query(async ({ ctx, input }) => {
      try {
        return await searchPlaces(
          input.query,
          ctx.user.locale === 'en' ? 'en' : 'it',
          ctx.httpFetch,
        );
      } catch {
        throw new TRPCError({ code: 'BAD_GATEWAY', message: 'PLACE_SEARCH_FAILED' });
      }
    }),
});

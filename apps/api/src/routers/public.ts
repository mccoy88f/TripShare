import { CURRENCY_CODES, LOCALES } from '@tripshare/shared';
import { publicProcedure, router } from '../trpc/init.js';

export const publicRouter = router({
  /** Configurazione pubblica usata dal sito e dall'app prima del login. */
  config: publicProcedure.query(async ({ ctx }) => ({
    appName: (await ctx.settings.get('general.appName')) ?? ctx.env.APP_NAME,
    registrationMode: await ctx.settings.get('registration.mode'),
    locales: LOCALES,
    currencies: CURRENCY_CODES,
    /** Ricerca delle copertine su Unsplash disponibile. */
    unsplash: !!(await ctx.settings.get('unsplash.accessKey')),
    /** Oltre a Wikimedia Commons (sempre attivo), ricerca di foto sul web (SearXNG o Brave). */
    placePhotosWeb: !!(
      (await ctx.settings.get('searxng.url')) || (await ctx.settings.get('brave.apiKey'))
    ),
  })),
});

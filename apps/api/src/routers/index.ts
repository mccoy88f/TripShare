import { router } from '../trpc/init.js';
import { adminRouter } from './admin.js';
import { meRouter } from './me.js';
import { publicRouter } from './public.js';

export const appRouter = router({
  public: publicRouter,
  me: meRouter,
  admin: adminRouter,
});

export type AppRouter = typeof appRouter;

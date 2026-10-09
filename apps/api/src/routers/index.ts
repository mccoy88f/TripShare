import { router } from '../trpc/init.js';
import { adminRouter } from './admin.js';
import { expensesRouter, settlementsRouter } from './expenses.js';
import { invitationsRouter } from './invitations.js';
import { meRouter } from './me.js';
import { planRouter } from './plan.js';
import { tripsRouter } from './trips.js';
import { publicRouter } from './public.js';

export const appRouter = router({
  public: publicRouter,
  me: meRouter,
  admin: adminRouter,
  trips: tripsRouter,
  plan: planRouter,
  invitations: invitationsRouter,
  expenses: expensesRouter,
  settlements: settlementsRouter,
});

export type AppRouter = typeof appRouter;

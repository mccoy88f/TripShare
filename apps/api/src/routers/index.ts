import { router } from '../trpc/init.js';
import { adminRouter } from './admin.js';
import { aiRouter } from './ai.js';
import { expensesRouter, settlementsRouter } from './expenses.js';
import { geoRouter } from './geo.js';
import { invitationsRouter } from './invitations.js';
import { memoriesRouter } from './memories.js';
import { meRouter } from './me.js';
import { notesRouter } from './notes.js';
import { notificationsRouter } from './notifications.js';
import { planRouter } from './plan.js';
import { pushRouter } from './push.js';
import { ticketsRouter } from './tickets.js';
import { tripsRouter } from './trips.js';
import { publicRouter } from './public.js';

export const appRouter = router({
  public: publicRouter,
  me: meRouter,
  admin: adminRouter,
  ai: aiRouter,
  trips: tripsRouter,
  plan: planRouter,
  push: pushRouter,
  geo: geoRouter,
  memories: memoriesRouter,
  notes: notesRouter,
  notifications: notificationsRouter,
  tickets: ticketsRouter,
  invitations: invitationsRouter,
  expenses: expensesRouter,
  settlements: settlementsRouter,
});

export type AppRouter = typeof appRouter;

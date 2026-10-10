import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  Outlet,
  redirect,
} from '@tanstack/react-router';
import { Toaster } from 'sonner';
import { AppLayout } from '@/components/layouts/app-layout';
import { AuthLayout } from '@/components/layouts/auth-layout';
import { PublicLayout } from '@/components/layouts/public-layout';
import { PwaUpdater } from '@/components/pwa';
import { ConfirmHost } from '@/components/confirm';
import { authClient } from '@/lib/auth-client';
import { ForgotPasswordPage, LoginPage, ResetPasswordPage, SignupPage } from '@/routes/auth-pages';
import { LandingPage } from '@/routes/landing';
import { LegalPage, NotFoundPage } from '@/routes/misc-pages';
import { TripsPage } from '@/routes/trips';
import { InvitePage } from '@/routes/trip/invite-page';
import { NewTripPage } from '@/routes/trip/new-trip';
import { TripPage } from '@/routes/trip/trip-page';

const rootRoute = createRootRoute({
  component: () => (
    <>
      <Outlet />
      <Toaster position="top-center" richColors closeButton />
      <PwaUpdater />
      <ConfirmHost />
    </>
  ),
  notFoundComponent: NotFoundPage,
});

// Sito pubblico
const publicLayout = createRoute({
  getParentRoute: () => rootRoute,
  id: 'public',
  component: PublicLayout,
});
const landingRoute = createRoute({
  getParentRoute: () => publicLayout,
  path: '/',
  component: LandingPage,
});
const privacyRoute = createRoute({
  getParentRoute: () => publicLayout,
  path: '/privacy',
  component: () => <LegalPage kind="privacy" />,
});
const termsRoute = createRoute({
  getParentRoute: () => publicLayout,
  path: '/terms',
  component: () => <LegalPage kind="terms" />,
});

// Accesso e registrazione
const authLayout = createRoute({
  getParentRoute: () => rootRoute,
  id: 'auth',
  component: AuthLayout,
});
const loginRoute = createRoute({
  getParentRoute: () => authLayout,
  path: '/login',
  validateSearch: (s: Record<string, unknown>): { redirect?: string } =>
    typeof s.redirect === 'string' ? { redirect: s.redirect } : {},
  component: LoginPage,
});
const signupRoute = createRoute({
  getParentRoute: () => authLayout,
  path: '/signup',
  validateSearch: (s: Record<string, unknown>): { invite?: string; email?: string } => ({
    ...(typeof s.invite === 'string' ? { invite: s.invite } : {}),
    ...(typeof s.email === 'string' ? { email: s.email } : {}),
  }),
  component: SignupPage,
});
const inviteRoute = createRoute({
  getParentRoute: () => authLayout,
  path: '/invite/$token',
  component: InvitePage,
});
const forgotRoute = createRoute({
  getParentRoute: () => authLayout,
  path: '/forgot-password',
  component: ForgotPasswordPage,
});
const resetRoute = createRoute({
  getParentRoute: () => authLayout,
  path: '/reset-password',
  validateSearch: (s: Record<string, unknown>): { token?: string; error?: string } => ({
    ...(typeof s.token === 'string' ? { token: s.token } : {}),
    ...(typeof s.error === 'string' ? { error: s.error } : {}),
  }),
  component: ResetPasswordPage,
});

// App (richiede l'accesso)
const appLayout = createRoute({
  getParentRoute: () => rootRoute,
  path: '/app',
  beforeLoad: async ({ location }) => {
    let session: unknown;
    try {
      session = (await authClient.getSession()).data;
    } catch {
      // Rete assente (PWA offline): si lascia entrare, le pagine useranno i dati in cache.
      return;
    }
    if (!session) throw redirect({ to: '/login', search: { redirect: location.href } });
  },
  component: AppLayout,
});
const tripsRoute = createRoute({
  getParentRoute: () => appLayout,
  path: '/',
  validateSearch: (s: Record<string, unknown>): { verified?: string } =>
    s.verified ? { verified: String(s.verified) } : {},
  component: TripsPage,
});
const newTripRoute = createRoute({
  getParentRoute: () => appLayout,
  path: '/trips/new',
  component: NewTripPage,
});
const tripRoute = createRoute({
  getParentRoute: () => appLayout,
  path: '/trips/$tripId',
  validateSearch: (
    s: Record<string, unknown>,
  ): { tab?: string; view?: string; focus?: string; date?: string } => ({
    ...(typeof s.tab === 'string' ? { tab: s.tab } : {}),
    ...(typeof s.view === 'string' ? { view: s.view } : {}),
    // Dalle notifiche push: elemento da evidenziare e giorno da aprire.
    ...(typeof s.focus === 'string' ? { focus: s.focus } : {}),
    ...(typeof s.date === 'string' ? { date: s.date } : {}),
  }),
  component: TripPage,
});
const profileRoute = createRoute({
  getParentRoute: () => appLayout,
  path: '/profile',
  component: lazyRouteComponent(() => import('@/routes/profile'), 'ProfilePage'),
});
const adminRoute = createRoute({
  getParentRoute: () => appLayout,
  path: '/admin',
  component: lazyRouteComponent(() => import('@/routes/admin'), 'AdminPage'),
});

const routeTree = rootRoute.addChildren([
  publicLayout.addChildren([landingRoute, privacyRoute, termsRoute]),
  authLayout.addChildren([loginRoute, signupRoute, forgotRoute, resetRoute, inviteRoute]),
  appLayout.addChildren([tripsRoute, newTripRoute, tripRoute, profileRoute, adminRoute]),
]);

export const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
  scrollRestoration: true,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

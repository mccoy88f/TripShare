import { useQuery } from '@tanstack/react-query';
import { Link, Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { LogOut, Plane, Plus, UserRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Logo } from '@/components/brand';
import { NotificationBell } from '@/components/notifications';
import { InstallBanner } from '@/components/pwa';
import { PushPrompt } from '@/components/push-prompt';
import { LanguageSwitcher, ThemeToggle } from '@/components/preferences';
import { UserAvatar, type AvatarUser } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { signOut } from '@/lib/auth-client';
import { useCurrentFab } from '@/lib/fab';
import { useRealtime } from '@/lib/realtime';
import { useKeyboard } from '@/lib/keyboard';
import { applyTheme, type Theme } from '@/lib/theme';
import { useTRPC } from '@/lib/trpc';
import { cn } from '@/lib/utils';

type NavItem = { to: string; label: string; icon: typeof Plane; soon?: boolean; exact?: boolean };

export function useMe() {
  const trpc = useTRPC();
  return useQuery(trpc.me.get.queryOptions());
}

/** Avatar in alto a destra su mobile: apre il menu con profilo ed esci. */
function UserMenu({ me, onLogout }: { me: AvatarUser & { email: string }; onLogout: () => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="ml-1 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={me.name}
        >
          <UserAvatar user={me} size="sm" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-60 p-1.5">
        <div className="px-3 py-2">
          <p className="truncate text-sm font-semibold">{me.name}</p>
          <p className="truncate text-xs text-muted-foreground">{me.email}</p>
        </div>
        <div className="my-1 h-px bg-border" />
        <Link
          to="/app/profile"
          onClick={() => setOpen(false)}
          className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium hover:bg-muted"
        >
          <UserRound className="size-4" />
          {t('nav.profile')}
        </Link>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            onLogout();
          }}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium hover:bg-muted"
        >
          <LogOut className="size-4" />
          {t('nav.signOut')}
        </button>
      </PopoverContent>
    </Popover>
  );
}

export function AppLayout() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { data: me } = useMe();
  // Aggiornamenti in tempo reale dei viaggi condivisi, finché si è collegati.
  useRealtime(!!me);

  // Le preferenze salvate nel profilo valgono su ogni dispositivo.
  useEffect(() => {
    if (!me) return;
    if (me.locale !== i18n.resolvedLanguage) void i18n.changeLanguage(me.locale);
    applyTheme(me.theme as Theme);
  }, [me?.locale, me?.theme]); // eslint-disable-line react-hooks/exhaustive-deps

  const items: NavItem[] = [
    { to: '/app', label: t('nav.trips'), icon: Plane, exact: true },
    { to: '/app/profile', label: t('nav.profile'), icon: UserRound },
  ];
  const fab = useCurrentFab();
  const keyboard = useKeyboard();
  const isActive = (item: NavItem) =>
    item.exact
      ? pathname === item.to || pathname.startsWith('/app/trips/')
      : pathname.startsWith(item.to);

  const logout = async () => {
    await signOut();
    await navigate({ to: '/' });
  };

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[260px_1fr]">
      {/* Barra laterale (desktop) */}
      <aside className="sticky top-0 hidden h-dvh flex-col gap-2 border-r bg-card/50 p-4 lg:flex">
        <Logo to="/app" className="px-2 py-2" />
        <nav className="mt-4 grid gap-1">
          {items.map((item) => (
            <NavLink key={item.to} item={item} active={isActive(item)} />
          ))}
        </nav>
        <FabButton fab={fab} variant="sidebar" />
        <div className="flex-1" />
        {me && (
          <div className="flex items-center gap-3 rounded-xl p-2">
            <UserAvatar user={me} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{me.name}</p>
              <p className="truncate text-xs text-muted-foreground">{me.email}</p>
            </div>
            <Button variant="ghost" size="icon" onClick={logout} title={t('nav.signOut')}>
              <LogOut />
            </Button>
          </div>
        )}
        <div className="flex items-center gap-1">
          <NotificationBell />
          <LanguageSwitcher />
          <ThemeToggle />
        </div>
      </aside>

      <div className="flex min-h-dvh flex-col">
        {/* Intestazione (mobile) */}
        <header className="sticky top-0 z-30 flex h-14 items-center gap-1 border-b bg-background/80 px-4 pt-[env(safe-area-inset-top)] backdrop-blur-xl lg:hidden">
          <Logo to="/app" />
          <div className="flex-1" />
          <NotificationBell />
          <ThemeToggle />
          {me && <UserMenu me={me} onLogout={logout} />}
        </header>

        <InstallBanner />
        <PushPrompt />
        <main className="mx-auto w-full max-w-4xl flex-1 px-4 pt-6 pb-[calc(6rem+env(safe-area-inset-bottom))] lg:px-8 lg:pt-10 lg:pb-12">
          <Outlet />
        </main>

        {/* Navigazione in basso (mobile) */}
        {/* Con la tastiera aperta la barra si nasconde, così resta spazio per scrivere. */}
        <nav
          className={cn(
            'fixed inset-x-0 bottom-0 z-30 border-t bg-background/85 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden',
            keyboard.open && 'hidden',
          )}
        >
          <div className="mx-auto grid h-16 max-w-md grid-cols-3 items-center px-2">
            <BottomLink item={items[0]!} active={isActive(items[0]!)} />
            <div className="flex justify-center">
              <FabButton fab={fab} variant="bottom" />
            </div>
            <BottomLink item={items[1]!} active={isActive(items[1]!)} />
          </div>
        </nav>
      </div>
    </div>
  );
}

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const { t } = useTranslation();
  const Icon = item.icon;
  const content = (
    <>
      <Icon className="size-5" />
      <span className="flex-1">{item.label}</span>
      {item.soon && (
        <Badge variant="outline" className="whitespace-nowrap">
          {t('common.soon')}
        </Badge>
      )}
    </>
  );
  const cls = cn(
    'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition',
    active
      ? 'bg-primary/10 text-primary'
      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
    item.soon && 'pointer-events-none opacity-60',
  );
  if (item.soon) return <span className={cls}>{content}</span>;
  return (
    <Link to={item.to} className={cls}>
      {content}
    </Link>
  );
}

function BottomLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  const cls = cn(
    'flex flex-col items-center gap-0.5 text-[11px] font-medium transition',
    active ? 'text-primary' : 'text-muted-foreground',
    item.soon && 'opacity-50',
  );
  const content = (
    <>
      <Icon className="size-5" />
      {item.label}
    </>
  );
  if (item.soon) return <span className={cls}>{content}</span>;
  return (
    <Link to={item.to} className={cls}>
      {content}
    </Link>
  );
}

/** "+" contestuale: l'azione della pagina attiva, altrimenti un nuovo viaggio. */
function FabButton({
  fab,
  variant,
}: {
  fab: { label: string; run: () => void } | null;
  variant: 'bottom' | 'sidebar';
}) {
  const { t } = useTranslation();
  const label = fab?.label ?? t('app.newTrip');
  const cls =
    variant === 'bottom'
      ? '-mt-6 flex size-14 items-center justify-center rounded-full bg-gradient-to-br from-primary to-accent text-white shadow-lg shadow-accent/30 transition active:scale-95'
      : 'mt-3 flex items-center justify-center gap-2 rounded-full bg-gradient-to-br from-primary to-accent px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-accent/25 transition active:scale-[0.98]';
  const content =
    variant === 'bottom' ? (
      <Plus className="size-6" />
    ) : (
      <>
        <Plus className="size-4" />
        {label}
      </>
    );
  if (fab)
    return (
      <button type="button" onClick={fab.run} aria-label={label} title={label} className={cls}>
        {content}
      </button>
    );
  return (
    <Link to="/app/trips/new" aria-label={label} title={label} className={cls}>
      {content}
    </Link>
  );
}

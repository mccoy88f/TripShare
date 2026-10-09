import { Link, Outlet } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Logo } from '@/components/brand';
import { LanguageSwitcher, ThemeToggle } from '@/components/preferences';
import { Button } from '@/components/ui/button';
import { useSession } from '@/lib/auth-client';

export function PublicHeader() {
  const { t } = useTranslation();
  const { data: session } = useSession();
  return (
    <header className="sticky top-0 z-40 border-b border-transparent bg-background/70 pt-[env(safe-area-inset-top)] backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-2 px-4">
        <Logo />
        <div className="flex-1" />
        <LanguageSwitcher />
        <ThemeToggle />
        {session ? (
          <Button asChild size="sm">
            <Link to="/app">{t('nav.openApp')}</Link>
          </Button>
        ) : (
          <>
            <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
              <Link to="/login">{t('nav.signIn')}</Link>
            </Button>
            <Button asChild size="sm">
              <Link to="/signup">{t('nav.signUp')}</Link>
            </Button>
          </>
        )}
      </div>
    </header>
  );
}

export function PublicFooter() {
  const { t } = useTranslation();
  return (
    <footer className="border-t py-8 pb-[calc(2rem+env(safe-area-inset-bottom))]">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 text-sm text-muted-foreground">
        <span>© {new Date().getFullYear()} TripShare</span>
        <div className="flex-1" />
        <Link to="/privacy" className="hover:text-foreground">
          {t('nav.privacy')}
        </Link>
        <Link to="/terms" className="hover:text-foreground">
          {t('nav.terms')}
        </Link>
      </div>
    </footer>
  );
}

export function PublicLayout() {
  return (
    <div className="flex min-h-dvh flex-col">
      <PublicHeader />
      <main className="flex-1">
        <Outlet />
      </main>
      <PublicFooter />
    </div>
  );
}

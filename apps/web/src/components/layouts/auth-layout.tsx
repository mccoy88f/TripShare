import { Outlet } from '@tanstack/react-router';
import { Logo } from '@/components/brand';
import { LanguageSwitcher, ThemeToggle } from '@/components/preferences';

/** Layout delle pagine di accesso: scheda centrata su sfondo sfumato. */
export function AuthLayout() {
  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -top-40 -left-40 size-[480px] rounded-full bg-primary/20 blur-3xl" />
        <div className="absolute -right-40 -bottom-40 size-[480px] rounded-full bg-accent/20 blur-3xl" />
      </div>
      <header className="mx-auto flex h-16 w-full max-w-6xl items-center gap-2 px-4 pt-[env(safe-area-inset-top)]">
        <Logo />
        <div className="flex-1" />
        <LanguageSwitcher />
        <ThemeToggle />
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pt-6 pb-16 sm:items-center sm:pt-0">
        <div className="w-full max-w-md">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

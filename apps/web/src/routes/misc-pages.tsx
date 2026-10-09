import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';

export function LegalPage({ kind }: { kind: 'privacy' | 'terms' }) {
  const { t } = useTranslation();
  return (
    <article className="mx-auto max-w-3xl px-4 py-16">
      <h1 className="text-3xl font-bold tracking-tight">
        {t(kind === 'privacy' ? 'legal.privacyTitle' : 'legal.termsTitle')}
      </h1>
      <p className="mt-4 text-muted-foreground">{t('legal.placeholder')}</p>
    </article>
  );
}

export function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <div className="grid min-h-[60dvh] place-items-center px-4 text-center">
      <div>
        <p className="text-6xl">🧭</p>
        <h1 className="mt-4 text-2xl font-bold">{t('notFound.title')}</h1>
        <Button asChild className="mt-6">
          <Link to="/">{t('notFound.home')}</Link>
        </Button>
      </div>
    </div>
  );
}

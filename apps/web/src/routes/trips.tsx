import { useNavigate, useSearch } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { motion } from 'motion/react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useMe } from '@/components/layouts/app-layout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

export function TripsPage() {
  const { t } = useTranslation();
  const { data: me } = useMe();
  const search = useSearch({ strict: false }) as { verified?: string };
  const navigate = useNavigate();

  useEffect(() => {
    if (search.verified) {
      toast.success(t('auth.verified'));
      void navigate({ to: '/app', search: {}, replace: true });
    }
  }, [search.verified]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-muted-foreground">
            {me ? t('app.hello', { name: me.name.split(' ')[0] }) : ' '}
          </p>
          <h1 className="text-3xl font-bold tracking-tight">{t('app.tripsTitle')}</h1>
        </div>
        <Button variant="accent" disabled>
          <Plus />
          {t('app.newTrip')}
          <Badge className="bg-white/20 text-white">{t('common.soon')}</Badge>
        </Button>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="mt-8 grid place-items-center rounded-xl border border-dashed bg-card/50 px-6 py-16 text-center"
      >
        <div className="relative">
          <span className="text-6xl">🧳</span>
          <span className="absolute -right-6 -bottom-1 text-3xl">✈️</span>
        </div>
        <h2 className="mt-6 text-xl font-semibold">{t('app.noTrips')}</h2>
        <p className="mt-2 max-w-sm text-muted-foreground">{t('app.noTripsText')}</p>
      </motion.div>
    </div>
  );
}

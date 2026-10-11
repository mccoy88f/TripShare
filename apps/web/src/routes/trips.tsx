import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { Bell, CalendarDays, Loader2, Mail, Plus } from 'lucide-react';
import { motion } from 'motion/react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { AvatarStack } from '@/components/avatar-stack';
import { useMe } from '@/components/layouts/app-layout';
import { TripCover } from '@/components/trip-cover';
import { Button } from '@/components/ui/button';
import { formatDateRange, money } from '@/lib/format';
import { useTRPC } from '@/lib/trpc';
import { cn } from '@/lib/utils';

export function BalancePill({
  amount,
  currency,
  className,
}: {
  amount: number;
  currency: string;
  className?: string;
}) {
  const { t } = useTranslation();
  if (amount === 0) {
    return (
      <span
        className={cn(
          'rounded-full bg-white/20 px-2.5 py-1 text-xs font-semibold backdrop-blur',
          className,
        )}
      >
        {t('balance.settled')}
      </span>
    );
  }
  return (
    <span
      className={cn(
        'tabular rounded-full px-2.5 py-1 text-xs font-semibold backdrop-blur',
        amount > 0 ? 'bg-emerald-400/90 text-emerald-950' : 'bg-rose-400/90 text-rose-950',
        className,
      )}
    >
      {amount > 0
        ? t('balance.getBack', { amount: money(amount, currency) })
        : t('balance.owe', { amount: money(-amount, currency) })}
    </span>
  );
}

/**
 * Inviti via email ancora da accettare: compaiono tra i miei viaggi con "Accetta" e "Rifiuta",
 * senza dover cercare il link nell'email.
 */
function PendingInvitations() {
  const { t } = useTranslation();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { data: invitations } = useQuery({
    ...trpc.invitations.mine.queryOptions(),
    staleTime: 15_000,
    refetchInterval: 60_000,
  });
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: trpc.invitations.mine.queryKey() }),
      queryClient.invalidateQueries({ queryKey: trpc.trips.list.queryKey() }),
    ]);
  const accept = useMutation(
    trpc.invitations.accept.mutationOptions({
      onSuccess: async (res) => {
        await refresh();
        toast.success(t('invite.joined'));
        void navigate({ to: '/app/trips/$tripId', params: { tripId: res.tripId } });
      },
      onError: (err) =>
        toast.error(t(`invite.errors.${err.message}`, { defaultValue: t('common.error') })),
    }),
  );
  const decline = useMutation(
    trpc.invitations.decline.mutationOptions({
      onSuccess: refresh,
      onError: () => toast.error(t('common.error')),
    }),
  );
  if (!invitations?.length) return null;
  return (
    <section className="mt-8 grid grid-cols-1 gap-3" aria-label={t('invite.pendingTitle')}>
      <h2 className="flex items-center gap-2 text-sm font-semibold tracking-wide text-muted-foreground uppercase">
        <Mail className="size-4" />
        {t('invite.pendingTitle')}
      </h2>
      {invitations.map((inv) => (
        <div
          key={inv.id}
          className="flex flex-wrap items-center gap-3 rounded-xl border border-accent/40 bg-accent/5 p-4"
        >
          <div className="flex min-w-0 flex-[1_1_16rem] items-center gap-3">
            <span className="text-3xl">{inv.emoji ?? '🧳'}</span>
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{inv.title}</p>
              <p className="text-sm text-muted-foreground">
                {inv.inviter
                  ? t('invite.invitedBy', { name: inv.inviter })
                  : t('invite.invitedGeneric')}
                {inv.startDate ? ` · ${formatDateRange(inv.startDate, inv.endDate)}` : ''}
                {inv.destination ? ` · ${inv.destination}` : ''}
              </p>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="ghost"
              disabled={accept.isPending || decline.isPending}
              onClick={() => decline.mutate({ id: inv.id })}
            >
              {t('invite.decline')}
            </Button>
            <Button
              variant="accent"
              disabled={accept.isPending || decline.isPending}
              onClick={() => accept.mutate({ token: inv.token })}
            >
              {accept.isPending && accept.variables?.token === inv.token && (
                <Loader2 className="animate-spin" />
              )}
              {t('invite.accept')}
            </Button>
          </div>
        </div>
      ))}
    </section>
  );
}

export function TripsPage() {
  const { t } = useTranslation();
  const trpc = useTRPC();
  const { data: me } = useMe();
  const { data: trips } = useQuery(trpc.trips.list.queryOptions());
  const { data: unread } = useQuery({
    ...trpc.notifications.unread.queryOptions(),
    staleTime: 15_000,
  });
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
        <Button asChild variant="accent" className="hidden sm:inline-flex">
          <Link to="/app/trips/new">
            <Plus />
            {t('app.newTrip')}
          </Link>
        </Button>
      </div>

      <PendingInvitations />

      {trips && trips.length === 0 && (
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
          <Button asChild variant="accent" className="mt-6">
            <Link to="/app/trips/new">
              <Plus />
              {t('app.newTrip')}
            </Link>
          </Button>
        </motion.div>
      )}

      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {trips?.map((trip, i) => (
          <motion.div
            key={trip.id}
            className="min-w-0"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.04 }}
          >
            <Link to="/app/trips/$tripId" params={{ tripId: trip.id }} className="group block">
              <TripCover
                coverImage={trip.coverImage}
                coverColor={trip.coverColor}
                className="h-52 rounded-xl shadow-md transition group-hover:-translate-y-0.5 group-hover:shadow-xl"
              >
                <div className="flex h-full flex-col justify-between p-4">
                  <div className="flex items-start justify-between gap-2">
                    {trip.startDate ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-black/25 px-2.5 py-1 text-xs font-medium backdrop-blur">
                        <CalendarDays className="size-3.5" />
                        {formatDateRange(trip.startDate, trip.endDate)}
                      </span>
                    ) : (
                      <span />
                    )}
                    <span className="flex items-center gap-1.5">
                      {(unread?.byTrip[trip.id] ?? 0) > 0 && (
                        <span
                          className="inline-flex items-center gap-1 rounded-full bg-destructive px-2 py-1 text-xs font-bold text-white shadow"
                          title={t('notifications.tripUnread', { count: unread!.byTrip[trip.id] })}
                        >
                          <Bell className="size-3" />
                          {unread!.byTrip[trip.id]}
                        </span>
                      )}
                      <BalancePill amount={trip.myBalance} currency={trip.currency} />
                    </span>
                  </div>
                  <div className="flex items-end justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-2xl font-bold drop-shadow-sm">
                        {trip.emoji ? `${trip.emoji} ` : ''}
                        {trip.title}
                      </p>
                      <p className="truncate text-sm text-white/80">
                        {trip.destination ? `${trip.destination} · ` : ''}
                        {t('trip.totalSpent', { amount: money(trip.total, trip.currency) })}
                      </p>
                    </div>
                    <AvatarStack users={trip.members} max={4} />
                  </div>
                </div>
              </TripCover>
            </Link>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

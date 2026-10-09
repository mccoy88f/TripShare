import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { CalendarDays, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { AvatarStack } from '@/components/avatar-stack';
import { TripCover } from '@/components/trip-cover';
import { UserAvatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useSession } from '@/lib/auth-client';
import { dateRange } from '@/lib/format';
import { useTRPC } from '@/lib/trpc';
import { cn } from '@/lib/utils';

/** Pagina pubblica di un invito: anteprima del viaggio, poi registrazione o accesso e ingresso. */
export function InvitePage() {
  const { t } = useTranslation();
  const trpc = useTRPC();
  const navigate = useNavigate();
  const { token } = useParams({ strict: false }) as { token: string };
  const { data: session, isPending: sessionPending } = useSession();
  const { data: invite, isLoading } = useQuery(
    trpc.invitations.preview.queryOptions({ token }, { enabled: !sessionPending }),
  );
  const [claim, setClaim] = useState<string | null>(null);
  const accept = useMutation(
    trpc.invitations.accept.mutationOptions({
      onSuccess: async ({ tripId }) => {
        toast.success(t('invite.joined'));
        await navigate({ to: '/app/trips/$tripId', params: { tripId } });
      },
      onError: (err) =>
        toast.error(t(`invite.errors.${err.message}`, { defaultValue: t('common.error') })),
    }),
  );

  if (isLoading || sessionPending)
    return <Loader2 className="mx-auto mt-10 animate-spin text-muted-foreground" />;
  if (!invite?.valid) {
    return (
      <Card className="p-8 text-center">
        <p className="text-5xl">🔗</p>
        <p className="mt-4 text-lg font-semibold">{t('invite.invalidTitle')}</p>
        <p className="mt-1 text-muted-foreground">{t('invite.invalidText')}</p>
        <Button asChild variant="outline" className="mt-6">
          <Link to="/">{t('notFound.home')}</Link>
        </Button>
      </Card>
    );
  }

  const { trip } = invite;
  const here = `/invite/${token}`;
  const wrongEmail =
    !!session && !!invite.email && invite.email !== session.user.email.toLowerCase();

  return (
    <Card className="overflow-hidden">
      <TripCover coverImage={trip.coverImage} coverColor={trip.coverColor} className="h-44">
        <div className="flex h-full flex-col justify-end p-5">
          <p className="text-sm text-white/85">
            {invite.inviter ? t('invite.from', { name: invite.inviter }) : t('invite.generic')}
          </p>
          <p className="text-2xl font-bold">
            {trip.emoji ? `${trip.emoji} ` : ''}
            {trip.title}
          </p>
          <div className="mt-1 flex items-center gap-3 text-sm text-white/85">
            {trip.startDate && (
              <span className="inline-flex items-center gap-1.5">
                <CalendarDays className="size-4" />
                {dateRange(trip.startDate, trip.endDate)}
              </span>
            )}
            {trip.destination && <span>📍 {trip.destination}</span>}
          </div>
        </div>
      </TripCover>
      <CardContent className="grid grid-cols-1 gap-5 pt-5">
        <div className="flex items-center gap-3">
          <AvatarStack users={invite.members} max={6} />
          <span className="text-sm text-muted-foreground">
            {t('invite.members', { count: invite.members.length })}
          </span>
        </div>

        {invite.alreadyMember ? (
          <Button asChild size="lg">
            <Link to="/app/trips/$tripId" params={{ tripId: invite.tripId }}>
              {t('invite.open')}
            </Link>
          </Button>
        ) : !session ? (
          <div className="grid grid-cols-1 gap-3">
            <p className="text-sm text-muted-foreground">{t('invite.needAccount')}</p>
            <Button asChild size="lg" variant="accent">
              <Link to="/signup" search={{ invite: token, email: invite.email ?? undefined }}>
                {t('invite.signUp')}
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link to="/login" search={{ redirect: here }}>
                {t('invite.signIn')}
              </Link>
            </Button>
          </div>
        ) : wrongEmail ? (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {t('invite.errors.INVITATION_OTHER_EMAIL')}
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {invite.claimable.length > 0 && (
              <div className="grid grid-cols-1 gap-2">
                <p className="text-sm font-medium">{t('invite.whoAreYou')}</p>
                <div className="grid grid-cols-1 gap-2">
                  {invite.claimable.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setClaim(claim === m.id ? null : m.id)}
                      className={cn(
                        'flex items-center gap-3 rounded-xl border p-3 text-left transition',
                        claim === m.id ? 'border-primary bg-primary/10' : 'hover:bg-muted',
                      )}
                    >
                      <UserAvatar user={m} size="sm" />
                      <span className="flex-1 font-medium">
                        {t('invite.iAm', { name: m.name })}
                      </span>
                    </button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">{t('invite.claimHint')}</p>
              </div>
            )}
            <Button
              size="lg"
              variant="accent"
              disabled={accept.isPending}
              onClick={() => accept.mutate({ token, claimMemberId: claim ?? undefined })}
            >
              {accept.isPending && <Loader2 className="animate-spin" />}
              {t('invite.join')}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

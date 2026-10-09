import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Check, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { isCurrencyCode, paypalMeLink } from '@tripshare/shared';
import { UserAvatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { money, shortDate, todayIso } from '@/lib/format';
import { useTRPC } from '@/lib/trpc';
import type { TripDetail } from '@/lib/types';
import { cn } from '@/lib/utils';

type Transfer = TripDetail['ledger']['transfers'][number];

export function BalancesTab({ trip }: { trip: TripDetail }) {
  const { t } = useTranslation();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { data: settlements } = useQuery(trpc.settlements.list.queryOptions({ tripId: trip.id }));
  const [paypalPending, setPaypalPending] = useState<Transfer | null>(null);
  const members = Object.fromEntries(trip.members.map((m) => [m.id, m]));
  const nameOf = (id: string) =>
    id === trip.myMemberId ? t('expense.you') : (members[id]?.name ?? '?');

  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: trpc.trips.get.queryKey({ id: trip.id }) }),
      queryClient.invalidateQueries({
        queryKey: trpc.settlements.list.queryKey({ tripId: trip.id }),
      }),
      queryClient.invalidateQueries({ queryKey: trpc.trips.list.queryKey() }),
    ]);
  const record = useMutation(
    trpc.settlements.create.mutationOptions({
      onSuccess: async () => {
        await invalidate();
        toast.success(t('balance.recorded'));
      },
      onError: () => toast.error(t('common.error')),
    }),
  );
  const remove = useMutation(
    trpc.settlements.delete.mutationOptions({
      onSuccess: invalidate,
      onError: () => toast.error(t('common.error')),
    }),
  );

  const balances = trip.members
    .filter((m) => !m.removed || (trip.ledger.balances[m.id] ?? 0) !== 0)
    .map((m) => ({ member: m, amount: trip.ledger.balances[m.id] ?? 0 }))
    .sort((a, b) => b.amount - a.amount);
  const max = Math.max(1, ...balances.map((b) => Math.abs(b.amount)));
  const canAct = (tr: Transfer) =>
    trip.role !== 'viewer' || tr.from === trip.myMemberId || tr.to === trip.myMemberId;
  const currency = isCurrencyCode(trip.currency) ? trip.currency : 'EUR';

  return (
    <div className="grid grid-cols-1 gap-6 pb-8">
      <Card className="p-2">
        {balances.map(({ member, amount }) => (
          <div key={member.id} className="flex items-center gap-3 rounded-lg px-3 py-2.5">
            <UserAvatar user={member} size="sm" />
            <span className="w-28 truncate text-sm font-medium sm:w-40">{nameOf(member.id)}</span>
            <div className="relative h-2 flex-1 rounded-full bg-muted">
              <div
                className={cn(
                  'absolute top-0 h-2 rounded-full',
                  amount >= 0 ? 'left-1/2 bg-success' : 'right-1/2 bg-destructive',
                )}
                style={{ width: `${(Math.abs(amount) / max) * 50}%` }}
              />
              <div className="absolute top-[-3px] left-1/2 h-3.5 w-px bg-border" />
            </div>
            <span
              className={cn(
                'tabular w-24 text-right text-sm font-semibold',
                amount > 0
                  ? 'text-success'
                  : amount < 0
                    ? 'text-destructive'
                    : 'text-muted-foreground',
              )}
            >
              {amount > 0 ? '+' : ''}
              {money(amount, trip.currency)}
            </span>
          </div>
        ))}
      </Card>

      <section>
        <h3 className="mb-2 px-1 text-sm font-semibold">{t('balance.suggested')}</h3>
        {trip.ledger.transfers.length === 0 ? (
          <div className="rounded-xl border border-dashed px-6 py-10 text-center">
            <span className="text-4xl">🎉</span>
            <p className="mt-3 font-semibold">{t('balance.allSettled')}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3">
            {trip.ledger.transfers.map((tr) => {
              const to = members[tr.to];
              const paypal =
                tr.from === trip.myMemberId && to?.paypalMe
                  ? paypalMeLink(to.paypalMe, tr.amount, currency)
                  : null;
              return (
                <Card key={`${tr.from}-${tr.to}`} className="flex flex-wrap items-center gap-3 p-4">
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    {members[tr.from] && <UserAvatar user={members[tr.from]!} size="sm" />}
                    <span className="truncate font-medium">{nameOf(tr.from)}</span>
                    <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
                    {to && <UserAvatar user={to} size="sm" />}
                    <span className="truncate font-medium">{nameOf(tr.to)}</span>
                  </div>
                  <span className="tabular text-lg font-bold">
                    {money(tr.amount, trip.currency)}
                  </span>
                  {canAct(tr) && (
                    <div className="flex w-full flex-wrap justify-end gap-2 sm:w-auto">
                      {paypal && (
                        <Button
                          size="sm"
                          className="bg-[#0070ba] text-white hover:bg-[#005ea6]"
                          onClick={() => {
                            window.open(paypal, '_blank', 'noopener');
                            setPaypalPending(tr);
                          }}
                        >
                          {t('balance.payPaypal')}
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={record.isPending}
                        onClick={() => {
                          if (
                            !confirm(
                              t('balance.confirmManual', {
                                from: nameOf(tr.from),
                                to: nameOf(tr.to),
                                amount: money(tr.amount, trip.currency),
                              }),
                            )
                          )
                            return;
                          record.mutate({
                            tripId: trip.id,
                            fromMemberId: tr.from,
                            toMemberId: tr.to,
                            amount: tr.amount,
                            method: 'manual',
                            date: todayIso(),
                          });
                        }}
                      >
                        <Check />
                        {t('balance.markPaid')}
                      </Button>
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </section>

      {settlements && settlements.length > 0 && (
        <section>
          <h3 className="mb-2 px-1 text-sm font-semibold">{t('balance.history')}</h3>
          <div className="divide-y rounded-xl border bg-card">
            {settlements.map((s) => (
              <div key={s.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                <span className="text-lg">{s.method === 'paypal' ? '💳' : '🤝'}</span>
                <span className="min-w-0 flex-1 truncate">
                  {t('balance.paidTo', { from: nameOf(s.fromMemberId), to: nameOf(s.toMemberId) })}
                  <span className="text-muted-foreground"> · {shortDate(s.date)}</span>
                </span>
                <span className="tabular font-semibold">{money(s.amount, trip.currency)}</span>
                {(s.fromMemberId === trip.myMemberId ||
                  s.toMemberId === trip.myMemberId ||
                  trip.role === 'owner') && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-8 text-muted-foreground"
                    aria-label={t('expense.delete')}
                    onClick={() =>
                      confirm(t('balance.confirmDelete')) &&
                      remove.mutate({ tripId: trip.id, id: s.id })
                    }
                  >
                    <Trash2 />
                  </Button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      <Dialog open={!!paypalPending} onOpenChange={(open) => !open && setPaypalPending(null)}>
        <DialogContent
          title={t('balance.paypalDoneTitle')}
          description={
            paypalPending
              ? t('balance.paypalDoneText', {
                  amount: money(paypalPending.amount, trip.currency),
                  to: nameOf(paypalPending.to),
                })
              : undefined
          }
        >
          <div className="flex justify-end gap-2 pt-4">
            <Button variant="ghost" onClick={() => setPaypalPending(null)}>
              {t('balance.notYet')}
            </Button>
            <Button
              onClick={() => {
                if (!paypalPending) return;
                record.mutate({
                  tripId: trip.id,
                  fromMemberId: paypalPending.from,
                  toMemberId: paypalPending.to,
                  amount: paypalPending.amount,
                  method: 'paypal',
                  date: todayIso(),
                });
                setPaypalPending(null);
              }}
            >
              <Check />
              {t('balance.yesPaid')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

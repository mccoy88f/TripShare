import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { memberBreakdown } from '@tripshare/shared';
import { UserAvatar } from '@/components/ui/avatar';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { money, shortDate } from '@/lib/format';
import { useTRPC } from '@/lib/trpc';
import type { TripDetail } from '@/lib/types';
import { cn } from '@/lib/utils';

type Member = TripDetail['members'][number];

/**
 * Da quali voci nasce il saldo di una persona: per ogni spesa quanto ha anticipato e quanto gli
 * spetta, più i rimborsi già registrati. Il saldo non si calcola spesa per spesa "saldata": è la
 * somma di tutto, e un rimborso registrato lo riduce.
 */
export function BalanceDetail({
  trip,
  member,
  balance,
  nameOf,
  onClose,
}: {
  trip: TripDetail;
  member: Member;
  balance: number;
  nameOf: (id: string) => string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const trpc = useTRPC();
  const expenses = useQuery(trpc.expenses.list.queryOptions({ tripId: trip.id }));
  const settlements = useQuery(trpc.settlements.list.queryOptions({ tripId: trip.id }));
  const ready = expenses.data && settlements.data;

  const breakdown = ready
    ? memberBreakdown(
        member.id,
        // Le spese solo previste non contano nei saldi finché non sono pagate.
        expenses.data!.filter((e) => e.status !== 'planned'),
        settlements.data!.map((s) => ({
          id: s.id,
          date: s.date,
          from: s.fromMemberId,
          to: s.toMemberId,
          amount: s.amount,
        })),
      )
    : null;
  const items = breakdown
    ? [...breakdown.items].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    : [];
  const sign = (n: number) => (n > 0 ? '+' : '') + money(n, trip.currency);
  const tone = (n: number) =>
    n > 0 ? 'text-success' : n < 0 ? 'text-destructive' : 'text-muted-foreground';

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={t('balance.detailTitle', { name: nameOf(member.id) })}>
        <div className="flex items-center gap-3 pt-1">
          <UserAvatar user={member} size="sm" />
          <span className="min-w-0 flex-1 text-sm text-muted-foreground">
            {balance > 0
              ? t('balance.detailGetsBack')
              : balance < 0
                ? t('balance.detailOwes')
                : t('balance.settled')}
          </span>
          <span className={cn('tabular text-lg font-bold', tone(balance))}>{sign(balance)}</span>
        </div>
        <p className="mt-2 text-[13px] text-muted-foreground">{t('balance.detailHint')}</p>

        {!breakdown && <Loader2 className="mx-auto mt-8 animate-spin text-muted-foreground" />}
        {breakdown && items.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {t('balance.detailEmpty')}
          </p>
        )}
        {breakdown && items.length > 0 && (
          <div className="mt-3 max-h-[55dvh] divide-y overflow-y-auto rounded-xl border bg-card">
            {items.map((i) => (
              <div
                key={`${i.type}-${i.id}`}
                className="flex items-start gap-3 px-3.5 py-2.5 text-sm"
              >
                <span className="text-lg leading-6">
                  {i.type === 'expense' ? (i.emoji ?? '🧾') : '🤝'}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">
                    {i.type === 'expense'
                      ? i.title
                      : i.delta > 0
                        ? t('balance.detailGave', { name: nameOf(i.other) })
                        : t('balance.detailReceived', { name: nameOf(i.other) })}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {shortDate(i.date)}
                    {i.type === 'expense' &&
                      ` · ${t('balance.detailPaidOwed', {
                        paid: money(i.paid, trip.currency),
                        owed: money(i.owed, trip.currency),
                      })}`}
                  </span>
                </span>
                <span className={cn('tabular font-semibold', tone(i.delta))}>{sign(i.delta)}</span>
              </div>
            ))}
          </div>
        )}
        {breakdown && (
          <div className="mt-3 flex items-center justify-between px-1 text-sm font-semibold">
            <span>{t('balance.detailTotal')}</span>
            <span className={cn('tabular', tone(breakdown.total))}>{sign(breakdown.total)}</span>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

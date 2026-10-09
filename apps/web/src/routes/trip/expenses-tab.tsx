import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EXPENSE_CATEGORIES, type ExpenseCategory } from '@tripshare/shared';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { longDate, money, todayIso } from '@/lib/format';
import { useTRPC } from '@/lib/trpc';
import type { ExpenseT, TripDetail } from '@/lib/types';
import { cn } from '@/lib/utils';
import { ExpenseDialog } from './expense-dialog';

export function ExpensesTab({ trip }: { trip: TripDetail }) {
  const { t } = useTranslation();
  const trpc = useTRPC();
  const { data: expenses } = useQuery(trpc.expenses.list.queryOptions({ tripId: trip.id }));
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<ExpenseT | undefined>();
  const setStatus = useMutation(
    trpc.expenses.setStatus.mutationOptions({
      onSuccess: async () => {
        await Promise.all([
          queryClient.invalidateQueries({
            queryKey: trpc.expenses.list.queryKey({ tripId: trip.id }),
          }),
          queryClient.invalidateQueries({ queryKey: trpc.trips.get.queryKey({ id: trip.id }) }),
          queryClient.invalidateQueries({ queryKey: trpc.trips.list.queryKey() }),
        ]);
        toast.success(t('expense.markedPaid'));
      },
      onError: () => toast.error(t('common.error')),
    }),
  );
  const canEdit = trip.role !== 'viewer';
  const names = Object.fromEntries(
    trip.members.map((m) => [m.id, m.id === trip.myMemberId ? t('expense.you') : m.name]),
  );

  if (!expenses) return <Loader2 className="mx-auto mt-10 animate-spin text-muted-foreground" />;
  if (expenses.length === 0) {
    return (
      <div className="grid place-items-center rounded-xl border border-dashed px-6 py-14 text-center">
        <span className="text-5xl">🧾</span>
        <p className="mt-4 font-semibold">{t('expense.empty')}</p>
        <p className="mt-1 text-sm text-muted-foreground">{t('expense.emptyText')}</p>
      </div>
    );
  }

  const planned = expenses.filter((e) => e.status === 'planned');
  const groups = new Map<string, ExpenseT[]>();
  for (const e of expenses.filter((x) => x.status !== 'planned'))
    groups.set(e.date, [...(groups.get(e.date) ?? []), e]);
  const emojiOf = (e: ExpenseT) =>
    e.emoji ?? EXPENSE_CATEGORIES[e.category as ExpenseCategory]?.emoji ?? '📦';

  return (
    <div className="grid grid-cols-1 gap-6 pb-8">
      {planned.length > 0 && (
        <section>
          <h3 className="mb-2 flex items-center justify-between px-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            <span>⏳ {t('expense.toPay')}</span>
            <span className="tabular normal-case">
              {money(
                planned.reduce((a, e) => a + e.amountTrip, 0),
                trip.currency,
              )}
            </span>
          </h3>
          <div className="divide-y rounded-xl border border-dashed border-warning bg-warning/5">
            {planned.map((e) => (
              <div key={e.id} className="flex items-center gap-3 px-4 py-3">
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  onClick={() => canEdit && setEditing(e)}
                >
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-secondary text-xl opacity-80">
                    {emojiOf(e)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{e.title}</span>
                    <span className="block truncate text-sm text-muted-foreground">
                      {longDate(e.date)} ·{' '}
                      {t('expense.willPayName', {
                        name: e.payers.map((p) => names[p.memberId] ?? '?').join(', '),
                      })}
                    </span>
                  </span>
                  <span className="tabular font-semibold">{money(e.amount, e.currency)}</span>
                </button>
                {canEdit && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={setStatus.isPending}
                    onClick={() =>
                      setStatus.mutate({
                        tripId: trip.id,
                        id: e.id,
                        status: 'paid',
                        date: todayIso(),
                      })
                    }
                  >
                    <Check />
                    <span className="hidden sm:inline">{t('expense.markPaid')}</span>
                  </Button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
      {[...groups.entries()].map(([date, items]) => (
        <section key={date}>
          <h3 className="mb-2 px-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            {longDate(date)}
          </h3>
          <div className="divide-y rounded-xl border bg-card">
            {items.map((e) => {
              const myShare = e.shares.find((s) => s.memberId === trip.myMemberId)?.amount ?? 0;
              const myPaid = e.payers.find((p) => p.memberId === trip.myMemberId)?.amount ?? 0;
              const delta = Math.round(((myPaid - myShare) * e.amountTrip) / e.amount);
              const payers = e.payers.map((p) => names[p.memberId] ?? '?').join(', ');
              const emoji = emojiOf(e);
              return (
                <button
                  key={e.id}
                  onClick={() => canEdit && setEditing(e)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-muted/50"
                >
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-secondary text-xl">
                    {emoji}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{e.title}</p>
                    <p className="truncate text-sm text-muted-foreground">
                      {e.payers.length === 1 && e.payers[0]!.memberId === trip.myMemberId
                        ? t('expense.paidByYou')
                        : t('expense.paidByName', { name: payers })}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="tabular font-semibold">{money(e.amount, e.currency)}</p>
                    {e.currency !== trip.currency && (
                      <p className="tabular text-xs text-muted-foreground">
                        ≈ {money(e.amountTrip, trip.currency)}
                      </p>
                    )}
                    {delta !== 0 && (
                      <p
                        className={cn(
                          'tabular text-xs font-medium',
                          delta > 0 ? 'text-success' : 'text-destructive',
                        )}
                      >
                        {delta > 0
                          ? t('expense.lent', { amount: money(delta, trip.currency) })
                          : t('expense.borrowed', { amount: money(-delta, trip.currency) })}
                      </p>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      ))}
      <ExpenseDialog
        trip={trip}
        expense={editing}
        open={!!editing}
        onOpenChange={(open) => !open && setEditing(undefined)}
      />
    </div>
  );
}

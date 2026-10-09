import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  EXPENSE_CATEGORIES,
  fromMinor,
  isCurrencyCode,
  toMinor,
  type CurrencyCode,
  type ExpenseCategory,
} from '@tripshare/shared';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/input';
import { longDate, money, todayIso } from '@/lib/format';
import { useTRPC } from '@/lib/trpc';
import type { ExpenseT, TripDetail } from '@/lib/types';
import { cn } from '@/lib/utils';
import { ALL, ExpenseDialog, paidByEveryone } from './expense-dialog';
import { searchId } from '@/lib/search-focus';

export function ExpensesTab({ trip }: { trip: TripDetail }) {
  const { t } = useTranslation();
  const trpc = useTRPC();
  const { data: expenses } = useQuery(trpc.expenses.list.queryOptions({ tripId: trip.id }));
  const [editing, setEditing] = useState<ExpenseT | undefined>();
  const [paying, setPaying] = useState<ExpenseT | null>(null);
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
              <div
                key={e.id}
                {...searchId(`expense:${e.id}`)}
                className="flex items-center gap-3 px-4 py-3"
              >
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
                    onClick={() => setPaying(e)}
                    aria-label={t('expense.markPaid')}
                    title={t('expense.markPaid')}
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
                  {...searchId(`expense:${e.id}`)}
                  onClick={() => canEdit && setEditing(e)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-muted/50"
                >
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-secondary text-xl">
                    {emoji}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{e.title}</p>
                    <p className="truncate text-sm text-muted-foreground">
                      {paidByEveryone(e)
                        ? t('expense.paidByEveryone')
                        : e.payers.length === 1 && e.payers[0]!.memberId === trip.myMemberId
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
      {paying && <PayDialog trip={trip} expense={paying} onClose={() => setPaying(null)} />}
      <ExpenseDialog
        trip={trip}
        expense={editing}
        open={!!editing}
        onOpenChange={(open) => !open && setEditing(undefined)}
      />
    </div>
  );
}

/** Pagamento di una spesa "da pagare": tutto o una parte (acconto), da una persona o da tutti. */
function PayDialog({
  trip,
  expense,
  onClose,
}: {
  trip: TripDetail;
  expense: ExpenseT;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const currency = (isCurrencyCode(expense.currency) ? expense.currency : 'EUR') as CurrencyCode;
  const [amount, setAmount] = useState(String(fromMinor(expense.amount, currency)));
  const [payer, setPayer] = useState(expense.payers[0]?.memberId ?? trip.myMemberId);
  const [date, setDate] = useState(todayIso());
  const pay = useMutation(trpc.expenses.pay.mutationOptions());
  const minor = /^\s*\d+([.,]\d{0,4})?\s*$/.test(amount)
    ? toMinor(Number(amount.trim().replace(',', '.')), currency)
    : 0;
  const valid = minor > 0 && minor <= expense.amount;
  const partial = valid && minor < expense.amount;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    try {
      await pay.mutateAsync({
        tripId: trip.id,
        id: expense.id,
        amount: minor,
        payer: payer === ALL ? 'all' : payer,
        date,
      });
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: trpc.expenses.list.queryKey({ tripId: trip.id }),
        }),
        queryClient.invalidateQueries({ queryKey: trpc.trips.get.queryKey({ id: trip.id }) }),
        queryClient.invalidateQueries({ queryKey: trpc.trips.list.queryKey() }),
      ]);
      toast.success(partial ? t('expense.partialPaid') : t('expense.markedPaid'));
      onClose();
    } catch {
      toast.error(t('common.error'));
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={t('expense.payTitle')}
        description={`${expense.title} · ${money(expense.amount, currency)}`}
      >
        <form onSubmit={submit} className="grid grid-cols-1 gap-4 pt-2">
          <Field
            label={t('expense.payAmount')}
            htmlFor="pay-amount"
            hint={
              partial
                ? t('expense.payRemaining', { amount: money(expense.amount - minor, currency) })
                : t('expense.payFull')
            }
            error={amount && !valid ? t('expense.payInvalid') : null}
          >
            <div className="flex items-center gap-2">
              <Input
                id="pay-amount"
                inputMode="decimal"
                className="tabular text-lg font-semibold"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
              <span className="text-sm text-muted-foreground">{currency}</span>
            </div>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('expense.paidBy')} htmlFor="pay-payer">
              <Select id="pay-payer" value={payer} onChange={(e) => setPayer(e.target.value)}>
                <option value={ALL}>👥 {t('expense.everyone')}</option>
                {trip.members
                  .filter((m) => !m.removed)
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.id === trip.myMemberId ? t('expense.me', { name: m.name }) : m.name}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field label={t('expense.date')} htmlFor="pay-date">
              <Input
                id="pay-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </Field>
          </div>
          <Button
            type="submit"
            size="lg"
            className="justify-self-end"
            disabled={!valid || pay.isPending}
          >
            {pay.isPending ? <Loader2 className="animate-spin" /> : <Check />}
            {partial ? t('expense.payPartial') : t('expense.markPaid')}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

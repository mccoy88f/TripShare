import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, RefreshCw, Trash2 } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_KEYS,
  categoryLabel,
  isCurrencyCode,
  type CurrencyCode,
  type ExpenseCategory,
  type Locale,
} from '@tripshare/shared';
import type { BudgetItem, TripDocument } from '@tripshare/shared/trip-format';
import { budgetContext, summarizeBudget } from '@tripshare/shared/trip-format/budget';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Step, StepForm } from '@/components/ui/steps';
import { Field, Input, Select } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { money } from '@/lib/format';
import { usePlan, usePlanOps } from '@/lib/plan';
import { useTRPC } from '@/lib/trpc';
import type { TripDetail } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useOnAdd } from '@/lib/fab';
import { moneyDraft, MoneyFields, moneyFromDraft, moneyLabel, textareaClass } from './fields';

export function BudgetTab({ trip }: { trip: TripDetail }) {
  const { t, i18n } = useTranslation();
  const locale = (i18n.resolvedLanguage ?? 'it') as Locale;
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { data } = usePlan(trip.id);
  const { data: expenses } = useQuery(trpc.expenses.list.queryOptions({ tripId: trip.id }));
  const { apply, pending } = usePlanOps(trip.id);
  const [editing, setEditing] = useState<BudgetItem | 'new' | null>(null);
  useOnAdd('budget', () => setEditing('new'));
  const [loadingRates, setLoadingRates] = useState(false);
  const canEdit = trip.role !== 'viewer';
  if (!data || !expenses)
    return <Loader2 className="mx-auto mt-10 animate-spin text-muted-foreground" />;

  const { plan } = data;
  const travelers = Math.max(1, trip.members.filter((m) => !m.removed).length);
  const summary = summarizeBudget(plan, budgetContext(plan, travelers));
  const spent = trip.ledger.total;
  // Le spese "da pagare" sono già impegnate: riducono il rimanente.
  const toPay = trip.ledger.planned;
  const left = summary.total - spent - toPay;
  const actualByCategory: Record<string, number> = {};
  for (const e of expenses.filter((x) => x.status !== 'planned'))
    actualByCategory[e.category] = (actualByCategory[e.category] ?? 0) + e.amountTrip;
  const categories = EXPENSE_CATEGORY_KEYS.filter(
    (c) => summary.byCategory[c] || actualByCategory[c],
  );
  const max = Math.max(
    1,
    ...categories.map((c) => Math.max(summary.byCategory[c] ?? 0, actualByCategory[c] ?? 0)),
  );

  const fetchRates = async () => {
    setLoadingRates(true);
    try {
      const rates: Partial<Record<CurrencyCode, number>> = {};
      for (const from of summary.missingRates) {
        const r = await queryClient.fetchQuery(
          trpc.expenses.rate.queryOptions({ from, to: trip.currency as CurrencyCode }),
        );
        rates[from] = Number(r.rate.toFixed(6));
      }
      await apply([{ type: 'setExchangeRates', rates }]);
    } catch {
      // errore già mostrato o tasso non disponibile
    } finally {
      setLoadingRates(false);
    }
  };

  const stat = (label: string, value: number, tone?: 'good' | 'bad') => (
    <Card className="p-4">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p
        className={cn(
          'tabular mt-1 text-xl font-bold',
          tone === 'good' && 'text-success',
          tone === 'bad' && 'text-destructive',
        )}
      >
        {money(value, trip.currency)}
      </p>
    </Card>
  );

  return (
    <div className="grid grid-cols-1 gap-6 pb-8">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fit,minmax(9rem,1fr))]">
        {stat(t('budget.planned'), summary.total)}
        {stat(t('budget.perPerson'), Math.round(summary.total / travelers))}
        {stat(t('budget.spent'), spent)}
        {toPay > 0 && stat(t('expense.toPay'), toPay)}
        {stat(t('budget.left'), left, left >= 0 ? 'good' : 'bad')}
      </div>

      {summary.missingRates.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl bg-warning/15 px-4 py-3 text-sm">
          <span className="flex-1">
            {t('budget.missingRates', { currencies: summary.missingRates.join(', ') })}
          </span>
          {canEdit && (
            <Button size="sm" variant="outline" disabled={loadingRates} onClick={fetchRates}>
              {loadingRates ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              {t('budget.useEcbRates')}
            </Button>
          )}
        </div>
      )}
      {summary.pendingWithoutAmount > 0 && (
        <p className="px-1 text-sm text-muted-foreground">
          {t('budget.pending', { count: summary.pendingWithoutAmount })}
        </p>
      )}

      {categories.length > 0 && (
        <Card className="grid grid-cols-1 gap-3 p-4">
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2.5 rounded-full bg-primary/35" /> {t('budget.planned')}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2.5 rounded-full bg-accent" /> {t('budget.spent')}
            </span>
          </div>
          {categories.map((c) => (
            <div key={c} className="grid grid-cols-1 gap-1">
              <div className="flex items-center justify-between text-sm">
                <span>
                  {EXPENSE_CATEGORIES[c].emoji} {categoryLabel(c, locale)}
                </span>
                <span className="tabular text-muted-foreground">
                  {money(actualByCategory[c] ?? 0, trip.currency)} /{' '}
                  {money(summary.byCategory[c] ?? 0, trip.currency)}
                </span>
              </div>
              <div className="relative h-2.5 rounded-full bg-muted">
                <div
                  className="absolute inset-y-0 left-0 rounded-full bg-primary/35"
                  style={{ width: `${((summary.byCategory[c] ?? 0) / max) * 100}%` }}
                />
                <div
                  className={cn(
                    'absolute inset-y-0 left-0 h-1.5 translate-y-0.5 rounded-full',
                    (actualByCategory[c] ?? 0) > (summary.byCategory[c] ?? 0)
                      ? 'bg-destructive'
                      : 'bg-accent',
                  )}
                  style={{ width: `${((actualByCategory[c] ?? 0) / max) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </Card>
      )}

      <section className="grid grid-cols-1 gap-3">
        <div className="flex items-center justify-between">
          <h3 className="px-1 text-sm font-semibold">{t('budget.items')}</h3>
        </div>
        {summary.lines.length === 0 && (
          <p className="rounded-xl border border-dashed px-6 py-8 text-center text-sm text-muted-foreground">
            {t('budget.empty')}
          </p>
        )}
        <div className="divide-y rounded-xl border bg-card">
          {summary.lines.map(({ item, total }) => (
            <div
              key={item.id}
              className={cn('flex items-center gap-3 px-4 py-3', !item.included && 'opacity-55')}
            >
              <span className="text-xl">
                {item.emoji ?? EXPENSE_CATEGORIES[item.category].emoji}
              </span>
              <button
                className="min-w-0 flex-1 text-left"
                disabled={!canEdit}
                onClick={() => setEditing(item)}
              >
                <p className="truncate font-medium">{item.title}</p>
                <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  <Badge
                    variant={
                      item.status === 'booked'
                        ? 'success'
                        : item.status === 'pending'
                          ? 'warning'
                          : 'outline'
                    }
                  >
                    {t(`budget.status.${item.status}`)}
                  </Badge>
                  {item.amount && moneyLabel(item.amount, t, money)}
                  {item.notes && ` · ${item.notes}`}
                </p>
              </button>
              <span className="tabular w-24 text-right font-semibold">
                {total !== null ? money(total, trip.currency) : '—'}
              </span>
              {canEdit && (
                <Switch
                  checked={item.included}
                  disabled={pending}
                  aria-label={t('budget.included')}
                  onCheckedChange={(included) =>
                    apply([{ type: 'upsertBudgetItem', item: { ...item, included } }])
                  }
                />
              )}
            </div>
          ))}
        </div>
      </section>
      {editing && (
        <BudgetDialog
          tripId={trip.id}
          plan={plan}
          item={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function BudgetDialog({
  tripId,
  plan,
  item,
  onClose,
}: {
  tripId: string;
  plan: TripDocument;
  item?: BudgetItem;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const locale = (i18n.resolvedLanguage ?? 'it') as Locale;
  const { apply, pending } = usePlanOps(tripId);
  const currency = (
    isCurrencyCode(plan.trip.currency) ? plan.trip.currency : 'EUR'
  ) as CurrencyCode;
  const init = () => ({
    title: item?.title ?? '',
    category: item?.category ?? ('food' as ExpenseCategory),
    status: item?.status ?? ('estimate' as BudgetItem['status']),
    amount: moneyDraft(item?.amount, currency),
    included: item?.included ?? true,
    bookingId: item?.bookingId ?? '',
    notes: item?.notes ?? '',
  });
  const [d, setD] = useState(init);
  useEffect(() => {
    setD(init());
  }, [item?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = <K extends keyof ReturnType<typeof init>>(k: K, v: ReturnType<typeof init>[K]) =>
    setD((p) => ({ ...p, [k]: v }));
  const amount = moneyFromDraft(d.amount);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    await apply([
      {
        type: 'upsertBudgetItem',
        item: {
          ...(item ? { id: item.id } : {}),
          title: d.title.trim(),
          category: d.category,
          ...(item?.emoji ? { emoji: item.emoji } : {}),
          status: d.status,
          ...(amount ? { amount } : {}),
          included: d.included,
          ...(d.bookingId ? { bookingId: d.bookingId } : {}),
          ...(d.notes.trim() ? { notes: d.notes.trim() } : {}),
        },
      },
    ]);
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={item ? t('budget.editTitle') : t('budget.add')}>
        <StepForm
          onSubmit={submit}
          freeNavigation={!!item}
          pending={pending}
          submitLabel={t('common.save')}
          submitDisabled={!d.title.trim() || (d.status !== 'pending' && !amount)}
          leading={
            item && (
              <Button
                type="button"
                variant="ghost"
                className="text-destructive"
                disabled={pending}
                onClick={async () => {
                  await apply([{ type: 'deleteBudgetItem', id: item.id }]);
                  onClose();
                }}
              >
                <Trash2 />
                <span className="hidden sm:inline">{t('expense.delete')}</span>
              </Button>
            )
          }
        >
          <Step title={t('budget.stepWhat')}>
            <Field label={t('expense.title')} htmlFor="bu-title">
              <Input
                id="bu-title"
                required
                maxLength={160}
                value={d.title}
                onChange={(e) => set('title', e.target.value)}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('expense.category')} htmlFor="bu-cat">
                <Select
                  id="bu-cat"
                  value={d.category}
                  onChange={(e) => set('category', e.target.value as ExpenseCategory)}
                >
                  {EXPENSE_CATEGORY_KEYS.map((c) => (
                    <option key={c} value={c}>
                      {EXPENSE_CATEGORIES[c].emoji} {categoryLabel(c, locale)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('budget.statusLabel')} htmlFor="bu-status">
                <Select
                  id="bu-status"
                  value={d.status}
                  onChange={(e) => set('status', e.target.value as BudgetItem['status'])}
                >
                  {(['booked', 'pending', 'estimate'] as const).map((s) => (
                    <option key={s} value={s}>
                      {t(`budget.status.${s}`)}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <MoneyFields
              idPrefix="bu"
              label={t('expense.amount')}
              value={d.amount}
              onChange={(v) => set('amount', v)}
            />
            {d.status !== 'pending' && !amount && (
              <p className="text-sm text-destructive">{t('budget.amountRequired')}</p>
            )}
            {plan.bookings.length > 0 && (
              <Field label={t('plan.activity.booking')} htmlFor="bu-booking">
                <Select
                  id="bu-booking"
                  value={d.bookingId}
                  onChange={(e) => set('bookingId', e.target.value)}
                >
                  <option value="">—</option>
                  {plan.bookings.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.title}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <label className="flex items-center justify-between gap-3 text-sm font-medium">
              {t('budget.included')}
              <Switch checked={d.included} onCheckedChange={(v) => set('included', v)} />
            </label>
          </Step>
          <Step title={t('budget.stepMore')}>
            <Field label={t('expense.notes')} htmlFor="bu-notes">
              <textarea
                id="bu-notes"
                rows={2}
                maxLength={400}
                className={textareaClass}
                value={d.notes}
                onChange={(e) => set('notes', e.target.value)}
              />
            </Field>
          </Step>
        </StepForm>
      </DialogContent>
    </Dialog>
  );
}

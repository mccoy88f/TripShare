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
import { confirmDialog } from '@/components/confirm';

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
        <BudgetDonut
          categories={categories}
          planned={summary.byCategory}
          actual={actualByCategory}
          currency={trip.currency}
          locale={locale}
        />
      )}

      {categories.length > 0 && (
        <Card className="grid grid-cols-1 gap-4 p-4">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>← {t('budget.planned')}</span>
            <span>{t('budget.spent')} →</span>
          </div>
          {categories.map((c) => (
            <DifferenceBar
              key={c}
              label={`${EXPENSE_CATEGORIES[c].emoji} ${categoryLabel(c, locale)}`}
              planned={summary.byCategory[c] ?? 0}
              actual={actualByCategory[c] ?? 0}
              currency={trip.currency}
            />
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
                aria-label={t('expense.delete')}
                disabled={pending}
                onClick={async () => {
                  if (!(await confirmDialog(t('budget.confirmDelete')))) return;
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

/** Palette categoriale leggibile in chiaro e scuro; oltre 12 categorie si ricomincia. */
const PALETTE = [
  '#4f7cff',
  '#f59e0b',
  '#10b981',
  '#a855f7',
  '#ef4444',
  '#06b6d4',
  '#ec4899',
  '#84cc16',
  '#f97316',
  '#6366f1',
  '#14b8a6',
  '#eab308',
];
/** Il colore dipende dalla posizione tra le categorie mostrate, così sono sempre ben distinte. */
const categoryColor = (c: string, order: string[]) =>
  PALETTE[Math.max(order.indexOf(c), 0) % PALETTE.length]!;

const pct = (value: number, total: number) => (total > 0 ? Math.round((value / total) * 100) : 0);

/** Anello diviso per categoria: ogni arco è lungo quanto la quota sul totale. */
function Ring({
  radius,
  width,
  values,
  order,
  label,
}: {
  radius: number;
  width: number;
  values: Record<string, number>;
  order: string[];
  label: string;
}) {
  const circumference = 2 * Math.PI * radius;
  const total = order.reduce((n, c) => n + (values[c] ?? 0), 0);
  let offset = 0;
  const labels: { c: string; x: number; y: number; text: string }[] = [];
  const arcs = order.map((c) => {
    const v = values[c] ?? 0;
    if (v <= 0 || total <= 0) return null;
    const length = (v / total) * circumference;
    // Percentuale al centro dell'arco, solo se c'è spazio per leggerla.
    if (v / total >= 0.06) {
      const angle = ((offset + length / 2) / circumference) * 2 * Math.PI - Math.PI / 2;
      labels.push({
        c,
        x: 100 + radius * Math.cos(angle),
        y: 100 + radius * Math.sin(angle),
        text: `${pct(v, total)}%`,
      });
    }
    const arc = (
      <circle
        key={c}
        cx="100"
        cy="100"
        r={radius}
        fill="none"
        strokeWidth={width}
        stroke={categoryColor(c, order)}
        strokeDasharray={`${Math.max(length - 1.2, 0.5)} ${circumference}`}
        strokeDashoffset={-offset}
      >
        <title>{`${label}: ${pct(v, total)}%`}</title>
      </circle>
    );
    offset += length;
    return arc;
  });
  return (
    <>
      <g transform="rotate(-90 100 100)">
        <circle
          cx="100"
          cy="100"
          r={radius}
          fill="none"
          strokeWidth={width}
          className="stroke-muted"
        />
        {arcs}
      </g>
      {labels.map((l) => (
        <text
          key={l.c}
          x={l.x}
          y={l.y}
          textAnchor="middle"
          dominantBaseline="central"
          className="pointer-events-none fill-white text-[8px] font-bold"
          stroke="rgba(0,0,0,0.45)"
          strokeWidth="2"
          paintOrder="stroke"
        >
          {l.text}
        </text>
      ))}
    </>
  );
}

/** Doppio anello: dentro il budget previsto, fuori lo speso reale, per categoria. */
function BudgetDonut({
  categories,
  planned,
  actual,
  currency,
  locale,
}: {
  categories: ExpenseCategory[];
  planned: Record<string, number | undefined>;
  actual: Record<string, number>;
  currency: string;
  locale: Locale;
}) {
  const { t } = useTranslation();
  const plannedValues = Object.fromEntries(categories.map((c) => [c, planned[c] ?? 0]));
  const plannedTotal = Object.values(plannedValues).reduce((a, b) => a + b, 0);
  const actualTotal = categories.reduce((n, c) => n + (actual[c] ?? 0), 0);
  return (
    <Card className="grid grid-cols-1 gap-4 p-4">
      <div className="mx-auto w-full max-w-64">
        <svg
          viewBox="0 0 200 200"
          role="img"
          aria-label={`${t('budget.chart')}: ${t('budget.planned')} ${money(plannedTotal, currency)}, ${t('budget.spent')} ${money(actualTotal, currency)}`}
        >
          <Ring
            radius={88}
            width={20}
            values={actual}
            order={categories}
            label={`${t('budget.spent')}`}
          />
          <Ring
            radius={62}
            width={20}
            values={plannedValues}
            order={categories}
            label={`${t('budget.planned')}`}
          />
          <text x="100" y="96" textAnchor="middle" className="fill-muted-foreground text-[9px]">
            {t('budget.planned')}
          </text>
          <text
            x="100"
            y="110"
            textAnchor="middle"
            className="fill-foreground text-[11px] font-semibold"
          >
            {money(plannedTotal, currency)}
          </text>
        </svg>
        <p className="mt-1 text-center text-xs text-muted-foreground">{t('budget.chartHint')}</p>
      </div>
      <div className="grid grid-cols-1 gap-1.5 text-sm">
        <div className="grid grid-cols-[1fr_4rem_4rem] items-center gap-2 text-xs text-muted-foreground">
          <span />
          <span className="text-right">{t('budget.planned')}</span>
          <span className="text-right">{t('budget.spent')}</span>
        </div>
        {categories.map((c) => (
          <div key={c} className="grid grid-cols-[1fr_4rem_4rem] items-center gap-2">
            <span className="flex min-w-0 items-center gap-2">
              <span
                className="size-3 shrink-0 rounded-full"
                style={{ backgroundColor: categoryColor(c, categories) }}
              />
              <span className="truncate">
                {EXPENSE_CATEGORIES[c].emoji} {categoryLabel(c, locale)}
              </span>
            </span>
            <span className="tabular text-right text-muted-foreground">
              {pct(plannedValues[c] ?? 0, plannedTotal)}%
            </span>
            <span className="tabular text-right font-medium">
              {pct(actual[c] ?? 0, actualTotal)}%
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

/**
 * Confronto tra previsto (a sinistra) e speso (a destra): il cursore parte dal centro, che
 * vale "speso uguale al previsto", e si sposta a destra se si è speso di più, a sinistra se
 * di meno. Il bordo corrisponde a una differenza pari al 100% del previsto.
 */
function DifferenceBar({
  label,
  planned,
  actual,
  currency,
}: {
  label: string;
  planned: number;
  actual: number;
  currency: string;
}) {
  const { t } = useTranslation();
  // Senza budget o senza spese il confronto non ha senso: cursore grigio al centro.
  const note = planned <= 0 ? t('budget.noBudget') : actual <= 0 ? t('budget.notSpent') : null;
  const ratio = note ? 0 : Math.max(-1, Math.min(1, (actual - planned) / planned));
  const over = actual > planned;
  const tone = note ? 'bg-muted-foreground/60' : over ? 'bg-destructive' : 'bg-success';
  const position = 50 + ratio * 47;
  return (
    <div className="grid grid-cols-1 gap-1.5">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="min-w-0 truncate">{label}</span>
        {note ? (
          <span className="shrink-0 text-xs text-muted-foreground">{note}</span>
        ) : (
          <span
            className={cn(
              'tabular shrink-0 text-xs font-medium',
              over ? 'text-destructive' : 'text-success',
            )}
          >
            {over ? '+' : '−'}
            {money(Math.abs(actual - planned), currency)}
          </span>
        )}
      </div>
      <div
        className="relative h-3 rounded-full bg-muted"
        role="img"
        aria-label={`${label}: ${t('budget.planned')} ${money(planned, currency)}, ${t('budget.spent')} ${money(actual, currency)}`}
      >
        <div
          className={cn('absolute inset-y-1 rounded-full opacity-40', tone)}
          style={{
            left: `${Math.min(50, position)}%`,
            width: `${Math.abs(position - 50)}%`,
          }}
        />
        <div className="absolute inset-y-0 left-1/2 w-px bg-foreground/30" />
        <div
          className={cn(
            'absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card shadow transition-all',
            tone,
          )}
          style={{ left: `${position}%` }}
        />
      </div>
      <div className="tabular flex justify-between text-xs text-muted-foreground">
        <span>{money(planned, currency)}</span>
        <span className="font-medium text-foreground">{money(actual, currency)}</span>
      </div>
    </div>
  );
}

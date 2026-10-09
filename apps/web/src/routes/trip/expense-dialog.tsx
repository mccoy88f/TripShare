import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Smile, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  CURRENCIES,
  CURRENCY_CODES,
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_KEYS,
  categoryLabel,
  computeShares,
  convertMinor,
  fromMinor,
  isCurrencyCode,
  toMinor,
  type CurrencyCode,
  type ExpenseCategory,
  type Locale,
  type SplitInput,
} from '@tripshare/shared';
import { UserAvatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Step, StepForm } from '@/components/ui/steps';
import { EmojiPicker } from '@/components/ui/emoji-picker';
import { Field, Input, Select } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { money, todayIso } from '@/lib/format';
import { useTRPC } from '@/lib/trpc';
import type { ExpenseT, TripDetail } from '@/lib/types';
import { cn } from '@/lib/utils';
import {
  ItemSplit,
  ReceiptScanButton,
  receiptItems,
  splitByItems,
  type ReceiptItem,
  type ReceiptResult,
} from './receipt-scan';
import { confirmDialog } from '@/components/confirm';

type Method = 'equal' | 'shares' | 'percent' | 'exact';

/** "12,50" o "12.50" → 1250 (unità minori); null se non valido. */
function parseAmount(text: string, currency: CurrencyCode): number | null {
  const normalized = text.replace(/\s/g, '').replace(',', '.');
  if (!/^\d+(\.\d{0,4})?$/.test(normalized)) return null;
  const value = toMinor(Number(normalized), currency);
  return value > 0 ? value : null;
}

const fmtNumber = (minor: number, currency: CurrencyCode) => String(fromMinor(minor, currency));

interface State {
  title: string;
  emoji: string | null;
  emojiTouched: boolean;
  category: ExpenseCategory;
  amount: string;
  currency: CurrencyCode;
  rate: string;
  rateTouched: boolean;
  date: string;
  payerId: string;
  method: Method;
  members: string[];
  shares: Record<string, string>;
  percents: Record<string, string>;
  exact: Record<string, string>;
  notes: string;
  status: 'paid' | 'planned';
  bookingId: string | null;
  receipt: string | null;
  /** Righe dello scontrino letto dall'AI, per dividere per voce. */
  items: ReceiptItem[];
  byItems: boolean;
}

/** Valori iniziali per una nuova spesa (da prenotazione, scontrino letto dall'AI…). */
export interface ExpensePreset {
  title?: string;
  emoji?: string | null;
  category?: ExpenseCategory;
  date?: string;
  amount?: number;
  currency?: CurrencyCode;
  notes?: string;
  status?: 'paid' | 'planned';
  bookingId?: string;
  payerId?: string;
  /** Partecipanti tra cui dividere (divisione in parti uguali). */
  memberIds?: string[];
}

function initialState(trip: TripDetail, expense?: ExpenseT, preset?: ExpensePreset): State {
  const active = trip.members.filter((m) => !m.removed).map((m) => m.id);
  const tripCurrency = trip.currency as CurrencyCode;
  if (!expense) {
    const currency = preset?.currency ?? tripCurrency;
    return {
      title: preset?.title ?? '',
      emoji: preset?.emoji ?? null,
      emojiTouched: !!preset?.emoji,
      category: preset?.category ?? 'food',
      amount: preset?.amount ? fmtNumber(preset.amount, currency) : '',
      currency,
      rate: currency === tripCurrency ? '1' : '',
      rateTouched: false,
      date: preset?.date ?? clampDate(todayIso(), trip),
      payerId: preset?.payerId ?? trip.myMemberId,
      method: 'equal',
      members: preset?.memberIds?.length ? preset.memberIds : active,
      shares: Object.fromEntries(active.map((id) => [id, '1'])),
      percents: {},
      exact: {},
      notes: preset?.notes ?? '',
      status: preset?.status ?? 'paid',
      bookingId: preset?.bookingId ?? null,
      receipt: null,
      items: [],
      byItems: false,
    };
  }
  const currency = (
    isCurrencyCode(expense.currency) ? expense.currency : tripCurrency
  ) as CurrencyCode;
  const ids = expense.shares.map((s) => s.memberId);
  return {
    title: expense.title,
    emoji: expense.emoji,
    emojiTouched: !!expense.emoji,
    category: (expense.category in EXPENSE_CATEGORIES
      ? expense.category
      : 'other') as ExpenseCategory,
    amount: fmtNumber(expense.amount, currency),
    currency,
    rate: String(expense.rate),
    rateTouched: true,
    date: expense.date,
    payerId: paidByEveryone(expense) ? ALL : (expense.payers[0]?.memberId ?? trip.myMemberId),
    method: expense.splitMethod as Method,
    members: ids.filter(
      (id) =>
        (expense.shares.find((s) => s.memberId === id)?.amount ?? 0) > 0 ||
        expense.splitMethod === 'equal',
    ),
    shares: Object.fromEntries(expense.shares.map((s) => [s.memberId, String(s.weight ?? 1)])),
    percents: Object.fromEntries(expense.shares.map((s) => [s.memberId, String(s.weight ?? 0)])),
    exact: Object.fromEntries(
      expense.shares.map((s) => [s.memberId, fmtNumber(s.amount, currency)]),
    ),
    notes: expense.notes ?? '',
    status: expense.status === 'planned' ? 'planned' : 'paid',
    bookingId: expense.bookingId,
    receipt: expense.receipt,
    items: [],
    byItems: false,
  };
}

/** Valore del menu "chi ha pagato" per "tutti, ognuno la sua quota". */
export const ALL = '__all__';

/** Spesa pagata da tutti: ognuno ha pagato esattamente la propria quota. */
export function paidByEveryone(e: Pick<ExpenseT, 'payers' | 'shares'>) {
  const owed = e.shares.filter((x) => x.amount > 0);
  return (
    e.payers.length > 1 &&
    owed.length === e.payers.length &&
    owed.every((x) => e.payers.find((p) => p.memberId === x.memberId)?.amount === x.amount)
  );
}

function clampDate(date: string, trip: TripDetail) {
  if (trip.startDate && date < trip.startDate) return trip.startDate;
  if (trip.endDate && date > trip.endDate) return trip.endDate;
  return date;
}

export function ExpenseDialog({
  trip,
  expense,
  preset,
  open,
  onOpenChange,
}: {
  trip: TripDetail;
  expense?: ExpenseT;
  preset?: ExpensePreset;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t, i18n } = useTranslation();
  const locale = (i18n.resolvedLanguage ?? 'it') as Locale;
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [s, setS] = useState<State>(() => initialState(trip, expense, preset));
  const [pickerOpen, setPickerOpen] = useState(false);
  const tripCurrency = trip.currency as CurrencyCode;

  useEffect(() => {
    if (open) setS(initialState(trip, expense, preset));
  }, [open, expense?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = <K extends keyof State>(k: K, v: State[K]) => setS((prev) => ({ ...prev, [k]: v }));
  const members = trip.members.filter(
    (m) => !m.removed || s.members.includes(m.id) || s.payerId === m.id,
  );
  const foreign = s.currency !== tripCurrency;

  const fx = useQuery({
    ...trpc.expenses.rate.queryOptions({ from: s.currency, to: tripCurrency, date: s.date }),
    enabled: open && foreign,
    staleTime: 3600_000,
  });
  useEffect(() => {
    if (fx.data && !s.rateTouched)
      setS((prev) => ({ ...prev, rate: String(Number(fx.data.rate.toFixed(6))) }));
  }, [fx.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const amount = parseAmount(s.amount, s.currency);
  const rate = foreign ? Number(s.rate.replace(',', '.')) || 0 : 1;

  /** Calcolo della divisione per l'anteprima e per l'invio. */
  const split = useMemo((): {
    input: SplitInput | null;
    error: string | null;
    preview: Record<string, number>;
  } => {
    if (!amount) return { input: null, error: null, preview: {} };
    let input: SplitInput;
    if (s.method === 'equal') {
      if (s.members.length === 0)
        return { input: null, error: t('expense.errors.noMembers'), preview: {} };
      input = { method: 'equal', members: s.members };
    } else if (s.method === 'shares') {
      const shares = Object.fromEntries(
        s.members.map((id) => [id, Number((s.shares[id] ?? '1').replace(',', '.')) || 0]),
      );
      if (Object.values(shares).every((v) => v === 0))
        return { input: null, error: t('expense.errors.noMembers'), preview: {} };
      input = { method: 'shares', shares };
    } else if (s.method === 'percent') {
      const percents = Object.fromEntries(
        s.members.map((id) => [id, Number((s.percents[id] ?? '0').replace(',', '.')) || 0]),
      );
      const sum = Object.values(percents).reduce((a, b) => a + b, 0);
      if (Math.abs(sum - 100) > 0.001)
        return {
          input: null,
          error: t('expense.errors.percent', { sum: Math.round(sum * 100) / 100 }),
          preview: {},
        };
      input = { method: 'percent', percents };
    } else {
      const amounts = Object.fromEntries(
        s.members.map((id) => [id, parseAmount(s.exact[id] ?? '', s.currency) ?? 0]),
      );
      const sum = Object.values(amounts).reduce((a, b) => a + b, 0);
      if (sum !== amount) {
        return {
          input: null,
          error: t('expense.errors.exact', { left: money(amount - sum, s.currency, locale) }),
          preview: {},
        };
      }
      input = { method: 'exact', amounts };
    }
    try {
      return { input, error: null, preview: computeShares(amount, input) };
    } catch {
      return { input: null, error: t('common.error'), preview: {} };
    }
  }, [amount, s.method, s.members, s.shares, s.percents, s.exact, s.currency, locale, t]);

  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: trpc.expenses.list.queryKey({ tripId: trip.id }) }),
      queryClient.invalidateQueries({ queryKey: trpc.trips.get.queryKey({ id: trip.id }) }),
      queryClient.invalidateQueries({ queryKey: trpc.trips.list.queryKey() }),
    ]);
  const onError = (err: { message: string }) =>
    toast.error(t(`expense.errors.${err.message}`, { defaultValue: t('common.error') }));
  const create = useMutation(trpc.expenses.create.mutationOptions({ onError }));
  const update = useMutation(trpc.expenses.update.mutationOptions({ onError }));
  const remove = useMutation(trpc.expenses.delete.mutationOptions({ onError }));
  const pending = create.isPending || update.isPending || remove.isPending;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!amount || !split.input || !s.title.trim()) return;
    if (foreign && !(rate > 0)) return;
    const input = {
      tripId: trip.id,
      title: s.title.trim(),
      emoji: s.emoji ?? EXPENSE_CATEGORIES[s.category].emoji,
      category: s.category,
      amount,
      currency: s.currency,
      rate: foreign ? rate : undefined,
      date: s.date,
      // "Tutti": ognuno ha pagato la propria quota, la spesa è già pareggiata.
      payers:
        s.payerId === ALL
          ? Object.entries(split.preview)
              .filter(([, v]) => v > 0)
              .map(([memberId, v]) => ({ memberId, amount: v }))
          : [{ memberId: s.payerId, amount }],
      split: split.input,
      notes: s.notes.trim() || null,
      status: s.status,
      bookingId: s.bookingId,
      receipt: s.receipt,
    };
    if (expense) await update.mutateAsync({ ...input, id: expense.id });
    else await create.mutateAsync(input);
    await invalidate();
    toast.success(expense ? t('common.saved') : t('expense.added'));
    onOpenChange(false);
  };

  /** Divisione "per voce": importi esatti calcolati dalle righe dello scontrino. */
  const applyItems = (items: ReceiptItem[], total = amount) => {
    const owed = total ? splitByItems(total, items) : null;
    setS((prev) => ({
      ...prev,
      items,
      byItems: true,
      ...(owed
        ? {
            method: 'exact' as const,
            members: Object.keys(owed).filter((id) => owed[id]! > 0),
            exact: Object.fromEntries(
              Object.entries(owed).map(([id, v]) => [id, fmtNumber(v, prev.currency)]),
            ),
          }
        : {}),
    }));
  };

  const onReceipt = (r: ReceiptResult, file: string) => {
    const currency = isCurrencyCode(r.currency) ? r.currency : s.currency;
    const total = toMinor(r.total, currency);
    const inTrip =
      r.date &&
      (!trip.startDate || r.date >= trip.startDate) &&
      (!trip.endDate || r.date <= trip.endDate);
    const items = r.items.length >= 2 ? receiptItems({ ...r, currency }, s.members) : [];
    setS((prev) => ({
      ...prev,
      title: prev.title.trim() ? prev.title : r.title,
      emoji: prev.emojiTouched ? prev.emoji : r.emoji || null,
      emojiTouched: prev.emojiTouched || !!r.emoji,
      category: r.category in EXPENSE_CATEGORIES ? r.category : prev.category,
      amount: fmtNumber(total, currency),
      currency,
      rate: currency === tripCurrency ? '1' : currency === prev.currency ? prev.rate : '',
      rateTouched: currency === prev.currency && prev.rateTouched,
      date: r.date && (inTrip || !trip.startDate) ? r.date : prev.date,
      notes: prev.notes || [r.merchant, r.notes].filter(Boolean).join(' · ').slice(0, 1000),
      receipt: file,
      items,
      byItems: false,
    }));
  };

  const toggleMember = (id: string) =>
    set('members', s.members.includes(id) ? s.members.filter((m) => m !== id) : [...s.members, id]);
  const shownEmoji = s.emoji ?? EXPENSE_CATEGORIES[s.category].emoji;
  const converted =
    amount && foreign && rate > 0 ? convertMinor(amount, s.currency, tripCurrency, rate) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={expense ? t('expense.editTitle') : t('expense.newTitle')}>
        <StepForm
          onSubmit={submit}
          freeNavigation={!!expense}
          pending={pending}
          submitLabel={expense ? t('common.save') : t('expense.add')}
          submitDisabled={!amount || !split.input || !s.title.trim() || (foreign && !(rate > 0))}
          leading={
            expense && (
              <Button
                type="button"
                variant="ghost"
                className="text-destructive"
                aria-label={t('expense.delete')}
                disabled={pending}
                onClick={async () => {
                  if (!(await confirmDialog(t('expense.confirmDelete')))) return;
                  await remove.mutateAsync({ tripId: trip.id, id: expense.id });
                  await invalidate();
                  toast.success(t('expense.deleted'));
                  onOpenChange(false);
                }}
              >
                <Trash2 />
                <span className="hidden sm:inline">{t('expense.delete')}</span>
              </Button>
            )
          }
        >
          <Step title={t('expense.stepWhat')}>
            {!expense && !s.receipt && <ReceiptScanButton trip={trip} onResult={onReceipt} />}
            {s.receipt && (
              <a
                href={`/api/trips/${trip.id}/receipts/${s.receipt}`}
                target="_blank"
                rel="noreferrer"
                className={cn(
                  'inline-flex items-center gap-2 justify-self-start rounded-full bg-secondary px-3 py-1 text-sm font-medium',
                  !expense && 'pointer-events-none',
                )}
              >
                🧾 {expense ? t('ai.receipt.open') : t('ai.receipt.attached')}
              </a>
            )}
            <div className="flex items-end gap-3">
              <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-secondary text-3xl transition hover:scale-105"
                    aria-label={t('profile.chooseEmoji')}
                  >
                    {shownEmoji || <Smile />}
                  </button>
                </PopoverTrigger>
                <PopoverContent>
                  <EmojiPicker
                    onSelect={(emoji) => {
                      setS((prev) => ({ ...prev, emoji, emojiTouched: true }));
                      setPickerOpen(false);
                    }}
                  />
                </PopoverContent>
              </Popover>
              <Field label={t('expense.title')} htmlFor="exp-title" className="flex-1">
                <Input
                  id="exp-title"
                  required
                  maxLength={160}
                  placeholder={t('expense.titlePlaceholder')}
                  value={s.title}
                  onChange={(e) => set('title', e.target.value)}
                />
              </Field>
            </div>

            <div className="grid grid-cols-[1fr_auto] gap-3">
              <Field label={t('expense.amount')} htmlFor="exp-amount">
                <Input
                  id="exp-amount"
                  inputMode="decimal"
                  required
                  pattern="\s*[0-9]+([.,][0-9]{0,4})?\s*"
                  placeholder="0,00"
                  className="tabular text-lg font-semibold"
                  value={s.amount}
                  aria-invalid={s.amount !== '' && !amount}
                  onChange={(e) => set('amount', e.target.value)}
                />
              </Field>
              <Field label={t('expense.currency')} htmlFor="exp-cur">
                <Select
                  id="exp-cur"
                  className="w-28"
                  value={s.currency}
                  onChange={(e) => {
                    const currency = e.target.value as CurrencyCode;
                    // Il tasso arriva dalla BCE; finché non c'è (o se non arriva) va inserito a mano.
                    setS((prev) => ({
                      ...prev,
                      currency,
                      rateTouched: false,
                      rate: currency === tripCurrency ? '1' : '',
                    }));
                  }}
                >
                  {CURRENCY_CODES.map((c) => (
                    <option key={c} value={c}>
                      {c} {CURRENCIES[c].symbol !== c ? CURRENCIES[c].symbol : ''}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            {foreign && (
              <div className="grid grid-cols-1 gap-1.5 rounded-xl bg-muted/60 p-3 text-sm">
                <label className="flex flex-wrap items-center gap-2" htmlFor="exp-rate">
                  <span>1 {s.currency} =</span>
                  <Input
                    id="exp-rate"
                    inputMode="decimal"
                    required
                    pattern="[0-9]+([.,][0-9]+)?"
                    className="tabular h-9 w-28"
                    value={s.rate}
                    onChange={(e) =>
                      setS((prev) => ({ ...prev, rate: e.target.value, rateTouched: true }))
                    }
                  />
                  <span>{tripCurrency}</span>
                  {fx.isFetching && (
                    <Loader2 className="size-4 animate-spin text-muted-foreground" />
                  )}
                </label>
                <p className="text-muted-foreground">
                  {fx.isError && !(rate > 0)
                    ? t('expense.rateUnavailable')
                    : converted
                      ? t('expense.converted', { amount: money(converted, tripCurrency, locale) })
                      : t('expense.rateHint')}
                </p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <Field label={t('expense.category')} htmlFor="exp-cat">
                <Select
                  id="exp-cat"
                  value={s.category}
                  onChange={(e) => {
                    const c = e.target.value as ExpenseCategory;
                    setS((prev) => ({
                      ...prev,
                      category: c,
                      emoji: prev.emojiTouched ? prev.emoji : null,
                    }));
                  }}
                >
                  {EXPENSE_CATEGORY_KEYS.map((c) => (
                    <option key={c} value={c}>
                      {EXPENSE_CATEGORIES[c].emoji} {categoryLabel(c, locale)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('expense.date')} htmlFor="exp-date">
                <Input
                  id="exp-date"
                  type="date"
                  required
                  value={s.date}
                  onChange={(e) => set('date', e.target.value)}
                />
              </Field>
            </div>
          </Step>
          <Step title={t('expense.stepSplit')}>
            <div className="grid grid-cols-2 gap-1 rounded-full bg-muted p-1">
              {(['paid', 'planned'] as const).map((st) => (
                <button
                  key={st}
                  type="button"
                  aria-pressed={s.status === st}
                  onClick={() => set('status', st)}
                  className={cn(
                    'rounded-full px-3 py-1.5 text-sm font-medium transition',
                    s.status === st ? 'bg-card shadow-sm' : 'text-muted-foreground',
                  )}
                >
                  {st === 'paid' ? `✅ ${t('expense.paidStatus')}` : `⏳ ${t('expense.planned')}`}
                </button>
              ))}
            </div>
            {s.status === 'planned' && (
              <p className="-mt-3 px-1 text-[13px] text-muted-foreground">
                {t('expense.plannedHint')}
              </p>
            )}

            <Field
              label={s.status === 'planned' ? t('expense.willPay') : t('expense.paidBy')}
              htmlFor="exp-payer"
            >
              <Select
                id="exp-payer"
                value={s.payerId}
                onChange={(e) => set('payerId', e.target.value)}
              >
                <option value={ALL}>👥 {t('expense.everyone')}</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.id === trip.myMemberId ? t('expense.me', { name: m.name }) : m.name}
                  </option>
                ))}
              </Select>
            </Field>

            {s.items.length > 0 && (
              <div className="grid grid-cols-1 gap-3 rounded-xl bg-muted/50 p-3">
                <label className="flex items-center justify-between gap-3 text-sm font-medium">
                  <span>🧾 {t('ai.receipt.byItems', { count: s.items.length })}</span>
                  <input
                    type="checkbox"
                    className="size-5 accent-[var(--primary)]"
                    checked={s.byItems}
                    onChange={(e) =>
                      e.target.checked
                        ? applyItems(s.items)
                        : setS((prev) => ({ ...prev, byItems: false, method: 'equal' }))
                    }
                  />
                </label>
                {s.byItems && (
                  <ItemSplit
                    items={s.items}
                    members={trip.members.filter((m) => !m.removed)}
                    currency={s.currency}
                    onChange={(items) => applyItems(items)}
                  />
                )}
              </div>
            )}

            <div className="grid grid-cols-1 gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium">{t('expense.splitTitle')}</span>
                <div className="inline-flex rounded-full bg-muted p-1">
                  {(['equal', 'shares', 'percent', 'exact'] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => {
                        setS((prev) => {
                          const next = { ...prev, method: m };
                          if (m === 'percent' && prev.members.length) {
                            const each = Math.floor((100 / prev.members.length) * 100) / 100;
                            next.percents = Object.fromEntries(
                              prev.members.map((id, i) => [
                                id,
                                String(
                                  i === 0
                                    ? Math.round((100 - each * (prev.members.length - 1)) * 100) /
                                        100
                                    : each,
                                ),
                              ]),
                            );
                          }
                          if (m === 'exact' && amount && prev.members.length) {
                            const parts = computeShares(amount, {
                              method: 'equal',
                              members: prev.members,
                            });
                            next.exact = Object.fromEntries(
                              prev.members.map((id) => [id, fmtNumber(parts[id]!, prev.currency)]),
                            );
                          }
                          return next;
                        });
                      }}
                      className={cn(
                        'rounded-full px-3 py-1 text-xs font-semibold transition',
                        s.method === m ? 'bg-card shadow-sm' : 'text-muted-foreground',
                      )}
                    >
                      {t(`expense.methods.${m}`)}
                    </button>
                  ))}
                </div>
              </div>
              <div className="divide-y rounded-xl border">
                {members
                  .filter((m) => !m.removed)
                  .map((m) => {
                    const on = s.members.includes(m.id);
                    return (
                      <div key={m.id} className="flex items-center gap-3 px-3 py-2.5">
                        <input
                          type="checkbox"
                          className="size-5 accent-[var(--primary)]"
                          checked={on}
                          onChange={() => toggleMember(m.id)}
                          aria-label={m.name}
                        />
                        <UserAvatar user={m} size="sm" />
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">
                          {m.name}
                        </span>
                        {on && s.method === 'shares' && (
                          <Input
                            inputMode="decimal"
                            className="tabular h-9 w-16 text-center"
                            value={s.shares[m.id] ?? '1'}
                            onChange={(e) => set('shares', { ...s.shares, [m.id]: e.target.value })}
                            aria-label={t('expense.methods.shares')}
                          />
                        )}
                        {on && s.method === 'percent' && (
                          <div className="flex items-center gap-1">
                            <Input
                              inputMode="decimal"
                              className="tabular h-9 w-20 text-right"
                              value={s.percents[m.id] ?? '0'}
                              onChange={(e) =>
                                set('percents', { ...s.percents, [m.id]: e.target.value })
                              }
                            />
                            %
                          </div>
                        )}
                        {on && s.method === 'exact' && (
                          <Input
                            inputMode="decimal"
                            className="tabular h-9 w-24 text-right"
                            value={s.exact[m.id] ?? ''}
                            onChange={(e) => set('exact', { ...s.exact, [m.id]: e.target.value })}
                          />
                        )}
                        {on && s.method !== 'exact' && (
                          <span className="tabular w-20 text-right text-sm text-muted-foreground">
                            {split.preview[m.id] !== undefined
                              ? money(split.preview[m.id]!, s.currency, locale)
                              : '—'}
                          </span>
                        )}
                      </div>
                    );
                  })}
              </div>
              {split.error && <p className="text-sm text-destructive">{split.error}</p>}
            </div>

            <Field label={`${t('expense.notes')} (${t('common.optional')})`} htmlFor="exp-notes">
              <Input
                id="exp-notes"
                maxLength={1000}
                value={s.notes}
                onChange={(e) => set('notes', e.target.value)}
              />
            </Field>
          </Step>
        </StepForm>
      </DialogContent>
    </Dialog>
  );
}

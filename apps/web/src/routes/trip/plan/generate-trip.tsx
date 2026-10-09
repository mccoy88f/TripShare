import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Sparkles } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { CURRENCY_CODES, type CurrencyCode } from '@tripshare/shared';
import type { TripDocument } from '@tripshare/shared/trip-format';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/input';
import { useAiStatus, useAiTask } from '@/lib/ai';
import { useTRPC } from '@/lib/trpc';
import type { TripDetail } from '@/lib/types';
import { cn } from '@/lib/utils';
import { textareaClass } from './fields';

const STYLES = ['relax', 'culture', 'nature', 'food', 'nightlife', 'kids', 'adventure', 'budget'];

export interface GenerateValues {
  prompt: string;
  destination: string;
  startDate: string;
  endDate: string;
  travelers: string;
  departureFrom: string;
  currency: CurrencyCode;
  budget: string;
  budgetBasis: 'total' | 'per_person';
  style: string[];
}

/** Modulo per chiedere all'AI un programma di viaggio completo. */
export function GenerateTripForm({
  initial,
  lockTripFields = false,
  submitLabel,
  onGenerated,
}: {
  initial: GenerateValues;
  /** Destinazione, date e valuta arrivano dal viaggio esistente. */
  lockTripFields?: boolean;
  submitLabel?: string;
  onGenerated: (plan: TripDocument, values: GenerateValues) => Promise<void>;
}) {
  const { t } = useTranslation();
  const { run, running } = useAiTask();
  const [v, setV] = useState(initial);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof GenerateValues>(k: K, value: GenerateValues[K]) =>
    setV((prev) => ({ ...prev, [k]: value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const budget = Number(v.budget.replace(',', '.'));
    const plan = await run<TripDocument>(null, {
      kind: 'generate',
      prompt: v.prompt.trim(),
      currency: v.currency,
      ...(v.destination.trim() ? { destination: v.destination.trim() } : {}),
      ...(v.startDate ? { startDate: v.startDate } : {}),
      ...(v.endDate ? { endDate: v.endDate } : {}),
      ...(Number(v.travelers) > 0 ? { travelers: Number(v.travelers) } : {}),
      ...(v.departureFrom.trim() ? { departureFrom: v.departureFrom.trim() } : {}),
      ...(budget > 0
        ? { budget: { amount: budget, currency: v.currency, basis: v.budgetBasis } }
        : {}),
      ...(v.style.length ? { style: v.style.map((s) => t(`ai.generate.styles.${s}`)) } : {}),
    });
    if (!plan) return;
    setSaving(true);
    try {
      await onGenerated(plan, v);
    } finally {
      setSaving(false);
    }
  };

  const busy = running || saving;
  return (
    <form onSubmit={submit} className="grid grid-cols-1 gap-4">
      <Field
        label={t('ai.generate.prompt')}
        htmlFor="gen-prompt"
        hint={t('ai.generate.promptHint')}
      >
        <textarea
          id="gen-prompt"
          required
          minLength={3}
          maxLength={3000}
          className={cn(textareaClass, 'min-h-28')}
          placeholder={t('ai.generate.promptPlaceholder')}
          value={v.prompt}
          onChange={(e) => set('prompt', e.target.value)}
        />
      </Field>
      {!lockTripFields && (
        <>
          <Field label={t('trip.form.destination')} htmlFor="gen-dest">
            <Input
              id="gen-dest"
              maxLength={160}
              value={v.destination}
              onChange={(e) => set('destination', e.target.value)}
            />
          </Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={t('trip.form.start')} htmlFor="gen-start">
              <Input
                id="gen-start"
                type="date"
                value={v.startDate}
                onChange={(e) => set('startDate', e.target.value)}
              />
            </Field>
            <Field label={t('trip.form.end')} htmlFor="gen-end">
              <Input
                id="gen-end"
                type="date"
                min={v.startDate}
                value={v.endDate}
                onChange={(e) => set('endDate', e.target.value)}
              />
            </Field>
          </div>
        </>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('ai.generate.travelers')} htmlFor="gen-trav">
          <Input
            id="gen-trav"
            type="number"
            min={1}
            max={50}
            value={v.travelers}
            onChange={(e) => set('travelers', e.target.value)}
          />
        </Field>
        <Field label={t('ai.generate.from')} htmlFor="gen-from">
          <Input
            id="gen-from"
            maxLength={160}
            placeholder={t('ai.generate.fromPlaceholder')}
            value={v.departureFrom}
            onChange={(e) => set('departureFrom', e.target.value)}
          />
        </Field>
      </div>
      <div className="grid grid-cols-[1fr_auto_auto] items-end gap-2">
        <Field label={t('ai.generate.budget')} htmlFor="gen-budget">
          <Input
            id="gen-budget"
            inputMode="decimal"
            placeholder={t('common.optional')}
            value={v.budget}
            onChange={(e) => set('budget', e.target.value)}
          />
        </Field>
        <Select
          className="w-24"
          value={v.currency}
          disabled={lockTripFields}
          onChange={(e) => set('currency', e.target.value as CurrencyCode)}
          aria-label={t('expense.currency')}
        >
          {CURRENCY_CODES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
        <Select
          className="w-32"
          value={v.budgetBasis}
          onChange={(e) => set('budgetBasis', e.target.value as 'total' | 'per_person')}
          aria-label={t('ai.generate.budget')}
        >
          <option value="total">{t('ai.generate.total')}</option>
          <option value="per_person">{t('ai.generate.perPerson')}</option>
        </Select>
      </div>
      <div className="grid grid-cols-1 gap-1.5">
        <span className="text-sm font-medium">{t('ai.generate.style')}</span>
        <div className="flex flex-wrap gap-1.5">
          {STYLES.map((s) => {
            const on = v.style.includes(s);
            return (
              <button
                key={s}
                type="button"
                aria-pressed={on}
                onClick={() => set('style', on ? v.style.filter((x) => x !== s) : [...v.style, s])}
                className={cn(
                  'rounded-full border px-3 py-1.5 text-sm transition',
                  on ? 'border-primary bg-primary/10 font-semibold text-primary' : 'hover:bg-muted',
                )}
              >
                {t(`ai.generate.styles.${s}`)}
              </button>
            );
          })}
        </div>
      </div>
      {running && (
        <p className="rounded-xl bg-secondary px-4 py-3 text-sm text-secondary-foreground">
          ✨ {t('ai.generate.working')}
        </p>
      )}
      <Button
        type="submit"
        size="lg"
        variant="accent"
        disabled={busy || v.prompt.trim().length < 3}
      >
        {busy ? <Loader2 className="animate-spin" /> : <Sparkles />}
        {submitLabel ?? t('ai.generate.submit')}
      </Button>
    </form>
  );
}

/** "Genera con l'AI" per un viaggio senza programma. */
export function GeneratePlanButton({ trip }: { trip: TripDetail }) {
  const { t } = useTranslation();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const status = useAiStatus();
  const [open, setOpen] = useState(false);
  const replace = useMutation(trpc.plan.replace.mutationOptions());
  if (!status.data?.available) return null;
  return (
    <>
      <Button variant="accent" onClick={() => setOpen(true)}>
        <Sparkles />
        {t('ai.generate.button')}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title={`✨ ${t('ai.generate.title')}`} description={t('ai.generate.hint')}>
          <div className="pt-2">
            <GenerateTripForm
              lockTripFields={!!trip.startDate}
              initial={{
                prompt: '',
                destination: trip.destination ?? '',
                startDate: trip.startDate ?? '',
                endDate: trip.endDate ?? '',
                travelers: String(trip.members.filter((m) => !m.removed).length),
                departureFrom: '',
                currency: trip.currency as CurrencyCode,
                budget: '',
                budgetBasis: 'total',
                style: [],
              }}
              onGenerated={async (plan) => {
                await replace.mutateAsync({
                  tripId: trip.id,
                  plan,
                  updateTrip: !trip.startDate,
                });
                await Promise.all([
                  queryClient.invalidateQueries({
                    queryKey: trpc.plan.get.queryKey({ tripId: trip.id }),
                  }),
                  queryClient.invalidateQueries({
                    queryKey: trpc.trips.get.queryKey({ id: trip.id }),
                  }),
                ]);
                toast.success(t('ai.generate.done'));
                setOpen(false);
              }}
            />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

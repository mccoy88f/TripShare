import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
  ArrowDown,
  ArrowUp,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Minus,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { distributeNights, isCurrencyCode } from '@tripshare/shared';
import {
  BUDGET_TIERS,
  EXPERIENCES,
  INTENSITIES,
  LODGINGS,
  NEEDS,
  TRANSPORT_PREFS,
  TRIP_TYPES,
  type AiPrefs,
} from '@tripshare/shared/trip-format';
import { useMe } from '@/components/layouts/app-layout';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/input';
import { useAiStatus } from '@/lib/ai';
import { useKeyboard } from '@/lib/keyboard';
import { useTRPC } from '@/lib/trpc';
import { cn } from '@/lib/utils';
import { textareaClass } from '../plan/fields';
import { PlaceField } from './place-field';
import {
  MAX_DAYS,
  MAX_PEOPLE,
  MAX_STOPS,
  emptyWizard,
  extraKm,
  lastOrigin,
  loadDraft,
  nightsAssigned,
  isMainStop,
  patchWizard,
  otherPeople,
  peopleCount,
  rememberOrigin,
  returnPoint,
  route,
  saveDraft,
  toBrief,
  totalNights,
  type WizardState,
} from './wizard-state';

const RouteMap = lazy(() => import('./route-map'));

type StepId = 'where' | 'when' | 'who' | 'mode' | 'prefs' | 'review';

const km = (n: number) => `${Math.round(n).toLocaleString()} km`;

/** Pulsanti + e − per un numero. */
function Counter({
  value,
  min,
  max,
  onChange,
  label,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
  label: string;
}) {
  return (
    <div className="inline-flex items-center gap-1 rounded-full border bg-card p-1">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-9 rounded-full"
        disabled={value <= min}
        onClick={() => onChange(value - 1)}
        aria-label={`${label} −`}
      >
        <Minus />
      </Button>
      <span className="w-8 text-center text-base font-semibold tabular-nums" aria-live="polite">
        {value}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-9 rounded-full"
        disabled={value >= max}
        onClick={() => onChange(value + 1)}
        aria-label={`${label} +`}
      >
        <Plus />
      </Button>
    </div>
  );
}

/** Scelta tra poche opzioni, a segmenti. */
function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string; hint?: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  const current = options.find((o) => o.value === value);
  return (
    <div className="grid grid-cols-1 gap-1.5" role="radiogroup" aria-label={label}>
      <div className="inline-flex w-full rounded-full border bg-muted/50 p-1">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            onClick={() => onChange(o.value)}
            className={cn(
              'min-w-0 flex-1 truncate rounded-full px-2 py-2 text-sm font-medium transition',
              value === o.value
                ? 'bg-primary text-primary-foreground shadow'
                : 'text-muted-foreground',
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
      {current?.hint && <p className="text-[13px] text-muted-foreground">{current.hint}</p>}
    </div>
  );
}

/** Scelta multipla a pulsanti. */
function Chips<T extends string>({
  values,
  options,
  onChange,
}: {
  values: readonly T[];
  options: { value: T; label: string }[];
  onChange: (v: T[]) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => {
        const on = values.includes(o.value);
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() =>
              onChange(on ? values.filter((v) => v !== o.value) : [...values, o.value])
            }
            className={cn(
              'rounded-full border px-3.5 py-2 text-sm font-medium transition',
              on ? 'border-primary bg-primary/15 text-primary' : 'bg-card hover:bg-muted',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid grid-cols-1 gap-2.5">
      <h3 className="text-sm font-semibold">{title}</h3>
      {children}
    </section>
  );
}

export function NewTripWizard() {
  const { t } = useTranslation();
  const trpc = useTRPC();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: me } = useMe();
  const ai = useAiStatus();
  const keyboard = useKeyboard();
  const [s, setS] = useState<WizardState>(() =>
    patchWizard(loadDraft() ?? emptyWizard(lastOrigin()), {}),
  );
  const [stepIndex, setStepIndex] = useState(0);
  const [creating, setCreating] = useState(false);
  const [bookedOpen, setBookedOpen] = useState(false);
  const create = useMutation(trpc.trips.create.mutationOptions());
  const invite = useMutation(trpc.invitations.create.mutationOptions());
  const generate = useMutation(trpc.ai.start.mutationOptions());

  useEffect(() => saveDraft(s), [s]);
  const aiAvailable = !!ai.data?.available;
  const update = (patch: Partial<WizardState>) => setS((cur) => patchWizard(cur, patch));

  const steps: StepId[] = useMemo(
    () =>
      s.mode === 'ai'
        ? ['where', 'when', 'who', 'mode', 'prefs', 'review']
        : ['where', 'when', 'who', 'mode', 'review'],
    [s.mode],
  );
  const step = steps[Math.min(stepIndex, steps.length - 1)]!;
  const nights = totalNights(s);

  if (!me) return null;
  const currency = isCurrencyCode(me.defaultCurrency) ? me.defaultCurrency : 'EUR';

  const valid: Record<StepId, boolean> = {
    where: !!s.main && !!s.origin && (!s.differentReturn || !!s.returnTo),
    when:
      !!s.start &&
      !!s.end &&
      s.end >= s.start &&
      nights < MAX_DAYS &&
      (s.stops.length === 0 || nightsAssigned(s) === nights),
    who: s.adults >= 1 && peopleCount(s) <= MAX_PEOPLE,
    mode: s.mode !== null && (s.mode === 'empty' || aiAvailable),
    prefs: true,
    review: !!s.main,
  };

  const autoTitle = s.main ? t('wizard.autoTitle', { place: s.main.label.split(',')[0] }) : '';
  const title = s.title.trim() || autoTitle;

  const submit = async () => {
    if (!s.main || !s.origin || !s.mode) return;
    setCreating(true);
    try {
      const adultsExtra = s.adults - 1;
      const names = s.people.slice(0, otherPeople(s)).map((p, i) => ({
        name:
          p.name.trim() ||
          (i < adultsExtra
            ? `${t('wizard.adult')} ${i + 2}`
            : `${t('wizard.child')} ${i - adultsExtra + 1}`),
        email: p.email.trim(),
      }));
      while (names.length < otherPeople(s)) {
        const i = names.length;
        names.push({
          name:
            i < adultsExtra
              ? `${t('wizard.adult')} ${i + 2}`
              : `${t('wizard.child')} ${i - adultsExtra + 1}`,
          email: '',
        });
      }
      const res = await create.mutateAsync({
        title: title.slice(0, 120),
        currency,
        destination: s.main.label.split(',')[0]!.slice(0, 120),
        startDate: s.start,
        endDate: s.end,
        brief: toBrief(s, s.mode),
        participants: names.map((n) => ({ name: n.name })),
      });
      rememberOrigin(s.origin);
      // Chi ha un indirizzo email riceve l'invito: accettandolo prende il posto assegnato.
      for (const [i, p] of res.participants.entries()) {
        const email = names[i]?.email;
        if (!email) continue;
        await invite
          .mutateAsync({ tripId: res.id, memberId: p.id, email })
          .catch(() => toast.warning(t('wizard.inviteFailed', { email })));
      }
      if (s.mode === 'ai') {
        await generate
          .mutateAsync({ tripId: res.id, input: { kind: 'generateTrip' } })
          .catch((err: unknown) =>
            toast.error(
              t(`ai.errors.${err instanceof Error ? err.message : ''}`, {
                defaultValue: t('common.error'),
              }),
            ),
          );
      }
      await queryClient.invalidateQueries({ queryKey: trpc.trips.list.queryKey() });
      saveDraft(null);
      await navigate({ to: '/app/trips/$tripId', params: { tripId: res.id } });
    } catch {
      toast.error(t('common.error'));
      setCreating(false);
    }
  };

  const next = () => {
    if (step === 'review') return void submit();
    setStepIndex((i) => Math.min(i + 1, steps.length - 1));
    window.scrollTo({ top: 0 });
  };
  const back = () => {
    if (stepIndex === 0) return void navigate({ to: '/app' });
    setStepIndex((i) => i - 1);
    window.scrollTo({ top: 0 });
  };

  // ---------------------------------------------------------------------------------- passi

  const whereStep = () => {
    const r = route(s);
    const extra = s.manualOrder ? extraKm(s) : 0;
    const ret = returnPoint(s);
    return (
      <div className="grid grid-cols-1 gap-5">
        <PlaceField
          id="w-main"
          label={t('wizard.main')}
          hint={t('wizard.mainHint')}
          placeholder={t('wizard.mainPlaceholder')}
          value={s.main}
          onChange={(main) => update({ main })}
        />
        <div className="grid grid-cols-1 gap-3">
          <PlaceField
            id="w-origin"
            label={t('wizard.origin')}
            placeholder={t('wizard.originPlaceholder')}
            value={s.origin}
            onChange={(origin) => update({ origin })}
          />
          <label className="flex items-center justify-between gap-4 text-sm">
            <span className="font-medium">{t('wizard.differentReturn')}</span>
            <input
              type="checkbox"
              checked={s.differentReturn}
              onChange={(e) =>
                update({
                  differentReturn: e.target.checked,
                  returnTo: e.target.checked ? s.returnTo : null,
                })
              }
              className="size-5 accent-[var(--primary)]"
            />
          </label>
          {s.differentReturn && (
            <PlaceField
              id="w-return"
              label={t('wizard.returnTo')}
              placeholder={t('wizard.originPlaceholder')}
              value={s.returnTo}
              onChange={(returnTo) => update({ returnTo })}
            />
          )}
        </div>

        <Section title={t('wizard.stops')}>
          <p className="-mt-1.5 text-[13px] text-muted-foreground">{t('wizard.stopsHint')}</p>
          {s.stops.length < MAX_STOPS ? (
            <PlaceField
              id="w-stop"
              label={t('wizard.addStop')}
              placeholder={t('wizard.stopPlaceholder')}
              value={null}
              clearOnPick
              onChange={(p) => p && update({ stops: [...s.stops, { ...p, nights: 1 }] })}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              {t('wizard.maxStops', { max: MAX_STOPS })}
            </p>
          )}
          {s.stops.length > 0 && (
            <ol className="grid grid-cols-1 gap-1.5">
              {s.stops.map((st, i) => (
                <li
                  key={`${st.label}-${i}`}
                  className="flex items-center gap-2 rounded-xl border bg-card px-3 py-2"
                >
                  <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{st.label}</span>
                    {isMainStop(s, st) && (
                      <span className="block text-xs font-medium text-primary">
                        {t('wizard.mainStop')}
                      </span>
                    )}
                    {r && (
                      <span className="block text-xs text-muted-foreground">
                        {t('wizard.legFrom', { km: km(r.legs[i]!) })}
                      </span>
                    )}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    disabled={i === 0}
                    aria-label={t('wizard.moveUp')}
                    onClick={() => {
                      const stops = [...s.stops];
                      [stops[i - 1], stops[i]] = [stops[i]!, stops[i - 1]!];
                      update({ stops, manualOrder: true });
                    }}
                  >
                    <ArrowUp />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    disabled={i === s.stops.length - 1}
                    aria-label={t('wizard.moveDown')}
                    onClick={() => {
                      const stops = [...s.stops];
                      [stops[i + 1], stops[i]] = [stops[i]!, stops[i + 1]!];
                      update({ stops, manualOrder: true });
                    }}
                  >
                    <ArrowDown />
                  </Button>
                  {!isMainStop(s, st) && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-8 text-muted-foreground"
                      aria-label={t('common.delete')}
                      onClick={() =>
                        update({ stops: s.stops.filter((_, j) => j !== i), nightsTouched: false })
                      }
                    >
                      <Trash2 />
                    </Button>
                  )}
                </li>
              ))}
            </ol>
          )}
          {r && ret && (
            <div className="rounded-xl bg-muted/60 p-3 text-sm">
              <p className="font-medium">
                {t('wizard.routeTotal', { km: km(r.total) })}
                {!s.manualOrder && s.stops.length > 1 && (
                  <span className="ml-1.5 font-normal text-muted-foreground">
                    · {t('wizard.autoOrder')}
                  </span>
                )}
              </p>
              {extra > 20 && (
                <p className="mt-1 text-amber-700 dark:text-amber-400">
                  {t('wizard.longerOrder', { km: km(extra) })}{' '}
                  <button
                    type="button"
                    className="font-medium underline"
                    onClick={() => update({ manualOrder: false })}
                  >
                    {t('wizard.useBestOrder')}
                  </button>
                </p>
              )}
            </div>
          )}
          {s.origin && s.stops.length > 0 && ret && (
            <Suspense fallback={<div className="h-56 animate-pulse rounded-xl bg-muted" />}>
              <RouteMap origin={s.origin} stops={s.stops} returnTo={ret} />
            </Suspense>
          )}
        </Section>
      </div>
    );
  };

  const whenStep = () => (
    <div className="grid grid-cols-1 gap-5">
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('trip.form.start')} htmlFor="w-start">
          <Input
            id="w-start"
            type="date"
            value={s.start}
            onChange={(e) =>
              update({
                start: e.target.value,
                end: s.end && s.end < e.target.value ? e.target.value : s.end,
              })
            }
          />
        </Field>
        <Field label={t('trip.form.end')} htmlFor="w-end">
          <Input
            id="w-end"
            type="date"
            min={s.start || undefined}
            value={s.end}
            onChange={(e) => update({ end: e.target.value })}
          />
        </Field>
      </div>
      {s.start && s.end && s.end >= s.start && (
        <p className="flex items-center gap-2 text-sm font-medium">
          <CalendarDays className="size-4 text-primary" />
          {t('wizard.nights', { count: nights })} · {t('wizard.days', { count: nights + 1 })}
        </p>
      )}
      {nights >= MAX_DAYS && (
        <p className="text-sm text-destructive">{t('wizard.tooLong', { max: MAX_DAYS })}</p>
      )}
      {s.stops.length > 0 ? (
        <Section title={t('wizard.nightsPerStop')}>
          <ul className="grid grid-cols-1 gap-1.5">
            {s.stops.map((st, i) => (
              <li
                key={`${st.label}-${i}`}
                className="flex items-center gap-3 rounded-xl border bg-card px-3 py-2"
              >
                <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{st.label}</span>
                <Counter
                  value={st.nights}
                  min={0}
                  max={60}
                  label={t('wizard.nightsLabel')}
                  onChange={(n) =>
                    update({
                      nightsTouched: true,
                      stops: s.stops.map((x, j) => (j === i ? { ...x, nights: n } : x)),
                    })
                  }
                />
              </li>
            ))}
          </ul>
          <p
            className={cn(
              'text-sm',
              nightsAssigned(s) === nights
                ? 'text-muted-foreground'
                : 'font-medium text-destructive',
            )}
          >
            {t('wizard.nightsAssigned', { assigned: nightsAssigned(s), total: nights })}
          </p>
          {nightsAssigned(s) !== nights && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="justify-self-start"
              onClick={() =>
                update({
                  nightsTouched: false,
                  stops: s.stops.map((x, i) => ({
                    ...x,
                    nights: distributeNights(nights, s.stops.length)[i] ?? 0,
                  })),
                })
              }
            >
              {t('wizard.splitEvenly')}
            </Button>
          )}
        </Section>
      ) : (
        s.main && (
          <p className="text-sm text-muted-foreground">
            {t('wizard.allInMain', { place: s.main.label.split(',')[0] })}
          </p>
        )
      )}
    </div>
  );

  const setPerson = (i: number, patch: Partial<{ name: string; email: string }>) =>
    setS((cur) => {
      const people = [...cur.people];
      while (people.length <= i) people.push({ name: '', email: '' });
      people[i] = { ...people[i]!, ...patch };
      return { ...cur, people };
    });

  const whoStep = () => {
    const others = otherPeople(s);
    return (
      <div className="grid grid-cols-1 gap-5">
        <div className="grid grid-cols-1 gap-3">
          <div className="flex items-center justify-between gap-3">
            <span className="font-medium">{t('wizard.adults')}</span>
            <Counter
              value={s.adults}
              min={1}
              max={MAX_PEOPLE - s.children.length}
              label={t('wizard.adults')}
              onChange={(adults) => update({ adults })}
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="font-medium">{t('wizard.children')}</span>
            <Counter
              value={s.children.length}
              min={0}
              max={Math.min(20, MAX_PEOPLE - s.adults)}
              label={t('wizard.children')}
              onChange={(n) =>
                update({ children: Array.from({ length: n }, (_, i) => s.children[i] ?? 8) })
              }
            />
          </div>
        </div>
        <Section title={t('wizard.whoTravels', { count: peopleCount(s) })}>
          <p className="-mt-1.5 text-[13px] text-muted-foreground">{t('wizard.whoHint')}</p>
          <div className="flex items-center gap-2 rounded-xl border bg-card px-3 py-2.5 text-sm">
            <Users className="size-4 text-primary" />
            <span className="font-medium">{me.name}</span>
            <span className="text-muted-foreground">({t('wizard.you')})</span>
          </div>
          {Array.from({ length: others }, (_, i) => {
            const child = i >= s.adults - 1;
            const ci = i - (s.adults - 1);
            const p = s.people[i] ?? { name: '', email: '' };
            return (
              <div key={i} className="grid grid-cols-1 gap-2 rounded-xl border bg-card p-3">
                <div className="flex items-center gap-2">
                  <Input
                    value={p.name}
                    maxLength={80}
                    onChange={(e) => setPerson(i, { name: e.target.value })}
                    placeholder={
                      child ? `${t('wizard.child')} ${ci + 1}` : `${t('wizard.adult')} ${i + 2}`
                    }
                    aria-label={t('wizard.name')}
                    className="min-w-0 flex-1"
                  />
                  {child && (
                    <Select
                      className="w-28 shrink-0"
                      value={String(s.children[ci] ?? 8)}
                      aria-label={t('wizard.age')}
                      onChange={(e) =>
                        update({
                          children: s.children.map((a, j) =>
                            j === ci ? Number(e.target.value) : a,
                          ),
                        })
                      }
                    >
                      {Array.from({ length: 18 }, (_, a) => (
                        <option key={a} value={a}>
                          {t('wizard.years', { count: a })}
                        </option>
                      ))}
                    </Select>
                  )}
                </div>
                {!child && (
                  <Input
                    type="email"
                    value={p.email}
                    onChange={(e) => setPerson(i, { email: e.target.value })}
                    placeholder={t('wizard.emailOptional')}
                    aria-label={t('wizard.email')}
                  />
                )}
              </div>
            );
          })}
        </Section>
      </div>
    );
  };

  const modeStep = () => (
    <div className="grid grid-cols-1 gap-3">
      {(
        [
          {
            mode: 'ai' as const,
            icon: <Sparkles className="size-6 text-accent" />,
            title: t('wizard.modeAi'),
            text: t('wizard.modeAiText'),
            disabled: !aiAvailable,
          },
          {
            mode: 'empty' as const,
            icon: <Pencil className="size-6 text-primary" />,
            title: t('wizard.modeEmpty'),
            text: t('wizard.modeEmptyText'),
            disabled: false,
          },
        ] as const
      )
        .filter((o) => aiAvailable || o.mode === 'empty')
        .map((o) => (
          <button
            key={o.mode}
            type="button"
            onClick={() => setS((cur) => ({ ...cur, mode: o.mode }))}
            aria-pressed={s.mode === o.mode}
            className={cn(
              'flex items-start gap-4 rounded-2xl border p-4 text-left transition',
              s.mode === o.mode
                ? 'border-primary bg-primary/10 ring-2 ring-primary/40'
                : 'bg-card hover:bg-muted',
            )}
          >
            <span className="mt-0.5">{o.icon}</span>
            <span>
              <span className="block text-base font-semibold">{o.title}</span>
              <span className="mt-0.5 block text-sm text-muted-foreground">{o.text}</span>
            </span>
          </button>
        ))}
    </div>
  );

  const setAi = (patch: Partial<AiPrefs>) =>
    setS((cur) => ({ ...cur, ai: { ...cur.ai, ...patch } }));

  const prefsStep = () => (
    <div className="grid grid-cols-1 gap-6">
      <Section title={t('wizard.prefs.types')}>
        <Chips
          values={s.ai.types}
          onChange={(types) => setAi({ types })}
          options={TRIP_TYPES.map((v) => ({ value: v, label: t(`wizard.prefs.type.${v}`) }))}
        />
      </Section>
      <Section title={t('wizard.prefs.intensity')}>
        <Segmented
          label={t('wizard.prefs.intensity')}
          value={s.ai.intensity}
          onChange={(intensity) => setAi({ intensity })}
          options={INTENSITIES.map((v) => ({
            value: v,
            label: t(`wizard.prefs.intensities.${v}`),
            hint: t(`wizard.prefs.intensityHint.${v}`),
          }))}
        />
      </Section>
      <Section title={t('wizard.prefs.transport')}>
        <Chips
          values={s.ai.transport}
          onChange={(transport) => setAi({ transport })}
          options={TRANSPORT_PREFS.map((v) => ({
            value: v,
            label: t(`wizard.prefs.transports.${v}`),
          }))}
        />
      </Section>
      <Section title={t('wizard.prefs.experience')}>
        <Segmented
          label={t('wizard.prefs.experience')}
          value={s.ai.experience}
          onChange={(experience) => setAi({ experience })}
          options={EXPERIENCES.map((v) => ({
            value: v,
            label: t(`wizard.prefs.experiences.${v}`),
            hint: t(`wizard.prefs.experienceHint.${v}`),
          }))}
        />
      </Section>
      <Section title={t('wizard.prefs.budget')}>
        <Segmented
          label={t('wizard.prefs.budget')}
          value={s.ai.budget}
          onChange={(budget) => setAi({ budget })}
          options={BUDGET_TIERS.map((v) => ({
            value: v,
            label: t(`wizard.prefs.budgets.${v}`),
            hint: t(`wizard.prefs.budgetHint.${v}`),
          }))}
        />
      </Section>
      <Section title={t('wizard.prefs.lodging')}>
        <Select
          value={s.ai.lodging}
          onChange={(e) => setAi({ lodging: e.target.value as AiPrefs['lodging'] })}
          aria-label={t('wizard.prefs.lodging')}
        >
          {LODGINGS.map((v) => (
            <option key={v} value={v}>
              {t(`wizard.prefs.lodgings.${v}`)}
            </option>
          ))}
        </Select>
      </Section>
      <Section title={t('wizard.prefs.needs')}>
        <Chips
          values={s.ai.needs}
          onChange={(needs) => setAi({ needs })}
          options={NEEDS.map((v) => ({ value: v, label: t(`wizard.prefs.needsList.${v}`) }))}
        />
      </Section>
      <Section title={t('wizard.prefs.booked')}>
        {bookedOpen || s.ai.booked ? (
          <textarea
            rows={3}
            maxLength={1500}
            className={textareaClass}
            value={s.ai.booked ?? ''}
            onChange={(e) => setAi({ booked: e.target.value })}
            placeholder={t('wizard.prefs.bookedPlaceholder')}
            aria-label={t('wizard.prefs.booked')}
          />
        ) : (
          <Button
            type="button"
            variant="outline"
            className="justify-self-start"
            onClick={() => setBookedOpen(true)}
          >
            <Plus />
            {t('wizard.prefs.bookedAdd')}
          </Button>
        )}
      </Section>
      <Section title={t('wizard.prefs.notes')}>
        <textarea
          rows={4}
          maxLength={1500}
          className={textareaClass}
          value={s.ai.notes ?? ''}
          onChange={(e) => setAi({ notes: e.target.value })}
          placeholder={t('wizard.prefs.notesPlaceholder')}
          aria-label={t('wizard.prefs.notes')}
        />
      </Section>
    </div>
  );

  const row = (target: StepId, label: string, value: ReactNode) => (
    <button
      type="button"
      onClick={() => setStepIndex(steps.indexOf(target))}
      className="flex w-full items-start gap-3 rounded-xl border bg-card px-4 py-3 text-left hover:bg-muted"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-medium text-muted-foreground">{label}</span>
        <span className="mt-0.5 block text-sm font-medium">{value}</span>
      </span>
      <Pencil className="mt-1 size-4 shrink-0 text-muted-foreground" />
    </button>
  );

  const reviewStep = () => {
    const r = route(s);
    return (
      <div className="grid grid-cols-1 gap-3">
        <Field label={t('wizard.tripName')} htmlFor="w-title">
          <Input
            id="w-title"
            value={s.title}
            maxLength={120}
            placeholder={autoTitle}
            onChange={(e) => setS((cur) => ({ ...cur, title: e.target.value }))}
          />
        </Field>
        {row(
          'where',
          t('wizard.reviewWhere'),
          <>
            {s.origin?.label.split(',')[0]}
            {s.stops.map((st) => ` → ${st.label.split(',')[0]}`).join('')}
            {s.stops.length === 0 && ` → ${s.main?.label.split(',')[0]}`}
            {` → ${(returnPoint(s)?.label ?? '').split(',')[0]}`}
            {r && (
              <span className="block text-xs font-normal text-muted-foreground">
                {t('wizard.routeTotal', { km: km(r.total) })}
              </span>
            )}
          </>,
        )}
        {row(
          'when',
          t('wizard.reviewWhen'),
          <>
            {s.start} → {s.end} · {t('wizard.nights', { count: nights })}
            {s.stops.length > 0 && (
              <span className="block text-xs font-normal text-muted-foreground">
                {s.stops.map((st) => `${st.label.split(',')[0]} ${st.nights}`).join(' · ')}
              </span>
            )}
          </>,
        )}
        {row(
          'who',
          t('wizard.reviewWho'),
          t('wizard.peopleSummary', { adults: s.adults, children: s.children.length }),
        )}
        {row(
          'mode',
          t('wizard.reviewMode'),
          s.mode === 'ai' ? `✨ ${t('wizard.modeAi')}` : t('wizard.modeEmpty'),
        )}
        {s.mode === 'ai' && (
          <p className="rounded-xl bg-muted/60 p-3 text-[13px] text-muted-foreground">
            {t('wizard.aiNotice')}
          </p>
        )}
      </div>
    );
  };

  const content: Record<StepId, ReactNode> = {
    where: whereStep(),
    when: whenStep(),
    who: whoStep(),
    mode: modeStep(),
    prefs: prefsStep(),
    review: reviewStep(),
  };

  return (
    <div className="mx-auto max-w-xl pb-44">
      <div className="mb-5">
        <p className="text-sm font-medium text-muted-foreground">
          {t('wizard.step', { n: stepIndex + 1, total: steps.length })}
        </p>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-300"
            style={{ width: `${((stepIndex + 1) / steps.length) * 100}%` }}
          />
        </div>
        <h1 className="mt-4 text-2xl font-bold tracking-tight">{t(`wizard.titles.${step}`)}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t(`wizard.texts.${step}`)}</p>
      </div>

      {content[step]}

      {creating && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-background/80 backdrop-blur-sm">
          <div className="flex items-center gap-3 rounded-2xl border bg-card px-5 py-4 shadow-lg">
            <Loader2 className="animate-spin text-primary" />
            <span className="font-medium">{t('wizard.creating')}</span>
          </div>
        </div>
      )}

      <div
        className={cn(
          'fixed inset-x-0 z-20 border-t bg-background/95 px-4 py-3 backdrop-blur',
          keyboard.open
            ? 'bottom-0'
            : 'bottom-[calc(4rem+env(safe-area-inset-bottom))] lg:bottom-0 lg:pl-[260px]',
        )}
      >
        <div className="mx-auto flex max-w-xl items-center gap-3">
          <Button type="button" variant="ghost" onClick={back} disabled={creating}>
            {stepIndex === 0 ? <X /> : <ChevronLeft />}
            {stepIndex === 0 ? t('common.cancel') : t('steps.back')}
          </Button>
          <div className="flex-1" />
          <Button size="lg" onClick={next} disabled={!valid[step] || creating}>
            {step === 'review' ? (
              <>
                {s.mode === 'ai' ? <Sparkles /> : null}
                {t(s.mode === 'ai' ? 'wizard.createAi' : 'wizard.create')}
              </>
            ) : (
              <>
                {t('steps.next')}
                <ChevronRight />
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

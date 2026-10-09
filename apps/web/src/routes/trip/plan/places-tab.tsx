import {
  CheckCircle2,
  CircleHelp,
  ExternalLink,
  Loader2,
  MapPin,
  CalendarPlus,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { isCurrencyCode } from '@tripshare/shared';
import {
  PLACE_KINDS,
  type Activity,
  type Place,
  type TripDocument,
} from '@tripshare/shared/trip-format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Step, StepForm } from '@/components/ui/steps';
import { Field, Input, Select } from '@/components/ui/input';
import { toast } from 'sonner';
import { useAiStatus, useAiTask } from '@/lib/ai';
import { money, shortDate, todayIso } from '@/lib/format';
import { mapsUrl, PLACE_KIND_EMOJI, usePlan, usePlanOps } from '@/lib/plan';
import type { TripDetail } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useOnAdd } from '@/lib/fab';

interface VerifyResult {
  openingHours?: string;
  price?: Place['price'];
  verified: boolean;
  sources: { title: string; url: string }[];
  notes?: string;
}
import {
  cleanLines,
  formatLinks,
  LinesField,
  moneyDraft,
  MoneyFields,
  moneyFromDraft,
  moneyLabel,
  parseLinks,
  textareaClass,
} from './fields';
import { confirmDialog } from '@/components/confirm';

export function PlacesTab({ trip }: { trip: TripDetail }) {
  const { t } = useTranslation();
  const { data } = usePlan(trip.id);
  const [editing, setEditing] = useState<Place | 'new' | null>(null);
  useOnAdd('places', () => setEditing('new'));
  const canEdit = trip.role !== 'viewer';
  const ai = useAiStatus();
  const { run } = useAiTask();
  const { apply } = usePlanOps(trip.id);
  const [verifying, setVerifying] = useState<string | null>(null);
  const [scheduling, setScheduling] = useState<Place | null>(null);
  const verify = async (p: Place) => {
    setVerifying(p.id);
    try {
      const r = await run<VerifyResult>(trip.id, { kind: 'verify', placeId: p.id });
      if (!r) return;
      const tips = r.notes && !p.tips.includes(r.notes) ? [...p.tips, r.notes].slice(-10) : p.tips;
      await apply([
        {
          type: 'upsertPlace',
          place: {
            ...p,
            ...(r.openingHours ? { openingHours: r.openingHours } : {}),
            ...(r.price ? { price: r.price } : {}),
            tips,
            verification: {
              status: r.verified ? 'verified' : 'unverified',
              checkedAt: todayIso(),
              sources: r.sources,
            },
          },
        },
      ]);
      if (r.verified) toast.success(t('ai.verify.verified', { name: p.name }));
      else toast.warning(t('ai.verify.unverified', { name: p.name }));
    } finally {
      setVerifying(null);
    }
  };
  if (!data) return <Loader2 className="mx-auto mt-10 animate-spin text-muted-foreground" />;
  const { plan } = data;

  // In quali giorni compare ogni luogo.
  const daysOf = (id: string) =>
    plan.days
      .filter((d) =>
        [...d.activities, ...d.alternatives.flatMap((a) => a.activities)].some((a) =>
          a.placeIds.includes(id),
        ),
      )
      .map((d) => d.date);

  return (
    <div className="grid grid-cols-1 gap-4 pb-8">
      {plan.places.length === 0 && (
        <p className="rounded-xl border border-dashed px-6 py-10 text-center text-sm text-muted-foreground">
          {t('plan.place.empty')}
        </p>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {plan.places.map((p) => {
          const days = daysOf(p.id);
          const verified = p.verification?.status === 'verified';
          return (
            <Card
              key={p.id}
              onClick={() => canEdit && setEditing(p)}
              className={cn(
                'flex flex-col gap-2 p-4',
                canEdit && 'cursor-pointer transition hover:bg-muted/40',
              )}
            >
              <div className="flex items-start gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary text-xl">
                  {PLACE_KIND_EMOJI[p.kind]}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{p.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {t(`plan.placeKinds.${p.kind}`)}
                    {days.length > 0 && ` · ${days.map((d) => shortDate(d)).join(', ')}`}
                  </p>
                </div>
                {p.verification && (
                  <Badge
                    variant={verified ? 'success' : 'warning'}
                    title={
                      p.verification.checkedAt ? shortDate(p.verification.checkedAt) : undefined
                    }
                  >
                    {verified ? (
                      <CheckCircle2 className="size-3.5" />
                    ) : (
                      <CircleHelp className="size-3.5" />
                    )}
                    {verified ? t('plan.place.verified') : t('plan.place.toCheck')}
                  </Badge>
                )}
              </div>
              {p.openingHours && <p className="text-sm">🕘 {p.openingHours}</p>}
              {(p.price || p.priceLevel) && (
                <p className="text-sm">
                  💶 {p.price ? moneyLabel(p.price, t, money) : ''}
                  {p.priceLevel ? ` ${'€'.repeat(p.priceLevel)}` : ''}
                </p>
              )}
              {p.description && <p className="text-sm text-muted-foreground">{p.description}</p>}
              {p.tips.map((tip, i) => (
                <p key={i} className="text-sm text-muted-foreground">
                  💡 {tip}
                </p>
              ))}
              <div
                className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-1 text-sm"
                onClick={(e) => e.stopPropagation()}
              >
                <a
                  href={mapsUrl(p.mapsQuery ?? p.address ?? p.name)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                >
                  <MapPin className="size-4" />
                  {t('plan.place.map')}
                </a>
                {[...p.links, ...(p.verification?.sources ?? [])].map((l) => (
                  <a
                    key={l.url}
                    href={l.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-primary hover:underline"
                  >
                    {l.title}
                    <ExternalLink className="size-3.5" />
                  </a>
                ))}
                {canEdit && (
                  <span className="ml-auto flex gap-1">
                    {ai.data?.available && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={verifying !== null}
                        onClick={() => verify(p)}
                        title={t('ai.verify.hint')}
                      >
                        {verifying === p.id ? <Loader2 className="animate-spin" /> : <Sparkles />}
                        {t('ai.verify.button')}
                      </Button>
                    )}
                    {plan.days.length > 0 && (
                      <Button size="sm" variant="outline" onClick={() => setScheduling(p)}>
                        <CalendarPlus />
                        {t('plan.place.schedule')}
                      </Button>
                    )}
                  </span>
                )}
              </div>
            </Card>
          );
        })}
      </div>
      {scheduling && (
        <ScheduleDialog
          trip={trip}
          plan={plan}
          place={scheduling}
          onClose={() => setScheduling(null)}
        />
      )}
      {editing && (
        <PlaceDialog
          tripId={trip.id}
          plan={plan}
          place={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function PlaceDialog({
  tripId,
  plan,
  place,
  onClose,
}: {
  tripId: string;
  plan: TripDocument;
  place?: Place;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { apply, pending } = usePlanOps(tripId);
  const currency = isCurrencyCode(plan.trip.currency) ? plan.trip.currency : 'EUR';
  const init = () => ({
    name: place?.name ?? '',
    kind: place?.kind ?? ('sight' as Place['kind']),
    address: place?.address ?? '',
    mapsQuery: place?.mapsQuery ?? '',
    openingHours: place?.openingHours ?? '',
    price: moneyDraft(place?.price, currency),
    priceLevel: place?.priceLevel ? String(place.priceLevel) : '',
    description: place?.description ?? '',
    tips: place?.tips ?? [],
    links: formatLinks(place?.links ?? []),
    verified: place?.verification?.status ?? 'unverified',
    checkedAt: place?.verification?.checkedAt ?? '',
    sources: formatLinks(place?.verification?.sources ?? []),
  });
  const [d, setD] = useState(init);
  useEffect(() => {
    setD(init());
  }, [place?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = <K extends keyof ReturnType<typeof init>>(k: K, v: ReturnType<typeof init>[K]) =>
    setD((p) => ({ ...p, [k]: v }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const sources = parseLinks(d.sources);
    await apply([
      {
        type: 'upsertPlace',
        place: {
          ...(place ? { id: place.id } : {}),
          name: d.name.trim(),
          kind: d.kind,
          ...(d.address.trim() ? { address: d.address.trim() } : {}),
          ...(d.mapsQuery.trim() ? { mapsQuery: d.mapsQuery.trim() } : {}),
          ...(place?.location ? { location: place.location } : {}),
          ...(d.openingHours.trim() ? { openingHours: d.openingHours.trim() } : {}),
          ...(moneyFromDraft(d.price) ? { price: moneyFromDraft(d.price) } : {}),
          ...(d.priceLevel ? { priceLevel: Number(d.priceLevel) } : {}),
          ...(place?.meals ? { meals: place.meals } : {}),
          ...(d.description.trim() ? { description: d.description.trim() } : {}),
          tips: cleanLines(d.tips),
          links: parseLinks(d.links),
          ...(d.verified === 'verified' || place?.verification
            ? {
                verification: {
                  status: d.verified,
                  ...(d.checkedAt ? { checkedAt: d.checkedAt } : {}),
                  sources,
                },
              }
            : {}),
        },
      },
    ]);
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={place ? t('plan.place.editTitle') : t('plan.place.add')}>
        <StepForm
          onSubmit={submit}
          freeNavigation={!!place}
          pending={pending}
          submitLabel={t('common.save')}
          submitDisabled={!d.name.trim()}
          leading={
            place && (
              <Button
                type="button"
                variant="ghost"
                className="text-destructive"
                aria-label={t('expense.delete')}
                disabled={pending}
                onClick={async () => {
                  if (!(await confirmDialog(t('plan.place.confirmDelete')))) return;
                  await apply([{ type: 'deletePlace', id: place.id }]);
                  onClose();
                }}
              >
                <Trash2 />
                <span className="hidden sm:inline">{t('expense.delete')}</span>
              </Button>
            )
          }
        >
          <Step title={t('plan.place.stepWhat')}>
            <div className="grid grid-cols-[1fr_auto] gap-3">
              <Field label={t('plan.place.name')} htmlFor="pl-name">
                <Input
                  id="pl-name"
                  required
                  maxLength={160}
                  value={d.name}
                  onChange={(e) => set('name', e.target.value)}
                />
              </Field>
              <Field label={t('plan.place.kind')} htmlFor="pl-kind">
                <Select
                  id="pl-kind"
                  className="w-44"
                  value={d.kind}
                  onChange={(e) => set('kind', e.target.value as Place['kind'])}
                >
                  {PLACE_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {PLACE_KIND_EMOJI[k]} {t(`plan.placeKinds.${k}`)}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field label={t('plan.place.address')} htmlFor="pl-addr">
              <Input
                id="pl-addr"
                maxLength={240}
                value={d.address}
                onChange={(e) => set('address', e.target.value)}
              />
            </Field>
            <Field
              label={t('plan.place.mapsQuery')}
              htmlFor="pl-maps"
              hint={t('plan.place.mapsQueryHint')}
            >
              <Input
                id="pl-maps"
                maxLength={240}
                value={d.mapsQuery}
                onChange={(e) => set('mapsQuery', e.target.value)}
              />
            </Field>
          </Step>
          <Step title={t('plan.place.stepInfo')}>
            <Field label={t('plan.place.hours')} htmlFor="pl-hours">
              <Input
                id="pl-hours"
                maxLength={400}
                placeholder="9:30–17:00"
                value={d.openingHours}
                onChange={(e) => set('openingHours', e.target.value)}
              />
            </Field>
            <MoneyFields
              idPrefix="pl"
              label={t('plan.place.price')}
              value={d.price}
              onChange={(v) => set('price', v)}
            />
            <Field label={t('plan.place.priceLevel')} htmlFor="pl-level">
              <Select
                id="pl-level"
                value={d.priceLevel}
                onChange={(e) => set('priceLevel', e.target.value)}
              >
                <option value="">—</option>
                {[1, 2, 3, 4].map((n) => (
                  <option key={n} value={n}>
                    {'€'.repeat(n)}
                  </option>
                ))}
              </Select>
            </Field>
          </Step>
          <Step title={t('plan.place.stepMore')}>
            <Field label={t('plan.activity.description')} htmlFor="pl-desc">
              <textarea
                id="pl-desc"
                rows={2}
                maxLength={1000}
                className={textareaClass}
                value={d.description}
                onChange={(e) => set('description', e.target.value)}
              />
            </Field>
            <LinesField
              id="pl-tips"
              label={`💡 ${t('plan.activity.tips')}`}
              hint={t('plan.onePerLine')}
              value={d.tips}
              onChange={(v) => set('tips', v)}
            />
            <Field label={`🔗 ${t('plan.links')}`} htmlFor="pl-links" hint={t('plan.linksHint')}>
              <textarea
                id="pl-links"
                rows={2}
                className={textareaClass}
                value={d.links}
                onChange={(e) => set('links', e.target.value)}
              />
            </Field>
            <div className="grid grid-cols-1 gap-3 rounded-xl border p-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label={t('plan.place.verification')} htmlFor="pl-ver">
                  <Select
                    id="pl-ver"
                    value={d.verified}
                    onChange={(e) => set('verified', e.target.value as 'verified' | 'unverified')}
                  >
                    <option value="unverified">{t('plan.place.toCheck')}</option>
                    <option value="verified">{t('plan.place.verified')}</option>
                  </Select>
                </Field>
                <Field label={t('plan.place.checkedAt')} htmlFor="pl-checked">
                  <Input
                    id="pl-checked"
                    type="date"
                    value={d.checkedAt}
                    onChange={(e) => set('checkedAt', e.target.value)}
                  />
                </Field>
              </div>
              <Field
                label={t('plan.place.sources')}
                htmlFor="pl-sources"
                hint={t('plan.linksHint')}
              >
                <textarea
                  id="pl-sources"
                  rows={2}
                  className={textareaClass}
                  value={d.sources}
                  onChange={(e) => set('sources', e.target.value)}
                />
              </Field>
            </div>
          </Step>
        </StepForm>
      </DialogContent>
    </Dialog>
  );
}

const ACTIVITY_OF: Partial<Record<Place['kind'], Activity['type']>> = {
  restaurant: 'meal',
  cafe: 'meal',
  bar: 'meal',
  shop: 'shopping',
  lodging: 'checkin',
  airport: 'travel',
  station: 'travel',
  nature: 'activity',
};

/** Aggiunge la visita a un luogo nel programma, nel giorno scelto (o suggerito dall'AI). */
function ScheduleDialog({
  trip,
  plan,
  place,
  onClose,
}: {
  trip: TripDetail;
  plan: TripDocument;
  place: Place;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const ai = useAiStatus();
  const { run, running } = useAiTask();
  const { apply, pending } = usePlanOps(trip.id);
  const [date, setDate] = useState(plan.days[0]?.date ?? '');
  const [time, setTime] = useState('');
  const [duration, setDuration] = useState<number | undefined>();
  const [reason, setReason] = useState<string | null>(null);

  const suggest = async () => {
    const r = await run<{ date: string; time?: string; durationMin?: number; reason: string }>(
      trip.id,
      { kind: 'schedule', placeId: place.id },
    );
    if (!r) return;
    setDate(r.date);
    setTime(r.time ?? '');
    setDuration(r.durationMin);
    setReason(r.reason);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    await apply([
      {
        type: 'upsertActivity',
        date,
        activity: {
          title: place.name,
          type: ACTIVITY_OF[place.kind] ?? 'visit',
          emoji: PLACE_KIND_EMOJI[place.kind],
          placeIds: [place.id],
          ...(time ? { time } : {}),
          ...(duration ? { durationMin: duration } : {}),
          ...(place.price ? { cost: place.price } : {}),
        },
      },
    ]);
    toast.success(t('plan.place.scheduled', { name: place.name }));
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={t('plan.place.scheduleTitle')} description={place.name}>
        <form onSubmit={submit} className="grid grid-cols-1 gap-4 pt-2">
          {ai.data?.available && (
            <Button
              type="button"
              variant="outline"
              className="w-full border-dashed"
              disabled={running}
              onClick={suggest}
            >
              {running ? <Loader2 className="animate-spin" /> : <Sparkles />}
              {t('plan.place.suggestDay')}
            </Button>
          )}
          {reason && (
            <p className="rounded-xl bg-secondary px-4 py-3 text-sm text-secondary-foreground">
              ✨ {reason}
            </p>
          )}
          <div className="grid grid-cols-[1fr_auto] gap-3">
            <Field label={t('plan.activity.day')} htmlFor="sch-day">
              <Select id="sch-day" value={date} onChange={(e) => setDate(e.target.value)}>
                {plan.days.map((d, i) => (
                  <option key={d.date} value={d.date}>
                    {t('plan.dayN', { n: i + 1 })} · {shortDate(d.date)} · {d.title}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('plan.activity.time')} htmlFor="sch-time">
              <Input
                id="sch-time"
                type="time"
                className="w-32"
                value={time}
                onChange={(e) => setTime(e.target.value)}
              />
            </Field>
          </div>
          <Button type="submit" size="lg" className="justify-self-end" disabled={pending || !date}>
            {pending && <Loader2 className="animate-spin" />}
            {t('plan.place.addToPlan')}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

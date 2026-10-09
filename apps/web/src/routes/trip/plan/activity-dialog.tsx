import { Smile, Trash2 } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { isCurrencyCode, type CurrencyCode } from '@tripshare/shared';
import {
  ACTIVITY_TYPES,
  TRANSPORT_MODES,
  type Activity,
  type TripDocument,
} from '@tripshare/shared/trip-format';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Step, StepForm } from '@/components/ui/steps';
import { EmojiPicker } from '@/components/ui/emoji-picker';
import { Field, Input, Select } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { longDate } from '@/lib/format';
import { ACTIVITY_TYPE_EMOJI, PLACE_KIND_EMOJI, TRANSPORT_EMOJI, usePlanOps } from '@/lib/plan';
import { cn } from '@/lib/utils';
import {
  cleanLines,
  formatLinks,
  LinesField,
  moneyDraft,
  MoneyFields,
  moneyFromDraft,
  parseLinks,
  textareaClass,
  type MoneyDraft,
} from './fields';

interface Draft {
  date: string;
  time: string;
  endTime: string;
  type: Activity['type'];
  emoji: string | null;
  title: string;
  description: string;
  placeIds: string[];
  bookingId: string;
  hasTransport: boolean;
  mode: NonNullable<Activity['transport']>['mode'];
  duration: string;
  distance: string;
  route: string;
  transportCost: MoneyDraft;
  cost: MoneyDraft;
  warnings: string[];
  tips: string[];
  links: string;
}

function toDraft(activity: Activity | undefined, date: string, currency: CurrencyCode): Draft {
  const tr = activity?.transport;
  return {
    date,
    time: activity?.time ?? '',
    endTime: activity?.endTime ?? '',
    type: activity?.type ?? 'visit',
    emoji: activity?.emoji ?? null,
    title: activity?.title ?? '',
    description: activity?.description ?? '',
    placeIds: activity?.placeIds ?? [],
    bookingId: activity?.bookingId ?? '',
    hasTransport: !!tr,
    mode: tr?.mode ?? 'car',
    duration: tr?.durationMinutes ? String(tr.durationMinutes) : '',
    distance: tr?.distanceKm ? String(tr.distanceKm) : '',
    route: tr?.route ?? '',
    transportCost: moneyDraft(tr?.cost, currency),
    cost: moneyDraft(activity?.cost, currency),
    warnings: activity?.warnings ?? [],
    tips: activity?.tips ?? [],
    links: formatLinks(activity?.links ?? []),
  };
}

export function ActivityDialog({
  tripId,
  plan,
  date,
  activity,
  alternativeId,
  open,
  onOpenChange,
}: {
  tripId: string;
  plan: TripDocument;
  date: string;
  activity?: Activity;
  alternativeId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const currency = isCurrencyCode(plan.trip.currency) ? plan.trip.currency : 'EUR';
  const [d, setD] = useState(() => toDraft(activity, date, currency));
  const [pickerOpen, setPickerOpen] = useState(false);
  const [newPlace, setNewPlace] = useState('');
  const { apply, pending } = usePlanOps(tripId);

  useEffect(() => {
    if (open) setD(toDraft(activity, date, currency));
  }, [open, activity?.id, date]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((prev) => ({ ...prev, [k]: v }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const ops = [];
    const placeIds = [...d.placeIds];
    if (newPlace.trim()) {
      // Il luogo nuovo prende un id derivato dal nome: si crea prima dell'attività.
      const existingIds = new Set(plan.places.map((p) => p.id));
      const base =
        newPlace
          .trim()
          .normalize('NFD')
          .replace(/[̀-ͯ]/g, '')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '')
          .slice(0, 40) || 'luogo';
      let id = base;
      for (let n = 2; existingIds.has(id); n++) id = `${base}-${n}`;
      ops.push({
        type: 'upsertPlace' as const,
        place: { id, name: newPlace.trim(), kind: 'other' as const, mapsQuery: newPlace.trim() },
      });
      placeIds.push(id);
    }
    const duration = parseInt(d.duration, 10);
    const distance = Number(d.distance.replace(',', '.'));
    const next: Activity = {
      id: activity?.id ?? '',
      ...(d.time ? { time: d.time } : {}),
      ...(d.endTime ? { endTime: d.endTime } : {}),
      type: d.type,
      ...(d.emoji ? { emoji: d.emoji } : {}),
      title: d.title.trim(),
      ...(d.description.trim() ? { description: d.description.trim() } : {}),
      placeIds,
      ...(d.bookingId ? { bookingId: d.bookingId } : {}),
      ...(d.hasTransport
        ? {
            transport: {
              mode: d.mode,
              ...(duration > 0 ? { durationMinutes: duration } : {}),
              ...(distance > 0 ? { distanceKm: distance } : {}),
              ...(d.route.trim() ? { route: d.route.trim() } : {}),
              ...(moneyFromDraft(d.transportCost) ? { cost: moneyFromDraft(d.transportCost) } : {}),
              alternatives: activity?.transport?.alternatives ?? [],
            },
          }
        : {}),
      ...(moneyFromDraft(d.cost) ? { cost: moneyFromDraft(d.cost) } : {}),
      warnings: cleanLines(d.warnings),
      tips: cleanLines(d.tips),
      links: parseLinks(d.links),
    };
    const { id, ...withoutId } = next;
    ops.push({
      type: 'upsertActivity' as const,
      date,
      activity: activity ? next : withoutId,
      ...(alternativeId && !activity ? { alternativeId } : {}),
    });
    if (activity && d.date !== date)
      ops.push({ type: 'moveActivity' as const, id: id, date: d.date });
    await apply(ops);
    setNewPlace('');
    onOpenChange(false);
  };

  const shownEmoji = d.emoji ?? ACTIVITY_TYPE_EMOJI[d.type];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={activity ? t('plan.activity.editTitle') : t('plan.activity.newTitle')}
        description={longDate(date)}
      >
        <StepForm
          onSubmit={submit}
          freeNavigation={!!activity}
          pending={pending}
          submitLabel={t('common.save')}
          submitDisabled={!d.title.trim()}
          leading={
            activity && (
              <Button
                type="button"
                variant="ghost"
                className="text-destructive"
                disabled={pending}
                onClick={async () => {
                  if (!confirm(t('plan.activity.confirmDelete'))) return;
                  await apply([{ type: 'deleteActivity', id: activity.id }]);
                  onOpenChange(false);
                }}
              >
                <Trash2 />
                <span className="hidden sm:inline">{t('expense.delete')}</span>
              </Button>
            )
          }
        >
          <Step title={t('plan.activity.stepWhat')}>
            <div className="flex items-end gap-3">
              <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-secondary text-3xl"
                    aria-label={t('profile.chooseEmoji')}
                  >
                    {shownEmoji || <Smile />}
                  </button>
                </PopoverTrigger>
                <PopoverContent>
                  <EmojiPicker
                    onSelect={(emoji) => {
                      set('emoji', emoji);
                      setPickerOpen(false);
                    }}
                  />
                </PopoverContent>
              </Popover>
              <Field label={t('plan.activity.title')} htmlFor="act-title" className="flex-1">
                <Input
                  id="act-title"
                  required
                  maxLength={160}
                  value={d.title}
                  onChange={(e) => set('title', e.target.value)}
                />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Field label={t('plan.activity.time')} htmlFor="act-time">
                <Input
                  id="act-time"
                  type="time"
                  value={d.time}
                  onChange={(e) => set('time', e.target.value)}
                />
              </Field>
              <Field label={t('plan.activity.endTime')} htmlFor="act-end">
                <Input
                  id="act-end"
                  type="time"
                  value={d.endTime}
                  onChange={(e) => set('endTime', e.target.value)}
                />
              </Field>
              <Field
                label={t('plan.activity.type')}
                htmlFor="act-type"
                className="col-span-2 sm:col-span-1"
              >
                <Select
                  id="act-type"
                  value={d.type}
                  onChange={(e) => set('type', e.target.value as Activity['type'])}
                >
                  {ACTIVITY_TYPES.map((x) => (
                    <option key={x} value={x}>
                      {ACTIVITY_TYPE_EMOJI[x]} {t(`plan.activityTypes.${x}`)}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            <Field label={t('plan.activity.description')} htmlFor="act-desc">
              <textarea
                id="act-desc"
                rows={3}
                maxLength={1500}
                className={textareaClass}
                value={d.description}
                onChange={(e) => set('description', e.target.value)}
              />
            </Field>
          </Step>
          <Step title={t('plan.activity.stepWhere')}>
            <div className="grid grid-cols-1 gap-2">
              <span className="text-sm font-medium">{t('plan.activity.places')}</span>
              {plan.places.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {plan.places.map((p) => {
                    const on = d.placeIds.includes(p.id);
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() =>
                          set(
                            'placeIds',
                            on ? d.placeIds.filter((x) => x !== p.id) : [...d.placeIds, p.id],
                          )
                        }
                        className={cn(
                          'rounded-full border px-3 py-1 text-sm',
                          on
                            ? 'border-primary bg-primary/10 font-semibold text-primary'
                            : 'hover:bg-muted',
                        )}
                      >
                        {PLACE_KIND_EMOJI[p.kind]} {p.name}
                      </button>
                    );
                  })}
                </div>
              )}
              <Input
                placeholder={t('plan.activity.newPlace')}
                value={newPlace}
                onChange={(e) => setNewPlace(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {plan.bookings.length > 0 && (
                <Field label={t('plan.activity.booking')} htmlFor="act-booking">
                  <Select
                    id="act-booking"
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
              {activity && !alternativeId && (
                <Field label={t('plan.activity.day')} htmlFor="act-day">
                  <Select id="act-day" value={d.date} onChange={(e) => set('date', e.target.value)}>
                    {plan.days.map((day) => (
                      <option key={day.date} value={day.date}>
                        {longDate(day.date)} · {day.title}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
            </div>

            <div className="grid grid-cols-1 gap-3 rounded-xl border p-3">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  className="accent-[var(--primary)]"
                  checked={d.hasTransport}
                  onChange={(e) => set('hasTransport', e.target.checked)}
                />
                {t('plan.activity.transport')}
              </label>
              {d.hasTransport && (
                <>
                  <div className="grid grid-cols-3 gap-2">
                    <Select
                      value={d.mode}
                      onChange={(e) => set('mode', e.target.value as Draft['mode'])}
                      aria-label={t('plan.activity.mode')}
                    >
                      {TRANSPORT_MODES.map((m) => (
                        <option key={m} value={m}>
                          {TRANSPORT_EMOJI[m]} {t(`plan.modes.${m}`)}
                        </option>
                      ))}
                    </Select>
                    <Input
                      inputMode="numeric"
                      placeholder={t('plan.activity.minutes')}
                      value={d.duration}
                      onChange={(e) => set('duration', e.target.value)}
                    />
                    <Input
                      inputMode="decimal"
                      placeholder="km"
                      value={d.distance}
                      onChange={(e) => set('distance', e.target.value)}
                    />
                  </div>
                  <Input
                    placeholder={t('plan.activity.route')}
                    value={d.route}
                    onChange={(e) => set('route', e.target.value)}
                  />
                  <MoneyFields
                    idPrefix="tr"
                    label={t('plan.activity.transportCost')}
                    value={d.transportCost}
                    onChange={(v) => set('transportCost', v)}
                  />
                </>
              )}
            </div>
          </Step>
          <Step title={t('plan.activity.stepMore')}>
            <MoneyFields
              idPrefix="cost"
              label={t('plan.activity.cost')}
              value={d.cost}
              onChange={(v) => set('cost', v)}
            />
            <LinesField
              id="act-warn"
              label={`⚠️ ${t('plan.activity.warnings')}`}
              hint={t('plan.onePerLine')}
              value={d.warnings}
              onChange={(v) => set('warnings', v)}
            />
            <LinesField
              id="act-tips"
              label={`💡 ${t('plan.activity.tips')}`}
              value={d.tips}
              onChange={(v) => set('tips', v)}
            />
            <Field label={`🔗 ${t('plan.links')}`} htmlFor="act-links" hint={t('plan.linksHint')}>
              <textarea
                id="act-links"
                rows={2}
                className={textareaClass}
                value={d.links}
                onChange={(e) => set('links', e.target.value)}
              />
            </Field>
          </Step>
        </StepForm>
      </DialogContent>
    </Dialog>
  );
}

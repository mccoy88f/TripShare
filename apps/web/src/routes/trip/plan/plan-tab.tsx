import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  CalendarPlus,
  ExternalLink,
  Lightbulb,
  Loader2,
  MapPin,
  Pencil,
  Plus,
  Shuffle,
  Trash2,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { Activity, Day, TripDocument } from '@tripshare/shared/trip-format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/input';
import { longDate, money, shortDate, todayIso } from '@/lib/format';
import {
  ACTIVITY_TYPE_EMOJI,
  BOOKING_EMOJI,
  mapsUrl,
  minutesLabel,
  PLACE_KIND_EMOJI,
  TRANSPORT_EMOJI,
  usePlan,
  usePlanOps,
  weatherEmoji,
} from '@/lib/plan';
import { useTRPC } from '@/lib/trpc';
import type { TripDetail } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useOnAdd } from '@/lib/fab';
import { ActivityDialog } from './activity-dialog';
import { moneyLabel, textareaClass } from './fields';
import { GeneratePlanButton } from './generate-trip';
import { ImportPlanButton } from './import-export';
import { myTickets, TicketViewer, useTickets, type Ticket } from './tickets';
import { confirmDialog } from '@/components/confirm';

type Weather = {
  date: string;
  code: number;
  max: number;
  min: number;
  precipitation: number | null;
  sunset: string | null;
  sunrise: string | null;
  /** Località delle previsioni per quel giorno. */
  place?: string;
};

export function PlanTab({ trip }: { trip: TripDetail }) {
  const { t } = useTranslation();
  const trpc = useTRPC();
  const { data } = usePlan(trip.id);
  const weather = useQuery({
    ...trpc.plan.weather.queryOptions({ tripId: trip.id }),
    staleTime: 3600_000,
  });
  const { apply, pending } = usePlanOps(trip.id);
  const canEdit = trip.role !== 'viewer';
  const plan = data?.plan;
  const [selected, setSelected] = useState<string | null>(null);
  /** Consiglio in modifica: indice nella lista, oppure -1 per uno nuovo. */
  const [tipIndex, setTipIndex] = useState<number | null>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  useOnAdd('plan', () => {
    if (plan && plan.days.length === 0) toast.info(t('trip.fab.noDays'));
  });

  // Giorno iniziale: oggi se è nel viaggio, altrimenti il primo.
  useEffect(() => {
    if (!plan || selected) return;
    const today = todayIso();
    setSelected(plan.days.find((d) => d.date === today)?.date ?? plan.days[0]?.date ?? null);
  }, [plan, selected]);

  const weatherByDate = useMemo(
    () => new Map((weather.data?.days ?? []).map((w: Weather) => [w.date, w])),
    [weather.data],
  );

  if (!plan) return <Loader2 className="mx-auto mt-10 animate-spin text-muted-foreground" />;

  if (plan.days.length === 0) {
    return (
      <div className="grid place-items-center gap-4 rounded-xl border border-dashed px-6 py-14 text-center">
        <span className="text-5xl">🗺️</span>
        <div>
          <p className="font-semibold">{t('plan.empty')}</p>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">
            {trip.startDate ? t('plan.emptyText') : t('plan.emptyNoDates')}
          </p>
        </div>
        {canEdit && (
          <div className="flex flex-wrap justify-center gap-2">
            {trip.startDate && (
              <Button
                disabled={pending}
                onClick={() =>
                  apply([
                    {
                      type: 'ensureDays',
                      start: trip.startDate!,
                      end: trip.endDate ?? trip.startDate!,
                      titlePrefix: t('plan.dayPrefix'),
                    },
                  ])
                }
              >
                <CalendarPlus />
                {t('plan.createDays')}
              </Button>
            )}
            <GeneratePlanButton trip={trip} />
            <ImportPlanButton tripId={trip.id} />
          </div>
        )}
      </div>
    );
  }

  const day = plan.days.find((d) => d.date === selected) ?? plan.days[0]!;

  return (
    <div className="grid grid-cols-1 gap-5 pb-8">
      <div
        ref={stripRef}
        className="-mx-4 flex snap-x scroll-px-4 gap-2 overflow-x-auto px-4 pt-0.5 pb-2 [scrollbar-width:none] lg:mx-0 lg:scroll-px-0 lg:px-0"
      >
        {plan.days.map((d, i) => {
          const w = weatherByDate.get(d.date);
          const active = d.date === day.date;
          return (
            <button
              key={d.date}
              onClick={() => setSelected(d.date)}
              className={cn(
                'flex w-40 shrink-0 snap-start flex-col items-start rounded-xl border px-3 py-2 text-left transition',
                active
                  ? 'border-primary bg-primary text-primary-foreground shadow-md'
                  : 'bg-card hover:bg-muted',
              )}
            >
              <span
                className={cn(
                  'text-[11px] font-semibold tracking-wide uppercase',
                  active ? 'opacity-85' : 'text-muted-foreground',
                )}
              >
                {t('plan.dayN', { n: i + 1 })} · {shortDate(d.date)}
              </span>
              <span className="line-clamp-2 text-sm leading-tight font-semibold">{d.title}</span>
              {w && (
                <span className={cn('text-xs', active ? 'opacity-85' : 'text-muted-foreground')}>
                  {weatherEmoji(w.code)} {Math.round(w.max)}° / {Math.round(w.min)}°
                </span>
              )}
            </button>
          );
        })}
        {canEdit && <AddDayButton tripId={trip.id} plan={plan} />}
      </div>

      <DayView
        trip={trip}
        plan={plan}
        day={day}
        weather={weatherByDate.get(day.date)}
        canEdit={canEdit}
      />

      {(plan.tips.length > 0 || (canEdit && plan.days.length > 0)) && (
        <section>
          <div className="mb-2 flex items-center justify-between px-1">
            <h3 className="text-sm font-semibold">💡 {t('plan.tips')}</h3>
            {canEdit && (
              <Button size="sm" variant="ghost" onClick={() => setTipIndex(-1)}>
                <Plus />
                {t('plan.tip.add')}
              </Button>
            )}
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {plan.tips.map((tip, i) => (
              <Card
                key={i}
                className={cn('p-4', canEdit && 'cursor-pointer transition hover:bg-muted/40')}
                onClick={() => canEdit && setTipIndex(i)}
              >
                <p className="font-semibold">{tip.title}</p>
                <p className="mt-1 text-sm text-muted-foreground">{tip.text}</p>
              </Card>
            ))}
          </div>
        </section>
      )}
      {tipIndex !== null && (
        <TipDialog
          tip={plan.tips[tipIndex]}
          pending={pending}
          onClose={() => setTipIndex(null)}
          onSave={async (tip) => {
            const tips =
              tipIndex < 0
                ? [...plan.tips, tip]
                : plan.tips.map((x, i) => (i === tipIndex ? tip : x));
            await apply([{ type: 'setTips', tips }]);
            setTipIndex(null);
          }}
          onDelete={
            tipIndex < 0
              ? undefined
              : async () => {
                  if (!(await confirmDialog(t('plan.tip.confirmDelete')))) return;
                  await apply([
                    { type: 'setTips', tips: plan.tips.filter((_, i) => i !== tipIndex) },
                  ]);
                  setTipIndex(null);
                }
          }
        />
      )}
      {plan.disclaimer && <p className="px-1 text-xs text-muted-foreground">{plan.disclaimer}</p>}
      {weather.data?.status === 'OK' && (
        <p className="px-1 text-xs text-muted-foreground">{t('plan.weatherSource')}</p>
      )}
    </div>
  );
}

function AddDayButton({ tripId, plan }: { tripId: string; plan: TripDocument }) {
  const { t } = useTranslation();
  const { apply, pending } = usePlanOps(tripId);
  const last = plan.days.at(-1)?.date;
  return (
    <button
      disabled={pending || !last}
      onClick={() => {
        const next = new Date(`${last}T12:00:00Z`);
        next.setUTCDate(next.getUTCDate() + 1);
        const date = next.toISOString().slice(0, 10);
        void apply([
          { type: 'upsertDay', day: { date, title: t('plan.dayN', { n: plan.days.length + 1 }) } },
        ]);
      }}
      className="flex min-w-[5rem] items-center justify-center rounded-xl border border-dashed px-3 text-muted-foreground hover:bg-muted"
      aria-label={t('plan.addDay')}
    >
      <Plus className="size-5" />
    </button>
  );
}

function DayView({
  trip,
  plan,
  day,
  weather,
  canEdit,
}: {
  trip: TripDetail;
  plan: TripDocument;
  day: Day;
  weather?: Weather;
  canEdit: boolean;
}) {
  const { t } = useTranslation();
  const { data: tickets } = useTickets(trip.id);
  const [viewing, setViewing] = useState<{ list: Ticket[]; index: number } | null>(null);
  const ticketProps = (a: Activity) => {
    const list = a.bookingId ? myTickets(tickets, trip.myMemberId, a.bookingId) : [];
    return list.length
      ? { ticketCount: list.length, onTickets: () => setViewing({ list, index: 0 }) }
      : {};
  };
  const { apply, pending } = usePlanOps(trip.id);
  const [editing, setEditing] = useState<{ activity?: Activity; alternativeId?: string } | null>(
    null,
  );
  useOnAdd('plan', () => setEditing({}));
  const [editDay, setEditDay] = useState(false);
  const stay = day.stayBookingId
    ? plan.bookings.find((b) => b.id === day.stayBookingId)
    : undefined;
  const index = plan.days.findIndex((d) => d.date === day.date);

  return (
    <section className="grid grid-cols-1 gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            {t('plan.dayN', { n: index + 1 })} · {longDate(day.date)}
          </p>
          <h2 className="text-2xl font-bold tracking-tight">{day.title}</h2>
          {day.route.length > 0 && (
            <p className="mt-1 text-sm text-muted-foreground">{day.route.join(' → ')}</p>
          )}
          <div className="mt-2 flex flex-wrap gap-2 text-sm">
            {stay && (
              <Badge variant="outline" className="text-sm font-medium">
                🛏️ {t('plan.night')}: {stay.title}
              </Badge>
            )}
            {weather && (
              <Badge variant="outline" className="text-sm font-medium">
                {weatherEmoji(weather.code)} {weather.place && `${weather.place} `}
                {Math.round(weather.max)}° / {Math.round(weather.min)}°
                {weather.precipitation != null && ` · 💧 ${weather.precipitation}%`}
                {weather.sunset && ` · 🌇 ${weather.sunset}`}
              </Badge>
            )}
          </div>
          {day.summary && <p className="mt-2 max-w-2xl text-sm">{day.summary}</p>}
        </div>
        {canEdit && (
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setEditDay(true)}>
              <Pencil />
              {t('plan.editDay')}
            </Button>
          </div>
        )}
      </div>

      {day.activities.length === 0 ? (
        <div className="rounded-xl border border-dashed px-6 py-10 text-center text-sm text-muted-foreground">
          {t('plan.noActivities')}
        </div>
      ) : (
        <ol className="relative grid gap-3 before:absolute before:top-3 before:bottom-3 before:left-[3.15rem] before:w-px before:bg-border">
          {day.activities.map((a) => (
            <ActivityCard
              key={a.id}
              plan={plan}
              activity={a}
              {...ticketProps(a)}
              onEdit={canEdit ? () => setEditing({ activity: a }) : undefined}
            />
          ))}
        </ol>
      )}

      {day.alternatives.map((alt) => (
        <Card key={alt.id} className="border-dashed border-accent/40 bg-accent/5 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold tracking-wide text-accent uppercase">
                <Shuffle className="mr-1 inline size-3.5" />
                {t('plan.alternative')}
              </p>
              <p className="font-semibold">{alt.title}</p>
              {alt.when && <p className="text-sm text-muted-foreground">{alt.when}</p>}
              {alt.tradeoffs && <p className="mt-1 text-sm">{alt.tradeoffs}</p>}
            </div>
            {canEdit && (
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => apply([{ type: 'applyAlternative', id: alt.id }])}
              >
                {t('plan.useAlternative')}
              </Button>
            )}
          </div>
          <ol className="mt-3 grid gap-2">
            {alt.activities.map((a) => (
              <ActivityCard
                key={a.id}
                plan={plan}
                activity={a}
                compact
                onEdit={
                  canEdit ? () => setEditing({ activity: a, alternativeId: alt.id }) : undefined
                }
              />
            ))}
          </ol>
        </Card>
      ))}

      {editing && (
        <ActivityDialog
          tripId={trip.id}
          plan={plan}
          date={day.date}
          activity={editing.activity}
          alternativeId={editing.alternativeId}
          open
          onOpenChange={(open) => !open && setEditing(null)}
        />
      )}
      {viewing && (
        <TicketViewer
          trip={trip}
          bookings={plan.bookings}
          tickets={viewing.list}
          index={viewing.index}
          onClose={() => setViewing(null)}
        />
      )}
      <DayDialog tripId={trip.id} plan={plan} day={day} open={editDay} onOpenChange={setEditDay} />
    </section>
  );
}

function ActivityCard({
  plan,
  activity: a,
  ticketCount,
  onTickets,
  onEdit,
  compact,
}: {
  plan: TripDocument;
  activity: Activity;
  ticketCount?: number;
  onTickets?: () => void;
  onEdit?: () => void;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const places = a.placeIds.map((id) => plan.places.find((p) => p.id === id)).filter((p) => !!p);
  const booking = a.bookingId ? plan.bookings.find((b) => b.id === a.bookingId) : undefined;
  const tr = a.transport;
  const fmt = (minor: number, cur: string) => money(minor, cur);
  return (
    <li className="relative grid grid-cols-[2.6rem_1.1rem_1fr] items-start gap-2">
      <span className="tabular pt-3 text-right text-sm font-semibold text-muted-foreground">
        {a.time ?? ''}
      </span>
      <span
        className={cn(
          'relative z-10 mt-3.5 size-3 justify-self-center rounded-full border-2 border-card',
          compact ? 'bg-accent' : 'bg-primary',
        )}
      />
      <div
        role={onEdit ? 'button' : undefined}
        tabIndex={onEdit ? 0 : undefined}
        onClick={onEdit}
        onKeyDown={(e) => e.key === 'Enter' && onEdit?.()}
        className={cn(
          'min-w-0 rounded-xl border bg-card p-3.5 shadow-xs',
          onEdit && 'cursor-pointer transition hover:border-primary/40 hover:shadow-md',
        )}
      >
        <div className="flex items-start gap-2.5">
          <span className="text-xl leading-6">{a.emoji ?? ACTIVITY_TYPE_EMOJI[a.type]}</span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold">
              {a.title}
              {a.endTime && (
                <span className="tabular ml-2 text-sm font-normal text-muted-foreground">
                  → {a.endTime}
                </span>
              )}
            </p>
            {a.description && <p className="mt-1 text-sm text-muted-foreground">{a.description}</p>}
          </div>
        </div>
        {(tr || a.cost || booking || onTickets) && (
          <div className="mt-2.5 flex flex-wrap gap-1.5 text-xs">
            {tr && (
              <span className="rounded-full bg-secondary px-2.5 py-1 font-medium text-secondary-foreground">
                {TRANSPORT_EMOJI[tr.mode]} {t(`plan.modes.${tr.mode}`)}
                {tr.durationMinutes ? ` · ${minutesLabel(tr.durationMinutes)}` : ''}
                {tr.distanceKm ? ` · ${tr.distanceKm} km` : ''}
                {tr.route ? ` · ${tr.route}` : ''}
                {tr.cost ? ` · ${moneyLabel(tr.cost, t, fmt)}` : ''}
              </span>
            )}
            {tr?.alternatives.map((alt, i) => (
              <span key={i} className="rounded-full border px-2.5 py-1 text-muted-foreground">
                {t('plan.or')} {TRANSPORT_EMOJI[alt.mode]} {t(`plan.modes.${alt.mode}`)}
                {alt.durationMinutes ? ` · ${minutesLabel(alt.durationMinutes)}` : ''}
                {alt.cost ? ` · ${moneyLabel(alt.cost, t, fmt)}` : ''}
              </span>
            ))}
            {a.cost && (
              <span className="rounded-full bg-muted px-2.5 py-1 font-medium">
                💶 {moneyLabel(a.cost, t, fmt)}
              </span>
            )}
            {booking && (
              <span className="rounded-full bg-muted px-2.5 py-1 font-medium">
                {BOOKING_EMOJI[booking.type]} {booking.title}
                {booking.status === 'to_book' && ` · ${t('plan.bookingStatus.to_book')}`}
              </span>
            )}
            {onTickets && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onTickets();
                }}
                className="rounded-full bg-gradient-to-r from-primary to-accent px-2.5 py-1 font-semibold text-white"
              >
                🎫 {t('tickets.show', { count: ticketCount })}
              </button>
            )}
          </div>
        )}
        {places.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {places.map((p) => (
              <a
                key={p.id}
                href={mapsUrl(p.mapsQuery ?? p.address ?? p.name)}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary/10"
              >
                <MapPin className="size-3.5" />
                {PLACE_KIND_EMOJI[p.kind]} {p.name}
              </a>
            ))}
          </div>
        )}
        {a.warnings.length > 0 && (
          <div className="mt-2.5 grid gap-1 rounded-lg bg-warning/15 px-3 py-2 text-sm">
            {a.warnings.map((w, i) => (
              <p key={i} className="flex gap-2">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
                {w}
              </p>
            ))}
          </div>
        )}
        {a.tips.length > 0 && (
          <div className="mt-2 grid gap-1 text-sm text-muted-foreground">
            {a.tips.map((tip, i) => (
              <p key={i} className="flex gap-2">
                <Lightbulb className="mt-0.5 size-4 shrink-0" />
                {tip}
              </p>
            ))}
          </div>
        )}
        {a.links.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm">
            {a.links.map((l) => (
              <a
                key={l.url}
                href={l.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1 text-primary hover:underline"
              >
                {l.title}
                <ExternalLink className="size-3.5" />
              </a>
            ))}
          </div>
        )}
      </div>
    </li>
  );
}

function DayDialog({
  tripId,
  plan,
  day,
  open,
  onOpenChange,
}: {
  tripId: string;
  plan: TripDocument;
  day: Day;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { t } = useTranslation();
  const { apply, pending } = usePlanOps(tripId);
  const [title, setTitle] = useState(day.title);
  const [route, setRoute] = useState(day.route.join(', '));
  const [summary, setSummary] = useState(day.summary ?? '');
  const [stay, setStay] = useState(day.stayBookingId ?? '');
  useEffect(() => {
    if (!open) return;
    setTitle(day.title);
    setRoute(day.route.join(', '));
    setSummary(day.summary ?? '');
    setStay(day.stayBookingId ?? '');
  }, [open, day]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    await apply([
      {
        type: 'upsertDay',
        day: {
          date: day.date,
          title: title.trim(),
          route: route
            .split(',')
            .map((r) => r.trim())
            .filter(Boolean),
          summary: summary.trim() || null,
          stayBookingId: stay || null,
        },
      },
    ]);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={t('plan.editDay')} description={longDate(day.date)}>
        <form onSubmit={submit} className="grid grid-cols-1 gap-4 pt-2">
          <Field label={t('plan.dayTitle')} htmlFor="day-title">
            <Input
              id="day-title"
              required
              maxLength={160}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </Field>
          <Field label={t('plan.route')} htmlFor="day-route" hint={t('plan.routeHint')}>
            <Input id="day-route" value={route} onChange={(e) => setRoute(e.target.value)} />
          </Field>
          <Field label={t('plan.summary')} htmlFor="day-summary">
            <textarea
              id="day-summary"
              rows={2}
              maxLength={600}
              className={textareaClass}
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
            />
          </Field>
          {plan.bookings.some((b) => b.type === 'lodging') && (
            <Field label={t('plan.night')} htmlFor="day-stay">
              <Select id="day-stay" value={stay} onChange={(e) => setStay(e.target.value)}>
                <option value="">—</option>
                {plan.bookings
                  .filter((b) => b.type === 'lodging')
                  .map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.title}
                    </option>
                  ))}
              </Select>
            </Field>
          )}
          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant="ghost"
              className="text-destructive"
              disabled={pending}
              onClick={async () => {
                if (!(await confirmDialog(t('plan.confirmDeleteDay')))) return;
                await apply([{ type: 'deleteDay', date: day.date }]);
                onOpenChange(false);
              }}
            >
              {t('plan.deleteDay')}
            </Button>
            <div className="flex-1" />
            <Button type="submit" disabled={pending || !title.trim()}>
              {pending && <Loader2 className="animate-spin" />}
              {t('common.save')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TipDialog({
  tip,
  pending,
  onClose,
  onSave,
  onDelete,
}: {
  tip?: { title: string; text: string };
  pending: boolean;
  onClose: () => void;
  onSave: (tip: { title: string; text: string }) => Promise<void>;
  onDelete?: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(tip?.title ?? '');
  const [text, setText] = useState(tip?.text ?? '');
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={tip ? t('plan.tip.edit') : t('plan.tip.add')}>
        <form
          className="grid grid-cols-1 gap-4 pt-2"
          onSubmit={(e) => {
            e.preventDefault();
            void onSave({ title: title.trim(), text: text.trim() });
          }}
        >
          <Field label={t('plan.tip.title')} htmlFor="tip-title">
            <Input
              id="tip-title"
              required
              maxLength={120}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </Field>
          <Field label={t('plan.tip.text')} htmlFor="tip-text">
            <textarea
              id="tip-text"
              required
              maxLength={600}
              className={textareaClass}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </Field>
          <div className="mt-2 flex items-center gap-2">
            {onDelete && (
              <Button
                type="button"
                variant="ghost"
                className="text-destructive"
                aria-label={t('expense.delete')}
                disabled={pending}
                onClick={onDelete}
              >
                <Trash2 />
                <span className="hidden sm:inline">{t('expense.delete')}</span>
              </Button>
            )}
            <div className="flex-1" />
            <Button type="submit" size="lg" disabled={pending || !title.trim() || !text.trim()}>
              {t('common.save')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

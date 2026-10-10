import { useQuery } from '@tanstack/react-query';
import { Loader2, Receipt, Ticket as TicketIcon, Trash2 } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { isCurrencyCode, type CurrencyCode, type ExpenseCategory } from '@tripshare/shared';
import { BOOKING_TYPES, type Booking, type TripDocument } from '@tripshare/shared/trip-format';
import { moneyToTripMinor } from '@tripshare/shared/trip-format/budget';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useDetailMode } from '@/lib/detail-mode';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Step, StepForm } from '@/components/ui/steps';
import { Field, Input, Select } from '@/components/ui/input';
import { money, shortDate } from '@/lib/format';
import { BOOKING_EMOJI, usePlan, usePlanOps } from '@/lib/plan';
import { useTRPC } from '@/lib/trpc';
import { cn } from '@/lib/utils';
import type { ExpenseT, TripDetail } from '@/lib/types';
import { useOnAdd } from '@/lib/fab';
import { ExpenseDialog, type ExpensePreset } from '../expense-dialog';
import { myTickets, TicketsDialog, TicketViewer, useTickets, type Ticket } from './tickets';
import {
  formatLinks,
  moneyDraft,
  MoneyFields,
  moneyFromDraft,
  moneyLabel,
  parseLinks,
  textareaClass,
} from './fields';
import { confirmDialog } from '@/components/confirm';
import { searchId } from '@/lib/search-focus';

const CATEGORY_OF: Record<Booking['type'], ExpenseCategory> = {
  flight: 'flights',
  lodging: 'lodging',
  car_rental: 'car',
  parking: 'parking',
  train: 'transport',
  bus: 'transport',
  ferry: 'transport',
  tour: 'activities',
  ticket: 'tickets',
  insurance: 'insurance',
  other: 'other',
};

function nights(b: Booking) {
  if (!b.end?.date) return 1;
  return Math.max(1, Math.round((Date.parse(b.end.date) - Date.parse(b.start.date)) / 86_400_000));
}

/** Spesa precompilata da una prenotazione (importo totale nella valuta della prenotazione). */
export function expenseFromBooking(b: Booking, travelers: number): ExpensePreset {
  const currency = b.cost && isCurrencyCode(b.cost.currency) ? b.cost.currency : undefined;
  const amount =
    b.cost && currency
      ? moneyToTripMinor(
          b.cost,
          { tripCurrency: currency, travelers, days: 1, rates: {} },
          nights(b),
        )
      : null;
  return {
    title: b.title,
    emoji: BOOKING_EMOJI[b.type],
    category: CATEGORY_OF[b.type],
    date: b.start.date,
    bookingId: b.id,
    // Se la prenotazione non risulta pagata la spesa nasce "da pagare": conta nel budget ma
    // non nei saldi finché qualcuno non la segna come pagata.
    status: b.paid === true ? 'paid' : 'planned',
    ...(amount && currency ? { amount, currency } : {}),
  };
}

export function BookingsTab({ trip }: { trip: TripDetail }) {
  const { t } = useTranslation();
  const { data } = usePlan(trip.id);
  const [editing, setEditing] = useState<Booking | 'new' | null>(null);
  useOnAdd('bookings', () => setEditing('new'));
  const [expense, setExpense] = useState<ExpensePreset | null>(null);
  const [editingExpense, setEditingExpense] = useState<ExpenseT | undefined>();
  const trpc = useTRPC();
  const { data: expenses } = useQuery(trpc.expenses.list.queryOptions({ tripId: trip.id }));
  const [ticketsOf, setTicketsOf] = useState<Booking | null>(null);
  const [viewing, setViewing] = useState<{ list: Ticket[]; index: number } | null>(null);
  const { data: tickets } = useTickets(trip.id);
  const canEdit = trip.role !== 'viewer';
  if (!data) return <Loader2 className="mx-auto mt-10 animate-spin text-muted-foreground" />;
  const { plan } = data;
  const bookings = [...plan.bookings].sort((a, b) =>
    `${a.start.date}${a.start.time ?? ''}`.localeCompare(`${b.start.date}${b.start.time ?? ''}`),
  );

  const linked = (b: Booking) => expenses?.find((e) => e.bookingId === b.id);
  // I biglietti che riguardano me (assegnati a me o a tutti), nell'ordine delle prenotazioni.
  const mine = myTickets(tickets, trip.myMemberId).sort(
    (a, b) =>
      bookings.findIndex((x) => x.id === a.bookingId) -
      bookings.findIndex((x) => x.id === b.bookingId),
  );

  return (
    <div className="grid grid-cols-1 gap-4 pb-8">
      {mine.length > 0 && (
        <section className="grid grid-cols-1 gap-2">
          <h3 className="px-1 text-sm font-semibold">🎫 {t('tickets.mine')}</h3>
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] lg:mx-0 lg:px-0">
            {mine.map((tk, i) => {
              const b = bookings.find((x) => x.id === tk.bookingId);
              return (
                <button
                  key={tk.id}
                  onClick={() => setViewing({ list: mine, index: i })}
                  className="flex w-44 shrink-0 flex-col items-start rounded-xl bg-gradient-to-br from-primary to-accent p-3 text-left text-white shadow-md transition active:scale-[0.98]"
                >
                  <span className="text-xl">{b ? BOOKING_EMOJI[b.type] : '🎫'}</span>
                  <span className="line-clamp-2 text-sm font-semibold">
                    {b?.title ?? t('tickets.ticket')}
                  </span>
                  {b && (
                    <span className="text-xs opacity-85">
                      {shortDate(b.start.date)}
                      {b.start.time && ` ${b.start.time}`}
                    </span>
                  )}
                  {tk.label && <span className="line-clamp-1 text-xs opacity-85">{tk.label}</span>}
                </button>
              );
            })}
          </div>
        </section>
      )}
      {bookings.length === 0 && (
        <p className="rounded-xl border border-dashed px-6 py-10 text-center text-sm text-muted-foreground">
          {t('plan.booking.empty')}
        </p>
      )}
      <div className="grid grid-cols-1 gap-3">
        {bookings.map((b) => (
          <Card
            key={b.id}
            {...searchId(`booking:${b.id}`)}
            onClick={() => canEdit && setEditing(b)}
            className={cn(
              'grid grid-cols-1 gap-3 p-4',
              canEdit && 'cursor-pointer transition hover:bg-muted/40',
            )}
          >
            <div className="flex items-start gap-3">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-secondary text-xl">
                {BOOKING_EMOJI[b.type]}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold">{b.title}</p>
                  <Badge
                    variant={
                      b.status === 'booked'
                        ? 'success'
                        : b.status === 'to_book'
                          ? 'warning'
                          : 'outline'
                    }
                  >
                    {t(`plan.bookingStatus.${b.status}`)}
                  </Badge>
                </div>
                <p className="tabular text-sm text-muted-foreground">
                  {shortDate(b.start.date)}
                  {b.start.time && ` ${b.start.time}`}
                  {b.end && ` → ${shortDate(b.end.date)}${b.end.time ? ` ${b.end.time}` : ''}`}
                  {b.provider && ` · ${b.provider}`}
                  {b.confirmationCode && ` · #${b.confirmationCode}`}
                </p>
                {b.flight && (
                  <p className="text-sm">
                    ✈️ {b.flight.number} · {b.flight.from} → {b.flight.to}
                  </p>
                )}
                {b.notes && <p className="mt-1 text-sm text-muted-foreground">{b.notes}</p>}
              </div>
              {(b.cost || b.paid === false) && (
                <div className="flex shrink-0 flex-col items-end text-right">
                  {b.cost && (
                    <span className="tabular font-semibold whitespace-nowrap">
                      {moneyLabel(b.cost, t, money)}
                    </span>
                  )}
                  {b.cost && b.paid === false && (
                    <span className="text-xs text-muted-foreground">
                      {t('plan.booking.payOnSite')}
                    </span>
                  )}
                </div>
              )}
            </div>
            <div
              className="flex flex-wrap justify-end gap-1.5"
              onClick={(e) => e.stopPropagation()}
            >
              {(canEdit || (tickets ?? []).some((x) => x.bookingId === b.id)) && (
                <Button size="sm" variant="outline" onClick={() => setTicketsOf(b)}>
                  <TicketIcon />
                  {t('tickets.button', {
                    count: (tickets ?? []).filter((x) => x.bookingId === b.id).length,
                  })}
                </Button>
              )}
              {linked(b) ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!canEdit}
                  onClick={() => setEditingExpense(linked(b))}
                >
                  {linked(b)!.status === 'planned'
                    ? `⏳ ${t('expense.planned')}`
                    : `✅ ${t('expense.paidStatus')}`}
                </Button>
              ) : (
                canEdit && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setExpense(expenseFromBooking(b, plan.trip.travelers))}
                  >
                    <Receipt />
                    {t('plan.booking.toExpense')}
                  </Button>
                )
              )}
            </div>
          </Card>
        ))}
      </div>
      {ticketsOf && (
        <TicketsDialog
          trip={trip}
          booking={ticketsOf}
          onClose={() => setTicketsOf(null)}
          onView={(list, index) => setViewing({ list, index })}
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
      {editing && (
        <BookingDialog
          tripId={trip.id}
          plan={plan}
          booking={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      )}
      {expense && (
        <ExpenseDialog
          trip={trip}
          preset={expense}
          open
          onOpenChange={(o) => !o && setExpense(null)}
        />
      )}
      <ExpenseDialog
        trip={trip}
        expense={editingExpense}
        open={!!editingExpense}
        onOpenChange={(o) => !o && setEditingExpense(undefined)}
      />
    </div>
  );
}

function BookingDialog({
  tripId,
  plan,
  booking,
  onClose,
}: {
  tripId: string;
  plan: TripDocument;
  booking?: Booking;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const detail = useDetailMode(!!booking, booking?.id);
  const { apply, pending } = usePlanOps(tripId);
  const currency = (
    isCurrencyCode(plan.trip.currency) ? plan.trip.currency : 'EUR'
  ) as CurrencyCode;
  const init = () => ({
    type: booking?.type ?? ('lodging' as Booking['type']),
    title: booking?.title ?? '',
    status: booking?.status ?? ('booked' as Booking['status']),
    provider: booking?.provider ?? '',
    code: booking?.confirmationCode ?? '',
    startDate: booking?.start.date ?? plan.trip.startDate ?? '',
    startTime: booking?.start.time ?? '',
    endDate: booking?.end?.date ?? '',
    endTime: booking?.end?.time ?? '',
    placeId: booking?.placeId ?? '',
    flightNumber: booking?.flight?.number ?? '',
    flightFrom: booking?.flight?.from ?? '',
    flightTo: booking?.flight?.to ?? '',
    cost: moneyDraft(booking?.cost, currency),
    paid: booking?.paid === undefined ? '' : booking.paid ? 'yes' : 'no',
    notes: booking?.notes ?? '',
    links: formatLinks(booking?.links ?? []),
  });
  const [d, setD] = useState(init);
  useEffect(() => {
    setD(init());
  }, [booking?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = <K extends keyof ReturnType<typeof init>>(k: K, v: ReturnType<typeof init>[K]) =>
    setD((p) => ({ ...p, [k]: v }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    await apply([
      {
        type: 'upsertBooking',
        booking: {
          ...(booking ? { id: booking.id } : {}),
          type: d.type,
          title: d.title.trim(),
          status: d.status,
          ...(d.provider.trim() ? { provider: d.provider.trim() } : {}),
          ...(d.code.trim() ? { confirmationCode: d.code.trim() } : {}),
          start: { date: d.startDate, ...(d.startTime ? { time: d.startTime } : {}) },
          ...(d.endDate
            ? { end: { date: d.endDate, ...(d.endTime ? { time: d.endTime } : {}) } }
            : {}),
          ...(d.placeId ? { placeId: d.placeId } : {}),
          ...(d.type === 'flight' && d.flightNumber.trim()
            ? {
                flight: {
                  number: d.flightNumber.trim(),
                  from: d.flightFrom.trim(),
                  to: d.flightTo.trim(),
                },
              }
            : {}),
          ...(moneyFromDraft(d.cost) ? { cost: moneyFromDraft(d.cost) } : {}),
          ...(d.paid ? { paid: d.paid === 'yes' } : {}),
          ...(d.notes.trim() ? { notes: d.notes.trim() } : {}),
          links: parseLinks(d.links),
        },
      },
    ]);
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={
          detail.readOnly
            ? t('common.detail')
            : booking
              ? t('plan.booking.editTitle')
              : t('plan.booking.add')
        }
      >
        <StepForm
          readOnly={detail.readOnly}
          onEdit={detail.startEdit}
          onSubmit={submit}
          freeNavigation={!!booking}
          pending={pending}
          submitLabel={t('common.save')}
          submitDisabled={!d.title.trim() || !d.startDate}
          leading={
            booking && (
              <Button
                type="button"
                variant="ghost"
                className="text-destructive"
                aria-label={t('expense.delete')}
                disabled={pending}
                onClick={async () => {
                  if (!(await confirmDialog(t('plan.booking.confirmDelete')))) return;
                  await apply([{ type: 'deleteBooking', id: booking.id }]);
                  onClose();
                }}
              >
                <Trash2 />
                <span className="hidden sm:inline">{t('expense.delete')}</span>
              </Button>
            )
          }
        >
          <Step title={t('plan.booking.stepWhat')}>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('plan.booking.type')} htmlFor="bk-type">
                <Select
                  id="bk-type"
                  value={d.type}
                  onChange={(e) => set('type', e.target.value as Booking['type'])}
                >
                  {BOOKING_TYPES.map((x) => (
                    <option key={x} value={x}>
                      {BOOKING_EMOJI[x]} {t(`plan.bookingTypes.${x}`)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('plan.booking.status')} htmlFor="bk-status">
                <Select
                  id="bk-status"
                  value={d.status}
                  onChange={(e) => set('status', e.target.value as Booking['status'])}
                >
                  {(['booked', 'to_book', 'optional'] as const).map((x) => (
                    <option key={x} value={x}>
                      {t(`plan.bookingStatus.${x}`)}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field label={t('plan.booking.title')} htmlFor="bk-title">
              <Input
                id="bk-title"
                required
                maxLength={160}
                value={d.title}
                onChange={(e) => set('title', e.target.value)}
              />
            </Field>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label={t('plan.booking.start')} htmlFor="bk-sd">
                <div className="flex gap-2">
                  <Input
                    id="bk-sd"
                    className="min-w-0 flex-1"
                    type="date"
                    required
                    value={d.startDate}
                    onChange={(e) => set('startDate', e.target.value)}
                  />
                  <Input
                    type="time"
                    className="w-28"
                    value={d.startTime}
                    onChange={(e) => set('startTime', e.target.value)}
                    aria-label={t('plan.activity.time')}
                  />
                </div>
              </Field>
              <Field label={t('plan.booking.end')} htmlFor="bk-ed">
                <div className="flex gap-2">
                  <Input
                    id="bk-ed"
                    className="min-w-0 flex-1"
                    type="date"
                    min={d.startDate}
                    value={d.endDate}
                    onChange={(e) => set('endDate', e.target.value)}
                  />
                  <Input
                    type="time"
                    className="w-28"
                    value={d.endTime}
                    onChange={(e) => set('endTime', e.target.value)}
                    aria-label={t('plan.activity.endTime')}
                  />
                </div>
              </Field>
            </div>
            {d.type === 'flight' && (
              <div className="grid grid-cols-3 gap-3">
                <Input
                  placeholder="FR5590"
                  value={d.flightNumber}
                  onChange={(e) => set('flightNumber', e.target.value)}
                  aria-label={t('plan.booking.flightNumber')}
                />
                <Input
                  placeholder={t('plan.booking.from')}
                  value={d.flightFrom}
                  onChange={(e) => set('flightFrom', e.target.value)}
                />
                <Input
                  placeholder={t('plan.booking.to')}
                  value={d.flightTo}
                  onChange={(e) => set('flightTo', e.target.value)}
                />
              </div>
            )}
          </Step>
          <Step title={t('plan.booking.stepDetails')}>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('plan.booking.provider')} htmlFor="bk-prov">
                <Input
                  id="bk-prov"
                  maxLength={120}
                  value={d.provider}
                  onChange={(e) => set('provider', e.target.value)}
                />
              </Field>
              <Field label={t('plan.booking.code')} htmlFor="bk-code">
                <Input
                  id="bk-code"
                  maxLength={80}
                  value={d.code}
                  onChange={(e) => set('code', e.target.value)}
                />
              </Field>
            </div>
            {plan.places.length > 0 && (
              <Field label={t('plan.booking.place')} htmlFor="bk-place">
                <Select
                  id="bk-place"
                  value={d.placeId}
                  onChange={(e) => set('placeId', e.target.value)}
                >
                  <option value="">—</option>
                  {plan.places.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <MoneyFields
              idPrefix="bk"
              label={t('plan.booking.cost')}
              value={d.cost}
              onChange={(v) => set('cost', v)}
            />
            <Field label={t('plan.booking.paid')} htmlFor="bk-paid">
              <Select id="bk-paid" value={d.paid} onChange={(e) => set('paid', e.target.value)}>
                <option value="">—</option>
                <option value="yes">{t('plan.booking.paidYes')}</option>
                <option value="no">{t('plan.booking.payOnSite')}</option>
              </Select>
            </Field>
            <Field label={t('expense.notes')} htmlFor="bk-notes">
              <textarea
                id="bk-notes"
                rows={2}
                maxLength={600}
                className={textareaClass}
                value={d.notes}
                onChange={(e) => set('notes', e.target.value)}
              />
            </Field>
            <Field label={`🔗 ${t('plan.links')}`} htmlFor="bk-links" hint={t('plan.linksHint')}>
              <textarea
                id="bk-links"
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

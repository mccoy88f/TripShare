import { Loader2, Settings2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Booking } from '@tripshare/shared/trip-format';
import { UserAvatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { useOnAdd } from '@/lib/fab';
import { shortDate } from '@/lib/format';
import { BOOKING_EMOJI, usePlan } from '@/lib/plan';
import type { TripDetail } from '@/lib/types';
import {
  myTickets,
  TicketIcon,
  TicketsDialog,
  TicketViewer,
  useTickets,
  type Ticket,
} from './tickets';

/**
 * Tutti i biglietti del viaggio: in alto quelli che riguardano me (assegnati a me o a tutti),
 * poi l'elenco per prenotazione con a chi è assegnato ciascun biglietto.
 */
export function TicketsTab({ trip }: { trip: TripDetail }) {
  const { t } = useTranslation();
  const { data } = usePlan(trip.id);
  const { data: tickets } = useTickets(trip.id);
  const [viewing, setViewing] = useState<{ list: Ticket[]; index: number } | null>(null);
  const [managing, setManaging] = useState<Booking | null>(null);
  const [choosing, setChoosing] = useState(false);
  useOnAdd('tickets', () => {
    if (!data?.plan.bookings.length) toast.info(t('tickets.needBooking'));
    else setChoosing(true);
  });
  const canEdit = trip.role !== 'viewer';
  if (!data || !tickets)
    return <Loader2 className="mx-auto mt-10 animate-spin text-muted-foreground" />;

  const bookings = [...data.plan.bookings].sort((a, b) =>
    `${a.start.date}${a.start.time ?? ''}`.localeCompare(`${b.start.date}${b.start.time ?? ''}`),
  );
  const order = (tk: Ticket) => bookings.findIndex((b) => b.id === tk.bookingId);
  const sorted = [...tickets].sort((a, b) => order(a) - order(b));
  const mine = myTickets(sorted, trip.myMemberId);
  const withTickets = bookings.filter((b) => sorted.some((tk) => tk.bookingId === b.id));
  const member = (id: string | null) => trip.members.find((m) => m.id === id);

  return (
    <div className="grid grid-cols-1 gap-6 pb-8">
      {tickets.length === 0 && (
        <div className="grid place-items-center rounded-xl border border-dashed px-6 py-14 text-center">
          <span className="text-5xl">🎫</span>
          <p className="mt-4 font-semibold">{t('tickets.emptyTab')}</p>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">{t('tickets.emptyTabText')}</p>
        </div>
      )}
      {mine.length > 0 && (
        <section className="grid grid-cols-1 gap-2">
          <h3 className="px-1 text-sm font-semibold">🎫 {t('tickets.mine')}</h3>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {mine.map((tk, i) => {
              const b = bookings.find((x) => x.id === tk.bookingId);
              return (
                <button
                  key={tk.id}
                  onClick={() => setViewing({ list: mine, index: i })}
                  className="flex min-h-28 flex-col items-start rounded-xl bg-gradient-to-br from-primary to-accent p-3 text-left text-white shadow-md transition active:scale-[0.98]"
                >
                  <span className="text-xl">{b ? BOOKING_EMOJI[b.type] : '🎫'}</span>
                  <span className="mt-1 line-clamp-2 text-sm font-semibold">
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

      {withTickets.length > 0 && (
        <section className="grid grid-cols-1 gap-3">
          <h3 className="px-1 text-sm font-semibold">{t('tickets.all')}</h3>
          {withTickets.map((b) => {
            const list = sorted.filter((tk) => tk.bookingId === b.id);
            return (
              <Card key={b.id} className="divide-y">
                <div className="flex items-center gap-3 px-4 py-3">
                  <span className="text-xl">{BOOKING_EMOJI[b.type]}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{b.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {shortDate(b.start.date)}
                      {b.start.time && ` ${b.start.time}`}
                    </p>
                  </div>
                  {canEdit && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-9 text-muted-foreground"
                      aria-label={t('tickets.manage')}
                      title={t('tickets.manage')}
                      onClick={() => setManaging(b)}
                    >
                      <Settings2 />
                    </Button>
                  )}
                </div>
                {list.map((tk, i) => {
                  const m = member(tk.memberId);
                  return (
                    <button
                      key={tk.id}
                      onClick={() => setViewing({ list, index: i })}
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition hover:bg-muted/50"
                    >
                      <span className="text-muted-foreground">
                        <TicketIcon ticket={tk} />
                      </span>
                      <span className="min-w-0 flex-1 truncate">
                        {tk.label ?? tk.fileName ?? t('tickets.ticket')}
                      </span>
                      {m ? (
                        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                          <UserAvatar user={m} size="sm" className="size-6 text-[10px]" />
                          <span className="hidden sm:inline">{m.name}</span>
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {t('tickets.everyone')}
                        </span>
                      )}
                    </button>
                  );
                })}
              </Card>
            );
          })}
        </section>
      )}

      {choosing && (
        <Dialog open onOpenChange={setChoosing}>
          <DialogContent title={t('tickets.chooseBooking')}>
            <div className="grid grid-cols-1 gap-2 pt-2">
              {bookings.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => {
                    setChoosing(false);
                    setManaging(b);
                  }}
                  className="flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition hover:bg-muted"
                >
                  <span className="text-xl">{BOOKING_EMOJI[b.type]}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{b.title}</span>
                    <span className="text-xs text-muted-foreground">
                      {shortDate(b.start.date)}
                      {b.start.time && ` ${b.start.time}`}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </DialogContent>
        </Dialog>
      )}

      {managing && (
        <TicketsDialog
          trip={trip}
          booking={managing}
          onClose={() => setManaging(null)}
          onView={(list, index) => setViewing({ list, index })}
        />
      )}
      {viewing && (
        <TicketViewer
          trip={trip}
          bookings={data.plan.bookings}
          tickets={viewing.list}
          index={viewing.index}
          onClose={() => setViewing(null)}
        />
      )}
    </div>
  );
}

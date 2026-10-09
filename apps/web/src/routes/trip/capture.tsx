import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Camera, Images, Loader2, PenLine, Sparkles } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  EXPENSE_CATEGORIES,
  isCurrencyCode,
  toMinor,
  type CurrencyCode,
  type ExpenseCategory,
} from '@tripshare/shared';
import type { Booking, Place } from '@tripshare/shared/trip-format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Select } from '@/components/ui/input';
import { uploadAiFile, useAiTask } from '@/lib/ai';
import { decodeImage, type DecodedCode } from '@/lib/barcode';
import { money, shortDate, todayIso } from '@/lib/format';
import { BOOKING_EMOJI, PLACE_KIND_EMOJI, usePlan, usePlanOps } from '@/lib/plan';
import { useTRPC } from '@/lib/trpc';
import type { TripDetail } from '@/lib/types';
import { cn } from '@/lib/utils';

/** Risultato della lettura di un documento (vedi `DocumentResultSchema` nell'API). */
interface DocumentResult {
  documentType: string;
  summary: string;
  expense?: {
    title: string;
    merchant?: string;
    date?: string;
    total: number;
    currency: string;
    category: ExpenseCategory;
    emoji?: string;
    status: 'paid' | 'planned';
    bookingRef?: string;
  };
  bookings: (Booking & { existing: boolean })[];
  places: Place[];
  ticket?: { bookingRef: string; label?: string; passenger?: string };
  confidence: 'high' | 'medium' | 'low';
  notes?: string;
}

interface Scanned {
  result: DocumentResult;
  file: string;
  code: DecodedCode | null;
  preview: string | null;
}

/**
 * Il "+" nei tab di spese, prenotazioni, programma e luoghi: foglio con tre scelte.
 * Al centro la fotocamera, a destra la galleria (foto o PDF), a sinistra l'inserimento manuale.
 * La foto viene letta dall'AI, che propone tutto ciò che ne deriva (prenotazione, spesa,
 * luogo, biglietto); niente viene salvato prima della revisione.
 */
export function CaptureSheet({
  trip,
  open,
  onOpenChange,
  manualLabel,
  onManual,
}: {
  trip: TripDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  manualLabel: string;
  onManual: () => void;
}) {
  const { t } = useTranslation();
  const { run } = useAiTask();
  const camera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState<string | null>(null);
  const [scanned, setScanned] = useState<Scanned | null>(null);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    onOpenChange(false);
    const preview = file.type.startsWith('image/') ? URL.createObjectURL(file) : null;
    setReading(preview ?? '');
    try {
      // Il codice a barre o QR si legge sul dispositivo, in parallelo all'AI.
      const [uploaded, code] = await Promise.all([
        uploadAiFile(trip.id, file),
        file.type.startsWith('image/') ? decodeImage(file) : Promise.resolve(null),
      ]);
      const result = await run<DocumentResult>(trip.id, {
        kind: 'document',
        file: uploaded.file,
        mime: uploaded.mime,
        tripCurrency: trip.currency as CurrencyCode,
        year: Number((trip.startDate ?? todayIso()).slice(0, 4)),
      });
      if (result) setScanned({ result, file: uploaded.file, code, preview });
    } catch (err) {
      toast.error(
        t(`tickets.errors.${(err as Error).message}`, { defaultValue: t('common.error') }),
      );
    } finally {
      setReading(null);
    }
  };

  return (
    <>
      <input
        ref={camera}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          void onFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      <input
        ref={gallery}
        type="file"
        accept="image/*,application/pdf"
        className="hidden"
        onChange={(e) => {
          void onFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent title={t('capture.title')} description={t('capture.hint')}>
          <div className="grid grid-cols-3 items-end gap-3 pt-4 pb-2">
            <SheetButton
              icon={<PenLine />}
              label={manualLabel}
              onClick={() => {
                onOpenChange(false);
                onManual();
              }}
            />
            <div className="flex flex-col items-center gap-2">
              <button
                type="button"
                onClick={() => camera.current?.click()}
                aria-label={t('capture.camera')}
                className="flex size-20 items-center justify-center rounded-full bg-gradient-to-br from-primary to-accent text-white shadow-lg shadow-accent/30 transition active:scale-95"
              >
                <Camera className="size-8" />
              </button>
              <span className="text-center text-sm font-semibold">{t('capture.camera')}</span>
            </div>
            <SheetButton
              icon={<Images />}
              label={t('capture.gallery')}
              onClick={() => gallery.current?.click()}
            />
          </div>
        </DialogContent>
      </Dialog>

      {reading !== null && (
        <Dialog open>
          <DialogContent title={t('capture.reading')} onInteractOutside={(e) => e.preventDefault()}>
            <div className="grid place-items-center gap-4 py-6">
              {reading ? (
                <img
                  src={reading}
                  alt=""
                  className="max-h-48 rounded-xl object-contain opacity-80 shadow"
                />
              ) : null}
              <p className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                {t('capture.readingHint')}
              </p>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {scanned && <ReviewDialog trip={trip} scanned={scanned} onClose={() => setScanned(null)} />}
    </>
  );
}

function SheetButton({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-center gap-2 text-center text-sm font-medium text-muted-foreground transition hover:text-foreground"
    >
      <span className="flex size-14 items-center justify-center rounded-full bg-muted text-foreground [&_svg]:size-6">
        {icon}
      </span>
      {label}
    </button>
  );
}

/** Revisione di quanto letto: si sceglie cosa salvare, poi si crea tutto insieme. */
function ReviewDialog({
  trip,
  scanned,
  onClose,
}: {
  trip: TripDetail;
  scanned: Scanned;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { data } = usePlan(trip.id);
  const { apply } = usePlanOps(trip.id);
  const createExpense = useMutation(trpc.expenses.create.mutationOptions());
  const createTicket = useMutation(trpc.tickets.fromAiFile.mutationOptions());
  const { result, file, code } = scanned;
  const active = trip.members.filter((m) => !m.removed);

  const newBookings = result.bookings.filter((b) => !b.existing);
  const [bookingOn, setBookingOn] = useState(newBookings.map(() => true));
  const [placeOn, setPlaceOn] = useState(result.places.map(() => true));
  const [expenseOn, setExpenseOn] = useState(!!result.expense);
  const [status, setStatus] = useState<'paid' | 'planned'>(result.expense?.status ?? 'paid');
  const [payer, setPayer] = useState(trip.myMemberId);
  const [ticketOn, setTicketOn] = useState(!!result.ticket);
  const [ticketMember, setTicketMember] = useState<string>(
    // Il biglietto va a chi corrisponde il nome del passeggero, altrimenti a me.
    active.find(
      (m) =>
        result.ticket?.passenger &&
        result.ticket.passenger.toLowerCase().includes(m.name.split(' ')[0]!.toLowerCase()),
    )?.id ?? trip.myMemberId,
  );
  const [saving, setSaving] = useState(false);

  const existingBookings = new Set((data?.plan.bookings ?? []).map((b) => b.id));
  const existingPlaces = new Set((data?.plan.places ?? []).map((p) => p.id));
  const createdBookings = new Set(newBookings.filter((_, i) => bookingOn[i]).map((b) => b.id));
  const createdPlaces = new Set(result.places.filter((_, i) => placeOn[i]).map((p) => p.id));
  const bookingAvailable = (id?: string) =>
    !!id && (createdBookings.has(id) || existingBookings.has(id));
  const bookingTitle = (id?: string) =>
    result.bookings.find((b) => b.id === id)?.title ??
    data?.plan.bookings.find((b) => b.id === id)?.title;

  const expense = result.expense;
  const currency: CurrencyCode =
    expense && isCurrencyCode(expense.currency)
      ? expense.currency
      : (trip.currency as CurrencyCode);
  const amount = expense ? toMinor(expense.total, currency) : 0;
  const nothing = !bookingOn.some(Boolean) && !placeOn.some(Boolean) && !expenseOn && !ticketOn;

  const save = async () => {
    setSaving(true);
    try {
      const ops = [
        ...result.places
          .filter((_, i) => placeOn[i])
          .map((place) => ({ type: 'upsertPlace' as const, place })),
        ...newBookings
          .filter((_, i) => bookingOn[i])
          .map(({ existing: _existing, placeId, ...booking }) => {
            void _existing;
            const linked = placeId && (createdPlaces.has(placeId) || existingPlaces.has(placeId));
            return {
              type: 'upsertBooking' as const,
              booking: { ...booking, ...(linked ? { placeId } : {}) },
            };
          }),
      ];
      if (ops.length) await apply(ops);
      if (expense && expenseOn) {
        const date =
          expense.date &&
          (!trip.startDate || expense.date >= trip.startDate) &&
          (!trip.endDate || expense.date <= trip.endDate)
            ? expense.date
            : (expense.date ?? todayIso());
        await createExpense.mutateAsync({
          tripId: trip.id,
          title: expense.title,
          emoji: expense.emoji ?? EXPENSE_CATEGORIES[expense.category]?.emoji ?? null,
          category: expense.category in EXPENSE_CATEGORIES ? expense.category : 'other',
          amount,
          currency,
          date,
          payers: [{ memberId: payer, amount }],
          split: { method: 'equal', members: active.map((m) => m.id) },
          status,
          bookingId: bookingAvailable(expense.bookingRef) ? expense.bookingRef : null,
          receipt: file,
        });
      }
      if (result.ticket && ticketOn && bookingAvailable(result.ticket.bookingRef)) {
        await createTicket.mutateAsync({
          tripId: trip.id,
          bookingId: result.ticket.bookingRef,
          file,
          memberId: ticketMember || null,
          label: result.ticket.label,
          ...(code ? { codeFormat: code.format, codeValue: code.text } : {}),
        });
      }
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: trpc.expenses.list.queryKey({ tripId: trip.id }),
        }),
        queryClient.invalidateQueries({
          queryKey: trpc.tickets.list.queryKey({ tripId: trip.id }),
        }),
        queryClient.invalidateQueries({ queryKey: trpc.trips.get.queryKey({ id: trip.id }) }),
        queryClient.invalidateQueries({ queryKey: trpc.trips.list.queryKey() }),
      ]);
      toast.success(t('capture.saved'));
      onClose();
    } catch (err) {
      const message = (err as Error).message;
      toast.error(t(`expense.errors.${message}`, { defaultValue: t('common.error') }));
    } finally {
      setSaving(false);
    }
  };

  const row = 'flex cursor-pointer items-start gap-3 rounded-xl border p-3';
  const check = 'mt-1 size-5 shrink-0 accent-[var(--primary)]';

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={t('capture.reviewTitle')} description={result.summary}>
        <div className="grid grid-cols-1 gap-3 pt-2">
          {result.confidence === 'low' && (
            <p className="rounded-xl bg-warning/15 px-3 py-2 text-sm">
              {t('capture.lowConfidence')}
            </p>
          )}

          {expense && (
            <div className={cn(row, 'flex-col')}>
              <label className="flex w-full cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  className={check}
                  checked={expenseOn}
                  onChange={(e) => setExpenseOn(e.target.checked)}
                />
                <span className="text-xl">
                  {expense.emoji ?? EXPENSE_CATEGORIES[expense.category]?.emoji ?? '🧾'}
                </span>
                <span className="min-w-0 flex-1 text-sm">
                  <span className="block font-semibold">
                    {t('capture.expense')}: {expense.title}
                  </span>
                  <span className="block text-muted-foreground">
                    {money(amount, currency)}
                    {expense.date && ` · ${shortDate(expense.date)}`}
                    {bookingAvailable(expense.bookingRef) &&
                      ` · 🔗 ${bookingTitle(expense.bookingRef)}`}
                  </span>
                </span>
              </label>
              {expenseOn && (
                <div className="grid w-full grid-cols-2 gap-2 pl-8">
                  <Select
                    className="h-9 text-sm"
                    value={status}
                    onChange={(e) => setStatus(e.target.value as 'paid' | 'planned')}
                    aria-label={t('expense.paidStatus')}
                  >
                    <option value="paid">✅ {t('expense.paidStatus')}</option>
                    <option value="planned">⏳ {t('expense.planned')}</option>
                  </Select>
                  <Select
                    className="h-9 text-sm"
                    value={payer}
                    onChange={(e) => setPayer(e.target.value)}
                    aria-label={t('expense.paidBy')}
                  >
                    {active.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.id === trip.myMemberId ? t('expense.me', { name: m.name }) : m.name}
                      </option>
                    ))}
                  </Select>
                  <p className="col-span-2 text-xs text-muted-foreground">
                    {t('capture.splitAll', { count: active.length })}
                  </p>
                </div>
              )}
            </div>
          )}

          {newBookings.map((b, i) => (
            <label key={b.id} className={row}>
              <input
                type="checkbox"
                className={check}
                checked={bookingOn[i] ?? false}
                onChange={(e) =>
                  setBookingOn(bookingOn.map((v, j) => (j === i ? e.target.checked : v)))
                }
              />
              <span className="text-xl">{BOOKING_EMOJI[b.type]}</span>
              <span className="min-w-0 flex-1 text-sm">
                <span className="block font-semibold">
                  {t('capture.booking')}: {b.title}
                </span>
                <span className="block text-muted-foreground">
                  {shortDate(b.start.date)}
                  {b.start.time && ` ${b.start.time}`}
                  {b.end && ` → ${shortDate(b.end.date)}${b.end.time ? ` ${b.end.time}` : ''}`}
                  {b.confirmationCode && ` · #${b.confirmationCode}`}
                </span>
              </span>
            </label>
          ))}
          {result.bookings
            .filter((b) => b.existing)
            .map((b) => (
              <p key={b.id} className="px-1 text-sm text-muted-foreground">
                🔗 {t('capture.existingBooking', { title: bookingTitle(b.id) ?? b.title })}
              </p>
            ))}

          {result.places.map((p, i) => (
            <label key={p.id} className={row}>
              <input
                type="checkbox"
                className={check}
                checked={placeOn[i] ?? false}
                onChange={(e) =>
                  setPlaceOn(placeOn.map((v, j) => (j === i ? e.target.checked : v)))
                }
              />
              <span className="text-xl">{PLACE_KIND_EMOJI[p.kind]}</span>
              <span className="min-w-0 flex-1 text-sm">
                <span className="block font-semibold">
                  {t('capture.place')}: {p.name}
                </span>
                {p.address && <span className="block text-muted-foreground">{p.address}</span>}
              </span>
            </label>
          ))}

          {result.ticket && (
            <div className={cn(row, 'flex-col')}>
              <label className="flex w-full cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  className={check}
                  checked={ticketOn}
                  disabled={!bookingAvailable(result.ticket.bookingRef)}
                  onChange={(e) => setTicketOn(e.target.checked)}
                />
                <span className="text-xl">🎫</span>
                <span className="min-w-0 flex-1 text-sm">
                  <span className="block font-semibold">
                    {t('capture.ticket')}:{' '}
                    {result.ticket.label ?? bookingTitle(result.ticket.bookingRef)}
                  </span>
                  <span className="block text-muted-foreground">
                    {code ? `✅ ${t('capture.codeFound')}` : t('capture.noCode')}
                    {result.ticket.passenger && ` · ${result.ticket.passenger}`}
                  </span>
                </span>
              </label>
              {ticketOn && (
                <Select
                  className="ml-8 h-9 w-[calc(100%-2rem)] text-sm"
                  value={ticketMember}
                  onChange={(e) => setTicketMember(e.target.value)}
                  aria-label={t('tickets.assignee')}
                >
                  <option value="">{t('tickets.everyone')}</option>
                  {active.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </Select>
              )}
            </div>
          )}

          {!expense && newBookings.length === 0 && result.places.length === 0 && !result.ticket && (
            <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
              {t('capture.nothing')}
            </p>
          )}
          {result.notes && <p className="px-1 text-sm text-muted-foreground">{result.notes}</p>}

          <div className="mt-1 flex items-center gap-2">
            <Badge variant="outline">
              <Sparkles className="size-3.5" />
              {t(`capture.types.${result.documentType}`, { defaultValue: result.documentType })}
            </Badge>
            <div className="flex-1" />
            <Button size="lg" disabled={saving || nothing} onClick={save}>
              {saving && <Loader2 className="animate-spin" />}
              {t('capture.save')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

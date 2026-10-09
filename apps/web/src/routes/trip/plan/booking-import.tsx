import { Loader2, Sparkles } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { CurrencyCode } from '@tripshare/shared';
import type { Booking, TripDocument } from '@tripshare/shared/trip-format';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { uploadAiFile, useAiStatus, useAiTask } from '@/lib/ai';
import { money, shortDate } from '@/lib/format';
import { BOOKING_EMOJI, usePlanOps } from '@/lib/plan';
import type { TripDetail } from '@/lib/types';
import { moneyLabel } from './fields';

interface BookingResult {
  bookings: (Omit<Booking, 'id'> & { id?: string })[];
  travelers: string[];
  notes?: string;
}

/** Legge con l'AI una conferma di prenotazione (screenshot o PDF) e aggiunge le prenotazioni. */
export function BookingImportButton({ trip, plan }: { trip: TripDetail; plan: TripDocument }) {
  const { t } = useTranslation();
  const status = useAiStatus();
  const { run, running } = useAiTask();
  const { apply, pending } = usePlanOps(trip.id);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<BookingResult | null>(null);
  const [selected, setSelected] = useState<boolean[]>([]);
  const input = useRef<HTMLInputElement>(null);
  if (!status.data?.available) return null;
  const busy = uploading || running;

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    let uploaded: { file: string; mime: string };
    try {
      uploaded = await uploadAiFile(trip.id, file);
    } catch (err) {
      toast.error(
        t(`tickets.errors.${(err as Error).message}`, { defaultValue: t('common.error') }),
      );
      return;
    } finally {
      setUploading(false);
    }
    const res = await run<BookingResult>(trip.id, {
      kind: 'booking',
      file: uploaded.file,
      mime: uploaded.mime,
      tripCurrency: trip.currency as CurrencyCode,
      year: Number((trip.startDate ?? new Date().toISOString()).slice(0, 4)),
    });
    if (!res) return;
    if (res.bookings.length === 0) {
      toast.info(t('ai.booking.none'));
      return;
    }
    setResult(res);
    setSelected(res.bookings.map(() => true));
  };

  const add = async () => {
    if (!result) return;
    const placeIds = new Set(plan.places.map((p) => p.id));
    const ops = result.bookings
      .filter((_, i) => selected[i])
      .map((b) => {
        // Si aggiungono sempre come nuove prenotazioni; i luoghi sconosciuti si tolgono.
        const { id: _id, placeId, ...rest } = b;
        void _id;
        return {
          type: 'upsertBooking' as const,
          booking: { ...rest, ...(placeId && placeIds.has(placeId) ? { placeId } : {}) },
        };
      });
    if (ops.length === 0) return;
    await apply(ops);
    toast.success(t('ai.booking.added', { count: ops.length }));
    setResult(null);
  };

  return (
    <>
      <input
        ref={input}
        type="file"
        accept="image/*,application/pdf"
        className="hidden"
        onChange={(e) => {
          void onFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      <Button variant="outline" disabled={busy} onClick={() => input.current?.click()}>
        {busy ? <Loader2 className="animate-spin" /> : <Sparkles />}
        {busy ? t('ai.booking.reading') : t('ai.booking.fromScreenshot')}
      </Button>
      {result && (
        <Dialog open onOpenChange={(o) => !o && setResult(null)}>
          <DialogContent title={t('ai.booking.found')} description={t('ai.booking.foundHint')}>
            <div className="grid grid-cols-1 gap-3 pt-2">
              {result.bookings.map((b, i) => (
                <label
                  key={i}
                  className="flex cursor-pointer items-start gap-3 rounded-xl border p-3"
                >
                  <input
                    type="checkbox"
                    className="mt-1 size-5 accent-[var(--primary)]"
                    checked={selected[i] ?? false}
                    onChange={(e) =>
                      setSelected(selected.map((v, j) => (j === i ? e.target.checked : v)))
                    }
                  />
                  <span className="text-xl">{BOOKING_EMOJI[b.type]}</span>
                  <span className="min-w-0 flex-1 text-sm">
                    <span className="block font-semibold">{b.title}</span>
                    <span className="block text-muted-foreground">
                      {shortDate(b.start.date)}
                      {b.start.time && ` ${b.start.time}`}
                      {b.end && ` → ${shortDate(b.end.date)}${b.end.time ? ` ${b.end.time}` : ''}`}
                      {b.provider && ` · ${b.provider}`}
                      {b.confirmationCode && ` · #${b.confirmationCode}`}
                    </span>
                    {b.flight && (
                      <span className="block">
                        ✈️ {b.flight.number} · {b.flight.from} → {b.flight.to}
                      </span>
                    )}
                  </span>
                  {b.cost && (
                    <span className="tabular text-sm font-semibold">
                      {moneyLabel(b.cost, t, money)}
                    </span>
                  )}
                </label>
              ))}
              {result.travelers.length > 0 && (
                <p className="text-sm text-muted-foreground">
                  👥 {t('ai.booking.travelers', { names: result.travelers.join(', ') })}
                </p>
              )}
              {result.notes && <p className="text-sm text-muted-foreground">{result.notes}</p>}
              <Button
                className="justify-self-end"
                disabled={pending || !selected.some(Boolean)}
                onClick={add}
              >
                {pending && <Loader2 className="animate-spin" />}
                {t('ai.booking.add', { count: selected.filter(Boolean).length })}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

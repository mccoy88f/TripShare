import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  FileText,
  Loader2,
  Plus,
  QrCode,
  Trash2,
  Upload,
  Wallet,
} from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { Locale } from '@tripshare/shared';
import type { Booking } from '@tripshare/shared/trip-format';
import { UserAvatar } from '@/components/ui/avatar';
import { ZoomImage } from '@/components/zoom-image';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Input, Select } from '@/components/ui/input';
import {
  CODE_FORMAT_LABELS,
  CODE_FORMATS,
  decodeImage,
  renderCodeSvg,
  type CodeFormat,
} from '@/lib/barcode';
import { dateRange } from '@/lib/format';
import { BOOKING_EMOJI } from '@/lib/plan';
import { renderTicketImage, saveTicketImage } from '@/lib/ticket-image';
import { useTRPC } from '@/lib/trpc';
import type { TripDetail } from '@/lib/types';
import { cn } from '@/lib/utils';
import { confirmDialog } from '@/components/confirm';

type Ticket = {
  id: string;
  bookingId: string;
  memberId: string | null;
  label: string | null;
  fileName: string | null;
  mimeType: string | null;
  codeFormat: string | null;
  codeValue: string | null;
  /** Numero di prenotazione o di biglietto (letto dal pass o dal link Wallet). */
  reference: string | null;
  walletUrl: string | null;
  fileUrl: string | null;
};

export function useTickets(tripId: string) {
  const trpc = useTRPC();
  return useQuery(trpc.tickets.list.queryOptions({ tripId }));
}

/** Biglietti che riguardano me: assegnati a me oppure a tutti. */
export function myTickets(tickets: Ticket[] | undefined, myMemberId: string, bookingId?: string) {
  return (tickets ?? []).filter(
    (t) =>
      (t.memberId === null || t.memberId === myMemberId) &&
      (!bookingId || t.bookingId === bookingId),
  );
}

const isPkpass = (t: Ticket) => t.mimeType === 'application/vnd.apple.pkpass';
const isImage = (t: Ticket) => !!t.mimeType?.startsWith('image/');

export function TicketIcon({ ticket }: { ticket: Ticket }) {
  if (ticket.codeValue) return <QrCode className="size-5" />;
  if (isPkpass(ticket) || ticket.walletUrl) return <Wallet className="size-5" />;
  return <FileText className="size-5" />;
}

/** Gestione dei biglietti di una prenotazione: caricamento, codici e assegnazione. */
export function TicketsDialog({
  trip,
  booking,
  onClose,
  onView,
}: {
  trip: TripDetail;
  booking: Booking;
  onClose: () => void;
  onView: (list: Ticket[], index: number) => void;
}) {
  const { t } = useTranslation();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { data: all } = useTickets(trip.id);
  const tickets = (all ?? []).filter((x) => x.bookingId === booking.id);
  const members = trip.members.filter((m) => !m.removed);
  const canEdit = trip.role !== 'viewer';
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const [assignInOrder, setAssignInOrder] = useState(true);
  const [manual, setManual] = useState({
    open: false,
    format: 'QRCode' as CodeFormat,
    value: '',
    wallet: '',
    memberId: '',
    label: '',
  });

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: trpc.tickets.list.queryKey({ tripId: trip.id }) });
  const update = useMutation(
    trpc.tickets.update.mutationOptions({
      onSuccess: refresh,
      onError: () => toast.error(t('common.error')),
    }),
  );
  const remove = useMutation(trpc.tickets.delete.mutationOptions({ onSuccess: refresh }));
  const createCode = useMutation(
    trpc.tickets.createCode.mutationOptions({
      onSuccess: refresh,
      onError: () => toast.error(t('common.error')),
    }),
  );

  const uploadFiles = async (files: File[]) => {
    // Assegnazione in ordine: il primo file al primo partecipante senza biglietto, e così via.
    const taken = new Set(tickets.map((x) => x.memberId).filter(Boolean));
    const queue = members.filter((m) => !taken.has(m.id));
    let found = 0;
    for (const [i, file] of files.entries()) {
      setUploading(t('tickets.uploading', { n: i + 1, total: files.length }));
      const code = file.type.startsWith('image/') ? await decodeImage(file) : null;
      if (code) found++;
      const body = new FormData();
      body.append('bookingId', booking.id);
      const member = assignInOrder ? queue[i] : undefined;
      if (member) body.append('memberId', member.id);
      if (code) {
        body.append('codeFormat', code.format);
        body.append('codeValue', code.text);
      }
      body.append('file', file);
      const res = await fetch(`/api/trips/${trip.id}/tickets`, {
        method: 'POST',
        body,
        credentials: 'include',
      });
      if (!res.ok) {
        const err = ((await res.json().catch(() => ({}))) as { error?: string }).error;
        toast.error(
          `${file.name}: ${t(`tickets.errors.${err}`, { defaultValue: t('common.error') })}`,
        );
      }
    }
    setUploading(null);
    await refresh();
    if (found) toast.success(t('tickets.codesFound', { count: found }));
  };

  const addManual = async (e: FormEvent) => {
    e.preventDefault();
    await createCode.mutateAsync({
      tripId: trip.id,
      bookingId: booking.id,
      memberId: manual.memberId || null,
      ...(manual.label.trim() ? { label: manual.label.trim() } : {}),
      ...(manual.value.trim() ? { codeFormat: manual.format, codeValue: manual.value.trim() } : {}),
      ...(manual.wallet.trim() ? { walletUrl: manual.wallet.trim() } : {}),
    });
    setManual({ ...manual, open: false, value: '', wallet: '', label: '' });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={`${BOOKING_EMOJI[booking.type]} ${t('tickets.title')}`}
        description={booking.title}
      >
        <div className="grid grid-cols-1 gap-5 pt-2">
          {tickets.length === 0 && (
            <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
              {t('tickets.empty')}
            </p>
          )}
          {tickets.length > 0 && (
            <div className="divide-y rounded-xl border">
              {tickets.map((tk, i) => {
                const member = members.find((m) => m.id === tk.memberId);
                return (
                  <div key={tk.id} className="grid grid-cols-1 gap-2 p-3">
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => onView(tickets, i)}
                        className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-secondary text-secondary-foreground"
                        aria-label={t('tickets.open')}
                      >
                        <TicketIcon ticket={tk} />
                      </button>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">
                          {tk.label ||
                            tk.fileName ||
                            (tk.codeFormat
                              ? CODE_FORMAT_LABELS[tk.codeFormat as CodeFormat]
                              : t('tickets.ticket'))}
                        </p>
                        <p className="flex flex-wrap gap-1.5 text-xs text-muted-foreground">
                          {tk.codeFormat && (
                            <Badge variant="outline">
                              {CODE_FORMAT_LABELS[tk.codeFormat as CodeFormat] ?? tk.codeFormat}
                            </Badge>
                          )}
                          {isPkpass(tk) && <Badge variant="outline">Apple Wallet</Badge>}
                          {tk.walletUrl && <Badge variant="outline">Google Wallet</Badge>}
                          {tk.mimeType === 'application/pdf' && (
                            <Badge variant="outline">PDF</Badge>
                          )}
                        </p>
                      </div>
                      {canEdit ? (
                        <Select
                          className="h-9 w-40 text-sm"
                          value={tk.memberId ?? ''}
                          onChange={(e) =>
                            update.mutate({
                              tripId: trip.id,
                              id: tk.id,
                              memberId: e.target.value || null,
                            })
                          }
                          aria-label={t('tickets.assignee')}
                        >
                          <option value="">{t('tickets.everyone')}</option>
                          {members.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name}
                            </option>
                          ))}
                        </Select>
                      ) : member ? (
                        <UserAvatar user={member} size="sm" />
                      ) : (
                        <Badge>{t('tickets.everyone')}</Badge>
                      )}
                      {canEdit && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-8 text-muted-foreground"
                          aria-label={t('expense.delete')}
                          onClick={async () =>
                            (await confirmDialog(t('tickets.confirmDelete'))) &&
                            remove.mutate({ tripId: trip.id, id: tk.id })
                          }
                        >
                          <Trash2 />
                        </Button>
                      )}
                    </div>
                    {canEdit && (
                      <Input
                        className="h-9 text-sm"
                        placeholder={t('tickets.labelPlaceholder')}
                        defaultValue={tk.label ?? ''}
                        onBlur={(e) =>
                          e.target.value !== (tk.label ?? '') &&
                          update.mutate({
                            tripId: trip.id,
                            id: tk.id,
                            label: e.target.value || null,
                          })
                        }
                      />
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {canEdit && (
            <div className="grid grid-cols-1 gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  disabled={!!uploading}
                  onClick={() => fileInput.current?.click()}
                >
                  {uploading ? <Loader2 className="animate-spin" /> : <Upload />}
                  {uploading ?? t('tickets.upload')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setManual({ ...manual, open: !manual.open })}
                >
                  <Plus />
                  {t('tickets.addCode')}
                </Button>
              </div>
              <label className="inline-flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="accent-[var(--primary)]"
                  checked={assignInOrder}
                  onChange={(e) => setAssignInOrder(e.target.checked)}
                />
                {t('tickets.assignInOrder')}
              </label>
              <p className="text-xs text-muted-foreground">{t('tickets.uploadHint')}</p>
              <input
                ref={fileInput}
                type="file"
                multiple
                accept="image/*,application/pdf,.pkpass,application/vnd.apple.pkpass"
                className="hidden"
                onChange={(e) => {
                  const files = [...(e.target.files ?? [])];
                  e.target.value = '';
                  if (files.length) void uploadFiles(files);
                }}
              />
              {manual.open && (
                <form onSubmit={addManual} className="grid grid-cols-1 gap-3 rounded-xl border p-3">
                  <div className="grid grid-cols-[auto_1fr] gap-2">
                    <Select
                      className="w-36"
                      value={manual.format}
                      onChange={(e) =>
                        setManual({ ...manual, format: e.target.value as CodeFormat })
                      }
                      aria-label={t('tickets.format')}
                    >
                      {CODE_FORMATS.map((f) => (
                        <option key={f} value={f}>
                          {CODE_FORMAT_LABELS[f]}
                        </option>
                      ))}
                    </Select>
                    <Input
                      placeholder={t('tickets.codeValue')}
                      value={manual.value}
                      onChange={(e) => setManual({ ...manual, value: e.target.value })}
                    />
                  </div>
                  <Input
                    type="url"
                    placeholder={t('tickets.walletPlaceholder')}
                    value={manual.wallet}
                    onChange={(e) => setManual({ ...manual, wallet: e.target.value })}
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      placeholder={t('tickets.labelPlaceholder')}
                      value={manual.label}
                      onChange={(e) => setManual({ ...manual, label: e.target.value })}
                    />
                    <Select
                      value={manual.memberId}
                      onChange={(e) => setManual({ ...manual, memberId: e.target.value })}
                      aria-label={t('tickets.assignee')}
                    >
                      <option value="">{t('tickets.everyone')}</option>
                      {members.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <Button
                    type="submit"
                    disabled={
                      createCode.isPending || (!manual.value.trim() && !manual.wallet.trim())
                    }
                    className="justify-self-end"
                  >
                    {t('common.save')}
                  </Button>
                </form>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Biglietto a schermo intero: codice grande e nitido, file originale e Wallet. */
export function TicketViewer({
  trip,
  bookings,
  tickets,
  index,
  onClose,
}: {
  trip: TripDetail;
  bookings: Booking[];
  tickets: Ticket[];
  index: number;
  onClose: () => void;
}) {
  // I biglietti eliminati da qui spariscono subito; senza altri biglietti la finestra si chiude.
  const [gone, setGone] = useState<string[]>([]);
  const list = tickets.filter((x) => !gone.includes(x.id));
  useEffect(() => {
    if (list.length === 0) onClose();
  }, [list.length]); // eslint-disable-line react-hooks/exhaustive-deps
  if (list.length === 0) return null;
  return (
    <TicketViewerBody
      trip={trip}
      bookings={bookings}
      tickets={list}
      index={Math.min(index, list.length - 1)}
      onClose={onClose}
      onDeleted={(id) => setGone((g) => [...g, id])}
    />
  );
}

function TicketViewerBody({
  trip,
  bookings,
  tickets,
  index,
  onClose,
  onDeleted,
}: {
  trip: TripDetail;
  bookings: Booking[];
  tickets: Ticket[];
  index: number;
  onClose: () => void;
  onDeleted: (id: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [i, setI] = useState(index);
  const [svg, setSvg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const canEdit = trip.role !== 'viewer';
  const remove = useMutation(
    trpc.tickets.delete.mutationOptions({
      onSuccess: (_res, vars) => {
        onDeleted(vars.id);
        void queryClient.invalidateQueries({
          queryKey: trpc.tickets.list.queryKey({ tripId: trip.id }),
        });
      },
      onError: () => toast.error(t('common.error')),
    }),
  );
  const ticket = tickets[Math.min(i, tickets.length - 1)]!;
  // Il numero di prenotazione del biglietto, o quello della prenotazione nel programma.
  const reference =
    ticket.reference ?? bookings.find((b) => b.id === ticket.bookingId)?.confirmationCode;
  const booking = bookings.find((b) => b.id === ticket.bookingId);
  const member = trip.members.find((m) => m.id === ticket.memberId);

  useEffect(() => {
    let cancelled = false;
    setSvg(null);
    if (ticket.codeValue && ticket.codeFormat) {
      void renderCodeSvg(ticket.codeValue, ticket.codeFormat as CodeFormat).then(
        (s) => !cancelled && setSvg(s),
      );
    }
    return () => {
      cancelled = true;
    };
  }, [ticket.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Lo schermo resta acceso mentre si mostra il biglietto al controllo.
  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    navigator.wakeLock
      ?.request('screen')
      .then((l) => (lock = l))
      .catch(() => {});
    return () => void lock?.release();
  }, []);

  /** Salva un'immagine del biglietto con il codice e le informazioni. */
  const download = async () => {
    setSaving(true);
    try {
      const locale = (i18n.resolvedLanguage ?? 'it') as Locale;
      const long = (iso: string) =>
        new Intl.DateTimeFormat(locale, {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        }).format(new Date(`${iso}T12:00:00`));
      const start = booking?.start;
      const end = booking?.end?.date && booking.end.date !== start?.date ? booking.end.date : null;
      const subtitle = start
        ? end
          ? `${dateRange(start.date, end, locale)} ${end.slice(0, 4)}`
          : `${long(start.date)}${start.time ? ` · ${start.time}` : ''}`
        : undefined;
      const title = booking?.title ?? ticket.label ?? t('tickets.ticket');
      const photo =
        !ticket.codeValue && ticket.fileUrl && isImage(ticket)
          ? await fetch(ticket.fileUrl, { credentials: 'include' })
              .then((r) => (r.ok ? r.blob() : undefined))
              .catch(() => undefined)
          : undefined;
      const blob = await renderTicketImage({
        emoji: booking ? (BOOKING_EMOJI[booking.type] ?? '🎫') : '🎫',
        title,
        subtitle,
        rows: [
          [t('tickets.holder'), member?.name ?? ''],
          [t('tickets.detail'), booking ? (ticket.label ?? '') : ''],
          [t('tickets.trip'), `${trip.emoji ? `${trip.emoji} ` : ''}${trip.title}`],
          [t('tickets.provider'), booking?.provider ?? ''],
        ],
        code:
          ticket.codeValue && ticket.codeFormat && svg
            ? {
                svg,
                text: ticket.codeValue,
                wide: !['QRCode', 'AztecCode', 'DataMatrix'].includes(ticket.codeFormat),
              }
            : undefined,
        photo,
        reference,
        referenceLabel: t('tickets.reference'),
        footerLeft: 'TripShare',
        footerRight: t('tickets.imageFooter'),
      });
      const slug = title
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 40);
      const result = await saveTicketImage(blob, `biglietto-${slug || 'tripshare'}.png`);
      if (result === 'downloaded') toast.success(t('tickets.imageSaved'));
    } catch {
      toast.error(t('tickets.imageFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={`${booking ? `${BOOKING_EMOJI[booking.type]} ${booking.title}` : t('tickets.ticket')}`}
        description={
          booking
            ? (ticket.label ?? undefined)
            : [t('tickets.orphan'), ticket.label].filter(Boolean).join(' · ')
        }
      >
        <div className="grid grid-cols-1 gap-4 pt-1">
          <div className="flex items-center justify-between gap-2">
            {member ? (
              <span className="inline-flex items-center gap-2 text-sm font-medium">
                <UserAvatar user={member} size="sm" />
                {member.name}
              </span>
            ) : (
              <Badge>{t('tickets.everyone')}</Badge>
            )}
            {tickets.length > 1 && (
              <div className="flex items-center gap-1 text-sm text-muted-foreground">
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-8"
                  disabled={i === 0}
                  onClick={() => setI(Math.max(0, i - 1))}
                  aria-label={t('common.back')}
                >
                  <ChevronLeft />
                </Button>
                {i + 1}/{tickets.length}
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-8"
                  disabled={i === tickets.length - 1}
                  onClick={() => setI(i + 1)}
                  aria-label="›"
                >
                  <ChevronRight />
                </Button>
              </div>
            )}
          </div>

          {ticket.codeValue && (
            <div className="grid place-items-center rounded-2xl bg-white p-5">
              {svg ? (
                <div
                  className={cn(
                    'mx-auto w-full [&_svg]:h-auto [&_svg]:w-full',
                    ticket.codeFormat === 'QRCode' ||
                      ticket.codeFormat === 'AztecCode' ||
                      ticket.codeFormat === 'DataMatrix'
                      ? 'max-w-72'
                      : 'max-w-md',
                  )}
                  dangerouslySetInnerHTML={{ __html: svg }}
                />
              ) : (
                <Loader2 className="my-16 animate-spin text-slate-400" />
              )}
              <p className="mt-3 max-w-full truncate font-mono text-xs text-slate-500">
                {ticket.codeValue}
              </p>
            </div>
          )}
          {reference && (
            <div
              className={cn(
                'grid place-items-center gap-1 rounded-2xl border bg-muted/40 text-center',
                ticket.codeValue ? 'px-4 py-2' : 'px-4 py-6',
              )}
            >
              <span className="text-xs font-medium text-muted-foreground">
                {t('tickets.reference')}
              </span>
              <button
                type="button"
                className={cn(
                  'font-mono font-semibold tracking-wider break-all',
                  ticket.codeValue ? 'text-lg' : 'text-3xl',
                )}
                title={t('tickets.copyReference')}
                onClick={() => {
                  void navigator.clipboard
                    ?.writeText(reference)
                    .then(() => toast.success(t('tickets.referenceCopied')))
                    .catch(() => undefined);
                }}
              >
                {reference}
              </button>
            </div>
          )}
          {!ticket.codeValue && ticket.fileUrl && isImage(ticket) && (
            <ZoomImage
              src={ticket.fileUrl}
              alt={ticket.label ?? ''}
              wrapperClassName="rounded-xl bg-white"
              className="max-h-[60vh] w-full object-contain"
            />
          )}

          <div className="flex flex-wrap items-center gap-2">
            {canEdit && (
              <Button
                variant="ghost"
                className="text-destructive hover:text-destructive"
                disabled={remove.isPending}
                onClick={async () =>
                  (await confirmDialog(t('tickets.confirmDelete'))) &&
                  remove.mutate({ tripId: trip.id, id: ticket.id })
                }
              >
                {remove.isPending ? <Loader2 className="animate-spin" /> : <Trash2 />}
                {t('expense.delete')}
              </Button>
            )}
            <div className="flex-1" />
            <Button disabled={saving} onClick={() => void download()}>
              {saving ? <Loader2 className="animate-spin" /> : <Download />}
              {t('tickets.download')}
            </Button>
            {ticket.fileUrl && !isPkpass(ticket) && (
              <Button asChild variant="outline">
                <a href={ticket.fileUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink />
                  {t('tickets.openFile')}
                </a>
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export type { Ticket };

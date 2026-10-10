import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Camera,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  GalleryVerticalEnd,
  Loader2,
  LocateFixed,
  Lock,
  Map as MapIcon,
  MapPinOff,
  Pencil,
  Play,
  Trash2,
  Upload,
} from 'lucide-react';
import { lazy, Suspense, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { confirmDialog } from '@/components/confirm';
import { DIALOG_FOOTER } from '@/components/dialog-footer';
import { UserAvatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field, Select } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useFabAction, useOnAdd } from '@/lib/fab';
import {
  formatDuration,
  hasPoint,
  memoryDate,
  memoryUrl,
  uploadMemory,
  type Memory,
} from '@/lib/memories';
import { useTRPC } from '@/lib/trpc';
import { cn } from '@/lib/utils';
import { textareaClass } from '../trip/plan/fields';

const MemoryMap = lazy(() => import('./memory-map'));
const PlacePicker = lazy(() => import('./memory-map').then((m) => ({ default: m.PlacePicker })));

type ViewMode = 'timeline' | 'map';
const VIEW_KEY = 'tripshare.memoriesView';
const SHARE_KEY = 'tripshare.memoriesShare';

const readPref = (key: string, fallback: string) => {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
};
const writePref = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // preferenza non salvata: pazienza
  }
};

/** Il "+" in basso della pagina Ricordi apre la scelta dei file. */
function GlobalFab({ onAdd }: { onAdd: () => void }) {
  const { t } = useTranslation();
  useFabAction({ label: t('memories.add'), run: onAdd });
  return null;
}

const localDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * Foto e video con data e posizione. Nella pagina Ricordi sono i propri; nella scheda di un
 * viaggio (`tripId`) quelli del viaggio, compresi i condivisi dagli altri partecipanti.
 */
export function MemoriesView({ tripId }: { tripId?: string }) {
  const { t, i18n } = useTranslation();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { data: memories } = useQuery(trpc.memories.list.queryOptions({ tripId }));
  const [mode, setMode] = useState<ViewMode>(() =>
    readPref(VIEW_KEY, 'timeline') === 'map' ? 'map' : 'timeline',
  );
  const [shareDefault, setShareDefault] = useState(() => readPref(SHARE_KEY, 'true') !== 'false');
  const [openId, setOpenId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Memory | null>(null);
  const [progress, setProgress] = useState<{
    index: number;
    total: number;
    fraction: number;
  } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const pick = () => input.current?.click();
  useOnAdd('memories', pick);

  const refresh = () => queryClient.invalidateQueries({ queryKey: trpc.memories.list.queryKey() });

  const upload = async (files: File[]) => {
    let done = 0;
    for (const [index, file] of files.entries()) {
      setProgress({ index, total: files.length, fraction: 0 });
      try {
        await uploadMemory(
          file,
          {
            ...(tripId ? { tripId, shared: String(shareDefault) } : {}),
            takenAt: new Date(file.lastModified).toISOString(),
          },
          (fraction) => setProgress({ index, total: files.length, fraction }),
        );
        done++;
        await refresh();
      } catch (err) {
        const code = err instanceof Error ? err.message : 'UPLOAD_FAILED';
        toast.error(
          `${file.name}: ${t(`memories.errors.${code}`, { defaultValue: t('memories.errors.UPLOAD_FAILED') })}`,
        );
      }
    }
    setProgress(null);
    if (done > 0) toast.success(t('memories.uploaded', { count: done }));
  };

  const ordered = useMemo(() => {
    const list: Memory[] = [...(memories ?? [])];
    list.sort((a, b) => memoryDate(a).getTime() - memoryDate(b).getTime());
    // Nel viaggio si racconta in ordine, tra i propri ricordi prima i più recenti.
    return tripId ? list : list.reverse();
  }, [memories, tripId]);

  const days = useMemo(() => {
    const groups = new Map<string, Memory[]>();
    for (const m of ordered) {
      const key = localDay(memoryDate(m));
      groups.set(key, [...(groups.get(key) ?? []), m]);
    }
    return [...groups.entries()];
  }, [ordered]);

  const open = openId ? ordered.findIndex((m) => m.id === openId) : -1;
  const mapped = ordered.filter(hasPoint);
  const unmapped = ordered.filter((m) => !hasPoint(m));
  const dayLabel = (key: string) =>
    new Date(`${key}T12:00:00`).toLocaleDateString(i18n.resolvedLanguage, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });

  return (
    <div className="grid grid-cols-1 gap-5 pb-8">
      {!tripId && <GlobalFab onAdd={pick} />}
      <input
        ref={input}
        type="file"
        accept="image/*,video/*"
        multiple
        className="sr-only"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = '';
          if (files.length > 0) void upload(files);
        }}
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-full border bg-muted/50 p-1">
          {(['timeline', 'map'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setMode(m);
                writePref(VIEW_KEY, m);
              }}
              aria-pressed={mode === m}
              className={cn(
                'flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium transition',
                mode === m ? 'bg-primary text-primary-foreground shadow' : 'text-muted-foreground',
              )}
            >
              {m === 'timeline' ? (
                <GalleryVerticalEnd className="size-4" />
              ) : (
                <MapIcon className="size-4" />
              )}
              {t(`memories.${m}`)}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        {tripId && (
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            {t('memories.shareDefault')}
            <Switch
              checked={shareDefault}
              onCheckedChange={(v) => {
                setShareDefault(v);
                writePref(SHARE_KEY, String(v));
              }}
              aria-label={t('memories.shareDefault')}
            />
          </label>
        )}
        <Button onClick={pick} disabled={!!progress}>
          <Upload />
          {t('memories.upload')}
        </Button>
      </div>

      {progress && (
        <div className="rounded-xl border bg-card p-3 text-sm">
          <p className="font-medium">
            {t('memories.uploading', { current: progress.index + 1, total: progress.total })}
          </p>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-[width]"
              style={{ width: `${Math.round(progress.fraction * 100)}%` }}
            />
          </div>
        </div>
      )}

      {!memories ? (
        <Loader2 className="mx-auto mt-6 animate-spin text-muted-foreground" />
      ) : memories.length === 0 ? (
        <div className="grid place-items-center rounded-xl border border-dashed px-6 py-14 text-center">
          <Camera className="size-12 text-muted-foreground" />
          <p className="mt-3 max-w-sm text-sm text-muted-foreground">
            {t(tripId ? 'memories.emptyTrip' : 'memories.empty')}
          </p>
          <Button className="mt-4" onClick={pick}>
            <Upload />
            {t('memories.upload')}
          </Button>
        </div>
      ) : mode === 'timeline' ? (
        <div className="grid grid-cols-1 gap-6">
          {days.map(([key, items]) => (
            <section key={key}>
              <h3 className="mb-2 flex items-baseline gap-2 text-sm font-semibold capitalize">
                {dayLabel(key)}
                <span className="text-xs font-normal text-muted-foreground">{items.length}</span>
              </h3>
              <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 md:grid-cols-5">
                {items.map((m) => (
                  <Tile key={m.id} memory={m} showOwner={!!tripId} onOpen={() => setOpenId(m.id)} />
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {mapped.length > 0 ? (
            <Suspense fallback={<div className="h-72 animate-pulse rounded-2xl bg-muted" />}>
              <MemoryMap memories={mapped} onOpen={setOpenId} />
            </Suspense>
          ) : (
            <div className="grid place-items-center rounded-xl border border-dashed px-6 py-12 text-center">
              <MapPinOff className="size-10 text-muted-foreground" />
              <p className="mt-3 max-w-sm text-sm text-muted-foreground">
                {t('memories.noMapped')}
              </p>
            </div>
          )}
          {unmapped.length > 0 && (
            <section>
              <h3 className="mb-2 text-sm font-semibold">
                {t('memories.noPlace', { count: unmapped.length })}
              </h3>
              <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6 md:grid-cols-8">
                {unmapped.map((m) => (
                  <Tile key={m.id} memory={m} showOwner={!!tripId} onOpen={() => setOpenId(m.id)} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {open >= 0 && (
        <Lightbox
          memories={ordered}
          index={open}
          onIndex={(i) => setOpenId(ordered[i]!.id)}
          onClose={() => setOpenId(null)}
          onEdit={(m) => {
            setOpenId(null);
            setEditing(m);
          }}
        />
      )}
      {editing && (
        <EditDialog
          memory={editing}
          onClose={() => setEditing(null)}
          onSaved={() => void refresh()}
        />
      )}
    </div>
  );
}

function Tile({
  memory: m,
  showOwner,
  onOpen,
}: {
  memory: Memory;
  showOwner: boolean;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group relative aspect-square overflow-hidden rounded-lg bg-muted"
      aria-label={m.caption ?? t(`memories.kind.${m.kind}`)}
    >
      <img
        src={memoryUrl(m.id, 'thumb')}
        alt=""
        loading="lazy"
        className="size-full object-cover transition group-hover:scale-105"
      />
      {m.kind === 'video' && (
        <span className="absolute right-1 bottom-1 flex items-center gap-1 rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">
          <Play className="size-3 fill-current" />
          {formatDuration(m.durationSec)}
        </span>
      )}
      {m.status === 'processing' && (
        <span className="absolute inset-0 grid place-items-center bg-black/45 text-white">
          <Loader2 className="size-5 animate-spin" />
        </span>
      )}
      {m.mine && !m.shared && (
        <span
          className="absolute top-1 left-1 rounded-full bg-black/55 p-1 text-white"
          title={t('memories.private')}
        >
          <Lock className="size-3" />
        </span>
      )}
      {showOwner && !m.mine && (
        <span className="absolute bottom-1 left-1">
          <UserAvatar user={m.owner} size="sm" className="size-6 text-[10px]" />
        </span>
      )}
    </button>
  );
}

function Lightbox({
  memories,
  index,
  onIndex,
  onClose,
  onEdit,
}: {
  memories: Memory[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
  onEdit: (m: Memory) => void;
}) {
  const { t, i18n } = useTranslation();
  const m = memories[index]!;
  const go = (delta: number) => {
    const next = index + delta;
    if (next >= 0 && next < memories.length) onIndex(next);
  };
  const when = memoryDate(m).toLocaleString(i18n.resolvedLanguage, {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: m.takenAt ? '2-digit' : undefined,
    minute: m.takenAt ? '2-digit' : undefined,
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={when}
        description={m.owner.name}
        className="sm:max-w-3xl"
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') go(-1);
          if (e.key === 'ArrowRight') go(1);
        }}
      >
        <div className="grid grid-cols-1 gap-3 pt-2">
          <div className="relative overflow-hidden rounded-xl bg-black">
            {m.kind === 'video' && m.status === 'ready' ? (
              <video
                key={m.id}
                src={memoryUrl(m.id)}
                poster={memoryUrl(m.id, 'thumb')}
                controls
                playsInline
                preload="metadata"
                className="max-h-[62dvh] w-full"
              />
            ) : (
              <img
                key={m.id}
                src={memoryUrl(m.id, m.kind === 'video' ? 'thumb' : undefined)}
                alt={m.caption ?? ''}
                className="mx-auto max-h-[62dvh] w-auto max-w-full object-contain"
              />
            )}
            {m.status !== 'ready' && (
              <p className="absolute inset-x-0 bottom-0 bg-black/60 px-3 py-2 text-center text-sm text-white">
                {t(m.status === 'processing' ? 'memories.processing' : 'memories.failed')}
              </p>
            )}
            {index > 0 && (
              <button
                type="button"
                onClick={() => go(-1)}
                aria-label={t('common.back')}
                className="absolute top-1/2 left-2 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white hover:bg-black/70"
              >
                <ChevronLeft className="size-5" />
              </button>
            )}
            {index < memories.length - 1 && (
              <button
                type="button"
                onClick={() => go(1)}
                aria-label={t('steps.next')}
                className="absolute top-1/2 right-2 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white hover:bg-black/70"
              >
                <ChevronRight className="size-5" />
              </button>
            )}
          </div>
          {m.caption && <p className="text-sm whitespace-pre-wrap">{m.caption}</p>}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {!m.mine && (
              <span className="flex items-center gap-1.5">
                <UserAvatar user={m.owner} size="sm" className="size-5 text-[9px]" />
                {m.owner.name}
              </span>
            )}
            {m.tripTitle && <span>{m.tripTitle}</span>}
            {hasPoint(m) && (
              <a
                className="inline-flex items-center gap-1 text-primary hover:underline"
                href={`https://www.openstreetmap.org/?mlat=${m.lat}&mlon=${m.lon}#map=16/${m.lat}/${m.lon}`}
                target="_blank"
                rel="noreferrer"
              >
                <ExternalLink className="size-3" />
                {t('memories.openMap')}
              </a>
            )}
            {m.mine && !m.shared && (
              <span className="inline-flex items-center gap-1">
                <Lock className="size-3" />
                {t('memories.private')}
              </span>
            )}
            <span className="ml-auto">
              {index + 1} / {memories.length}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex-1" />
            {m.mine && (
              <Button variant="outline" onClick={() => onEdit(m)}>
                <Pencil />
                {t('common.edit')}
              </Button>
            )}
            <Button onClick={onClose}>{t('common.close')}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Data e ora locali nel formato di `<input type="datetime-local">`. */
const toLocalInput = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return `${localDay(d)}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

function EditDialog({
  memory: m,
  onClose,
  onSaved,
}: {
  memory: Memory;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const trpc = useTRPC();
  const { data: trips } = useQuery(trpc.trips.list.queryOptions());
  const [caption, setCaption] = useState(m.caption ?? '');
  const [takenAt, setTakenAt] = useState(toLocalInput(m.takenAt ?? m.createdAt));
  const [point, setPoint] = useState<{ lat: number; lon: number } | null>(
    hasPoint(m) ? { lat: m.lat, lon: m.lon } : null,
  );
  const [tripId, setTripId] = useState(m.tripId ?? '');
  const [shared, setShared] = useState(m.shared);
  const update = useMutation(trpc.memories.update.mutationOptions());
  const remove = useMutation(trpc.memories.delete.mutationOptions());
  const pending = update.isPending || remove.isPending;

  const save = async () => {
    try {
      await update.mutateAsync({
        id: m.id,
        caption: caption.trim() || null,
        takenAt: takenAt ? new Date(takenAt).toISOString() : null,
        lat: point?.lat ?? null,
        lon: point?.lon ?? null,
        tripId: tripId || null,
        shared: tripId ? shared : false,
      });
      toast.success(t('memories.saved'));
      onSaved();
      onClose();
    } catch {
      toast.error(t('common.error'));
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={t('memories.editTitle')}>
        <div className="grid grid-cols-1 gap-4 pt-2">
          <img
            src={memoryUrl(m.id, 'thumb')}
            alt=""
            className="mx-auto max-h-40 rounded-xl object-contain"
          />
          <Field label={t('memories.caption')} htmlFor="mem-caption">
            <textarea
              id="mem-caption"
              rows={2}
              maxLength={1000}
              className={textareaClass}
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
            />
          </Field>
          <Field label={t('memories.date')} htmlFor="mem-date">
            <input
              id="mem-date"
              type="datetime-local"
              value={takenAt}
              onChange={(e) => setTakenAt(e.target.value)}
              className="flex h-11 w-full rounded-xl border bg-background px-3 text-base"
            />
          </Field>
          <Field label={t('memories.place')} hint={t('memories.placeHint')}>
            <div className="grid grid-cols-1 gap-2">
              <Suspense fallback={<div className="h-56 animate-pulse rounded-xl bg-muted" />}>
                <PlacePicker value={point} onChange={setPoint} />
              </Suspense>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    navigator.geolocation?.getCurrentPosition(
                      (p) => setPoint({ lat: p.coords.latitude, lon: p.coords.longitude }),
                      () => toast.error(t('memories.locationDenied')),
                    )
                  }
                >
                  <LocateFixed />
                  {t('memories.useMyPosition')}
                </Button>
                {point && (
                  <Button type="button" variant="ghost" size="sm" onClick={() => setPoint(null)}>
                    <MapPinOff />
                    {t('memories.removePlace')}
                  </Button>
                )}
              </div>
            </div>
          </Field>
          <Field label={t('memories.trip')} htmlFor="mem-trip">
            <Select
              id="mem-trip"
              value={tripId}
              onChange={(e) => {
                setTripId(e.target.value);
                if (e.target.value && !m.tripId) setShared(true);
              }}
            >
              <option value="">{t('memories.noTrip')}</option>
              {(trips ?? []).map((tr) => (
                <option key={tr.id} value={tr.id}>
                  {tr.title}
                </option>
              ))}
            </Select>
          </Field>
          <label className="flex items-center justify-between gap-4">
            <span className="text-sm font-medium">{t('memories.shareWithGroup')}</span>
            <Switch checked={!!tripId && shared} disabled={!tripId} onCheckedChange={setShared} />
          </label>
          <div className={DIALOG_FOOTER}>
            <Button
              type="button"
              variant="ghost"
              className="text-destructive"
              disabled={pending}
              aria-label={t('expense.delete')}
              onClick={async () => {
                if (!(await confirmDialog(t('memories.confirmDelete')))) return;
                await remove.mutateAsync({ id: m.id });
                toast.success(t('memories.deleted'));
                onSaved();
                onClose();
              }}
            >
              <Trash2 />
              <span className="hidden sm:inline">{t('expense.delete')}</span>
            </Button>
            <div className="flex-1" />
            <Button size="lg" disabled={pending} onClick={() => void save()}>
              {update.isPending && <Loader2 className="animate-spin" />}
              {t('common.save')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Pagina dei ricordi personali (barra in basso). */
export function MemoriesPage() {
  const { t } = useTranslation();
  return (
    <div className="grid grid-cols-1 gap-5">
      <h1 className="text-2xl font-bold tracking-tight">{t('memories.title')}</h1>
      <MemoriesView />
    </div>
  );
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Camera,
  Check,
  CheckCheck,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  Download,
  GalleryVerticalEnd,
  Loader2,
  LocateFixed,
  Lock,
  Map as MapIcon,
  MapPin,
  MapPinOff,
  Pencil,
  Plane,
  Play,
  Search,
  Share2,
  Trash2,
  Upload,
  Users,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import {
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog as DialogPrimitive } from 'radix-ui';
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
  canShareFiles,
  downloadMemories,
  formatDuration,
  hasPoint,
  lastTrip,
  memoryDate,
  MAX_ZIP,
  memoryUrl,
  prepareFile,
  shareMemories,
  uploadMemory,
  type Memory,
} from '@/lib/memories';
import { useTRPC } from '@/lib/trpc';
import { cn } from '@/lib/utils';
import { textareaClass } from '../trip/plan/fields';

const MemoryMap = lazy(() => import('./memory-map'));
const PlacePicker = lazy(() => import('./memory-map').then((m) => ({ default: m.PlacePicker })));

type ViewMode = 'trips' | 'timeline' | 'map';
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
  // Nella pagina Ricordi si parte divisi per viaggio; nella scheda di un viaggio non serve.
  const modes: ViewMode[] = tripId ? ['timeline', 'map'] : ['trips', 'timeline', 'map'];
  const [stored, setStored] = useState<string>(() => readPref(VIEW_KEY, 'trips'));
  const mode = (modes as string[]).includes(stored) ? (stored as ViewMode) : modes[0]!;
  const [openId, setOpenId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Memory | null>(null);
  const [staged, setStaged] = useState<File[] | null>(null);
  // Selezione multipla: null = spenta.
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const pick = () => input.current?.click();
  useOnAdd('memories', pick);

  const refresh = () => queryClient.invalidateQueries({ queryKey: trpc.memories.list.queryKey() });

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

  // Divisi per viaggio: prima quello con il ricordo più recente, in fondo i ricordi senza viaggio.
  const byTrip = useMemo(() => {
    const groups = new Map<string, { title: string | null; items: Memory[] }>();
    for (const m of ordered) {
      const key = m.tripId ?? '';
      const g = groups.get(key) ?? { title: m.tripTitle, items: [] };
      g.items.push(m);
      groups.set(key, g);
    }
    return [...groups.entries()].sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : 0));
  }, [ordered]);
  // L'ordine in cui si scorre a schermo intero è quello mostrato.
  const nav = useMemo(
    () => (mode === 'trips' ? byTrip.flatMap(([, g]) => g.items) : ordered),
    [mode, byTrip, ordered],
  );
  const open = openId ? nav.findIndex((m) => m.id === openId) : -1;
  const toggle = (id: string) =>
    setPicked((cur) => {
      const next = new Set(cur ?? []);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const pickedList = nav.filter((m) => picked?.has(m.id));
  const tile = (m: Memory, showOwner: boolean) => (
    <Tile
      key={m.id}
      memory={m}
      showOwner={showOwner}
      selecting={picked !== null}
      selected={!!picked?.has(m.id)}
      onTap={() => (picked ? toggle(m.id) : setOpenId(m.id))}
      onLongPress={() => (picked ? toggle(m.id) : setPicked(new Set([m.id])))}
    />
  );
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
          if (files.length > 0) setStaged(files);
        }}
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-full border bg-muted/50 p-1">
          {modes.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setStored(m);
                writePref(VIEW_KEY, m);
              }}
              aria-pressed={mode === m}
              className={cn(
                'flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium transition',
                mode === m ? 'bg-primary text-primary-foreground shadow' : 'text-muted-foreground',
              )}
            >
              {m === 'trips' ? (
                <Plane className="size-4" />
              ) : m === 'timeline' ? (
                <GalleryVerticalEnd className="size-4" />
              ) : (
                <MapIcon className="size-4" />
              )}
              {t(`memories.${m}`)}
            </button>
          ))}
        </div>
        {memories && memories.length > 0 && (
          <Button
            variant={picked ? 'default' : 'ghost'}
            size="sm"
            className="ml-auto"
            onClick={() => setPicked(picked ? null : new Set())}
          >
            <CheckSquare />
            {t(picked ? 'common.cancel' : 'memories.select')}
          </Button>
        )}
      </div>

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
      ) : mode === 'trips' ? (
        <div className="grid grid-cols-1 gap-7">
          {byTrip.map(([key, g]) => (
            <section key={key || 'none'}>
              <h3 className="mb-2 flex items-baseline gap-2 text-base font-semibold">
                {g.title ?? t('memories.noTripGroup')}
                <span className="text-xs font-normal text-muted-foreground">{g.items.length}</span>
              </h3>
              <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 md:grid-cols-5">
                {g.items.map((m) => tile(m, false))}
              </div>
            </section>
          ))}
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
                {items.map((m) => tile(m, !!tripId))}
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
                {unmapped.map((m) => tile(m, !!tripId))}
              </div>
            </section>
          )}
        </div>
      )}

      {picked && (
        <SelectionBar
          selected={pickedList}
          total={nav.length}
          onSelectAll={() => setPicked(new Set(nav.map((m) => m.id)))}
          onExit={() => setPicked(null)}
        />
      )}
      {staged && (
        <UploadDialog
          files={staged}
          tripId={tripId}
          onClose={() => setStaged(null)}
          onDone={() => void refresh()}
        />
      )}
      {open >= 0 && (
        <Lightbox
          memories={nav}
          index={open}
          onIndex={(i) => setOpenId(nav[i]!.id)}
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
  selecting,
  selected,
  onTap,
  onLongPress,
}: {
  memory: Memory;
  showOwner: boolean;
  selecting: boolean;
  selected: boolean;
  onTap: () => void;
  onLongPress: () => void;
}) {
  const { t } = useTranslation();
  // Pressione lunga = inizia la selezione; il tocco che segue il rilascio non deve aprire il ricordo.
  const timer = useRef<number | undefined>(undefined);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);
  const cancel = () => {
    window.clearTimeout(timer.current);
    origin.current = null;
  };
  return (
    <button
      type="button"
      onClick={() => {
        if (fired.current) {
          fired.current = false;
          return;
        }
        onTap();
      }}
      onPointerDown={(e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        fired.current = false;
        origin.current = { x: e.clientX, y: e.clientY };
        timer.current = window.setTimeout(() => {
          fired.current = true;
          navigator.vibrate?.(15);
          onLongPress();
        }, 450);
      }}
      onPointerMove={(e) => {
        const o = origin.current;
        if (o && Math.hypot(e.clientX - o.x, e.clientY - o.y) > 10) cancel();
      }}
      onPointerUp={cancel}
      onPointerCancel={cancel}
      onPointerLeave={cancel}
      onContextMenu={(e) => e.preventDefault()}
      aria-pressed={selecting ? selected : undefined}
      className={cn(
        'group relative aspect-square select-none overflow-hidden rounded-lg bg-muted [-webkit-touch-callout:none]',
        selected && 'ring-4 ring-primary ring-inset',
      )}
      aria-label={m.caption ?? t(`memories.kind.${m.kind}`)}
    >
      <img
        src={memoryUrl(m.id, 'thumb')}
        alt=""
        loading="lazy"
        draggable={false}
        className={cn(
          'size-full object-cover transition group-hover:scale-105',
          selected && 'scale-90 rounded-md',
        )}
      />
      {selecting && (
        <span
          className={cn(
            'absolute top-1.5 right-1.5 grid size-6 place-items-center rounded-full border-2 border-white shadow',
            selected ? 'bg-primary text-primary-foreground' : 'bg-black/30',
          )}
        >
          {selected && <Check className="size-3.5" />}
        </span>
      )}
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
      {m.mine && !m.shared && !selecting && (
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

/** Barra delle azioni sui ricordi selezionati: scarica (uno solo o ZIP) e condividi dal sistema. */
function SelectionBar({
  selected,
  total,
  onSelectAll,
  onExit,
}: {
  selected: Memory[];
  total: number;
  onSelectAll: () => void;
  onExit: () => void;
}) {
  const { t } = useTranslation();
  const [sharing, setSharing] = useState(false);
  // I file si preparano subito: su iPhone il menu "Condividi" si apre solo dal tocco diretto.
  useEffect(() => {
    if (!canShareFiles()) return;
    if (selected.reduce((sum, m) => sum + m.size, 0) > 80 * 1024 * 1024) return;
    selected.forEach((m) => void prepareFile(m).catch(() => undefined));
  }, [selected]);
  const none = selected.length === 0;
  const download = () => {
    if (selected.length > MAX_ZIP) return toast.error(t('memories.tooMany', { max: MAX_ZIP }));
    downloadMemories(selected);
    toast.success(t(selected.length > 1 ? 'memories.zipStarted' : 'memories.downloadStarted'));
  };
  const share = async () => {
    setSharing(true);
    const result = await shareMemories(selected);
    setSharing(false);
    if (result === 'retry') toast.message(t('memories.shareRetry'));
    else if (result === 'unsupported' || result === 'failed') {
      toast.error(t('memories.shareUnsupported'));
    }
  };
  const btn = 'size-10 rounded-full [&_svg]:size-5';
  return (
    <div
      role="toolbar"
      aria-label={t('memories.selection')}
      className="fixed inset-x-3 bottom-[calc(5.25rem+env(safe-area-inset-bottom))] z-40 mx-auto flex max-w-md items-center gap-1 rounded-full border bg-card/95 py-1.5 pr-2 pl-1.5 shadow-lg backdrop-blur lg:bottom-6"
    >
      <Button
        variant="ghost"
        size="icon"
        className={btn}
        onClick={onExit}
        aria-label={t('common.cancel')}
      >
        <X />
      </Button>
      <p className="min-w-0 flex-1 truncate text-sm font-semibold">
        {t('memories.selected', { count: selected.length })}
      </p>
      <Button
        variant="ghost"
        size="icon"
        className={btn}
        onClick={onSelectAll}
        disabled={selected.length === total}
        aria-label={t('memories.selectAll')}
        title={t('memories.selectAll')}
      >
        <CheckCheck />
      </Button>
      {canShareFiles() && (
        <Button
          variant="outline"
          size="icon"
          className={btn}
          onClick={() => void share()}
          disabled={none || sharing}
          aria-label={t('memories.share')}
          title={t('memories.share')}
        >
          {sharing ? <Loader2 className="animate-spin" /> : <Share2 />}
        </Button>
      )}
      <Button
        size="icon"
        className={btn}
        onClick={download}
        disabled={none}
        aria-label={t('memories.download')}
        title={t(selected.length > 1 ? 'memories.downloadZip' : 'memories.download')}
      >
        <Download />
      </Button>
    </div>
  );
}

/** Anteprima di un file scelto (foto o primo fotogramma del video), letta dal dispositivo. */
function Preview({ file }: { file: File }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    // L'indirizzo si crea e si libera qui: così regge anche il doppio montaggio di React.
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  if (!url) return null;
  if (file.type.startsWith('video/'))
    return (
      <>
        <video
          src={`${url}#t=0.1`}
          muted
          playsInline
          preload="metadata"
          className="size-full object-cover"
        />
        <span className="absolute right-1 bottom-1 rounded-full bg-black/60 p-1 text-white">
          <Play className="size-3 fill-current" />
        </span>
      </>
    );
  return <img src={url} alt="" className="size-full object-cover" />;
}

/**
 * Anteprima dei file scelti, prima del caricamento: si possono togliere e si decide se
 * condividerli con il gruppo del viaggio o tenerli privati.
 */
function UploadDialog({
  files,
  tripId,
  onClose,
  onDone,
}: {
  files: File[];
  tripId?: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const trpc = useTRPC();
  const { data: trips } = useQuery(trpc.trips.list.queryOptions());
  const [items, setItems] = useState(() => files.map((file, id) => ({ id, file })));
  const [shared, setShared] = useState(() => readPref(SHARE_KEY, 'true') !== 'false');
  // Dalla pagina Ricordi: collegamento automatico (dal giorno dello scatto), nessuno o un viaggio.
  const [chosen, setChosen] = useState(() => tripId ?? lastTrip() ?? 'auto');
  const [caption, setCaption] = useState('');
  // Un viaggio che non c'è più (o non è tuo) torna al collegamento automatico.
  const target =
    chosen !== 'auto' && chosen !== 'none' && trips && !trips.some((tr) => tr.id === chosen)
      ? 'auto'
      : chosen;
  const [progress, setProgress] = useState<{ index: number; fraction: number } | null>(null);
  // Posizione attuale, per le foto senza GPS (utile se si carica subito dopo lo scatto).
  const [here, setHere] = useState<Point | null>(null);
  const [locating, setLocating] = useState(false);
  const useHere = (on: boolean) => {
    if (!on) return setHere(null);
    setLocating(true);
    navigator.geolocation?.getCurrentPosition(
      (p) => {
        setHere({ lat: p.coords.latitude, lon: p.coords.longitude });
        setLocating(false);
      },
      () => {
        setLocating(false);
        toast.error(t('memories.locationDenied'));
      },
      { enableHighAccuracy: true, timeout: 15_000 },
    );
  };
  const uploading = progress !== null;
  const noTrip = target === 'none';

  const upload = async () => {
    writePref(SHARE_KEY, String(shared));
    const failed: typeof items = [];
    const total = items.length;
    for (const [index, item] of items.entries()) {
      setProgress({ index, fraction: 0 });
      try {
        await uploadMemory(
          item.file,
          {
            ...(target === 'auto' ? {} : { tripId: target }),
            ...(caption.trim() ? { caption: caption.trim() } : {}),
            shared: String(shared && !noTrip),
            takenAt: new Date(item.file.lastModified).toISOString(),
            // Vale solo se il file non ha già una posizione: il server dà la precedenza al file.
            ...(here ? { lat: String(here.lat), lon: String(here.lon) } : {}),
          },
          (fraction) => setProgress({ index, fraction }),
        );
      } catch (err) {
        failed.push(item);
        const code = err instanceof Error ? err.message : 'UPLOAD_FAILED';
        toast.error(
          `${item.file.name}: ${t(`memories.errors.${code}`, { defaultValue: t('memories.errors.UPLOAD_FAILED') })}`,
        );
      }
    }
    setProgress(null);
    const done = total - failed.length;
    if (done > 0) {
      toast.success(t('memories.uploaded', { count: done }));
      onDone();
    }
    if (failed.length === 0) onClose();
    else setItems(failed);
  };

  const option = (value: boolean, icon: ReactNode, label: string, hint: string) => (
    <button
      type="button"
      disabled={uploading || noTrip}
      onClick={() => setShared(value)}
      aria-pressed={shared === value}
      className={cn(
        'flex items-start gap-3 rounded-xl border p-3 text-left transition disabled:opacity-50',
        shared === value ? 'border-primary bg-primary/10' : 'hover:bg-muted',
      )}
    >
      <span className="mt-0.5 text-primary">{icon}</span>
      <span>
        <span className="block text-sm font-semibold">{label}</span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </span>
    </button>
  );

  return (
    <Dialog open onOpenChange={(o) => !o && !uploading && onClose()}>
      <DialogContent title={t('memories.newTitle', { count: items.length })}>
        <div className="grid grid-cols-1 gap-4 pt-2">
          <Field label={t('memories.trip')} htmlFor="up-trip">
            <Select
              id="up-trip"
              value={target}
              disabled={uploading}
              onChange={(e) => setChosen(e.target.value)}
            >
              <option value="auto">{t('memories.tripAuto')}</option>
              <option value="none">{t('memories.noTrip')}</option>
              {(trips ?? []).map((tr) => (
                <option key={tr.id} value={tr.id}>
                  {tr.title}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
            {items.map((item) => (
              <div
                key={item.id}
                className="relative aspect-square overflow-hidden rounded-lg bg-muted"
              >
                <Preview file={item.file} />
                {!uploading && (
                  <button
                    type="button"
                    aria-label={t('common.delete')}
                    onClick={() => setItems((all) => all.filter((x) => x !== item))}
                    className="absolute top-1 right-1 rounded-full bg-black/60 p-1 text-white"
                  >
                    <X className="size-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
          <label className="flex items-start justify-between gap-4 rounded-xl border p-3">
            <span>
              <span className="block text-sm font-semibold">{t('memories.useHere')}</span>
              <span className="block text-xs text-muted-foreground">
                {t('memories.useHereHint')}
              </span>
            </span>
            <span className="flex items-center gap-2">
              {locating && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
              <Switch
                checked={!!here}
                disabled={uploading || locating}
                onCheckedChange={useHere}
                aria-label={t('memories.useHere')}
              />
            </span>
          </label>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {option(
              true,
              <Users className="size-5" />,
              t('memories.visibility.shared'),
              t('memories.visibility.sharedHint'),
            )}
            {option(
              false,
              <Lock className="size-5" />,
              t('memories.visibility.private'),
              t('memories.visibility.privateHint'),
            )}
          </div>
          {uploading && (
            <div>
              <p className="text-sm font-medium">
                {t('memories.uploading', { current: progress.index + 1, total: items.length })}
              </p>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-[width]"
                  style={{ width: `${Math.round(progress.fraction * 100)}%` }}
                />
              </div>
            </div>
          )}
          <Field
            label={t(items.length > 1 ? 'memories.captionAll' : 'memories.caption')}
            htmlFor="up-caption"
          >
            <textarea
              id="up-caption"
              rows={2}
              maxLength={1000}
              className={textareaClass}
              value={caption}
              disabled={uploading}
              onChange={(e) => setCaption(e.target.value)}
            />
          </Field>
          <div className={DIALOG_FOOTER}>
            <div className="flex-1" />
            <Button type="button" variant="ghost" disabled={uploading} onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button
              size="lg"
              disabled={uploading || items.length === 0}
              onClick={() => void upload()}
            >
              {uploading ? <Loader2 className="animate-spin" /> : <Upload />}
              {t('memories.uploadCount', { count: items.length })}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Ricordo a schermo intero: si scorre di lato tra i ricordi e il video visibile parte da solo,
 * senza audio e in ripetizione (il pulsante in alto attiva il suono).
 */
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
  const scroller = useRef<HTMLDivElement>(null);
  const [muted, setMuted] = useState(true);
  const m = memories[index]!;
  // Il file da condividere si prepara in anticipo (su iPhone la condivisione parte dal tocco).
  useEffect(() => {
    if (canShareFiles() && m.size < 40 * 1024 * 1024) void prepareFile(m).catch(() => undefined);
  }, [m]);

  const scrollTo = (i: number, behavior: ScrollBehavior = 'smooth') => {
    const el = scroller.current;
    if (el) el.scrollTo({ left: i * el.clientWidth, behavior });
  };
  // All'apertura si parte dal ricordo scelto.
  useLayoutEffect(() => {
    scrollTo(index, 'instant');
    // solo al montaggio
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const go = (delta: number) => {
    const next = index + delta;
    if (next >= 0 && next < memories.length) {
      onIndex(next);
      scrollTo(next);
    }
  };
  const settle = useRef<number | undefined>(undefined);
  const onScroll = () => {
    window.clearTimeout(settle.current);
    settle.current = window.setTimeout(() => {
      const el = scroller.current;
      if (!el || el.clientWidth === 0) return;
      const i = Math.round(el.scrollLeft / el.clientWidth);
      if (i !== index && i >= 0 && i < memories.length) onIndex(i);
    }, 80);
  };

  const when = memoryDate(m).toLocaleString(i18n.resolvedLanguage, {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: m.takenAt ? '2-digit' : undefined,
    minute: m.takenAt ? '2-digit' : undefined,
  });
  const iconButton =
    'rounded-full bg-black/50 p-2.5 text-white backdrop-blur hover:bg-black/70 [&_svg]:size-5';
  return (
    <DialogPrimitive.Root open onOpenChange={(o) => !o && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          className="fixed inset-0 z-50 bg-black text-white outline-none"
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') go(-1);
            if (e.key === 'ArrowRight') go(1);
          }}
        >
          <DialogPrimitive.Title className="sr-only">{when}</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            {m.owner.name}
          </DialogPrimitive.Description>
          <div
            ref={scroller}
            onScroll={onScroll}
            className="flex h-dvh snap-x snap-mandatory overflow-x-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {memories.map((mem, i) => (
              <div
                key={mem.id}
                className="flex h-full w-full shrink-0 snap-center snap-always items-center justify-center"
              >
                {Math.abs(i - index) <= 1 &&
                  (mem.kind === 'video' && mem.status === 'ready' ? (
                    <video
                      src={memoryUrl(mem.id)}
                      poster={memoryUrl(mem.id, 'thumb')}
                      autoPlay={i === index}
                      loop
                      muted={muted}
                      playsInline
                      controls={i === index}
                      preload={i === index ? 'auto' : 'metadata'}
                      ref={(el) => {
                        // Solo il video visibile va; gli altri si fermano.
                        if (!el) return;
                        if (i === index) void el.play().catch(() => undefined);
                        else el.pause();
                      }}
                      className="max-h-full max-w-full"
                    />
                  ) : (
                    <img
                      src={memoryUrl(mem.id, mem.kind === 'video' ? 'thumb' : undefined)}
                      alt={mem.caption ?? ''}
                      className="max-h-full max-w-full object-contain"
                    />
                  ))}
              </div>
            ))}
          </div>

          <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start gap-3 bg-gradient-to-b from-black/70 to-transparent p-3 pt-[calc(0.75rem+env(safe-area-inset-top))]">
            <div className="pointer-events-auto min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{when}</p>
              <p className="flex items-center gap-1.5 truncate text-xs text-white/75">
                {m.owner.name}
                {m.tripTitle && <span>· {m.tripTitle}</span>}
                {m.mine && !m.shared && <Lock className="size-3" />}
                <span className="ml-1">
                  {index + 1} / {memories.length}
                </span>
              </p>
            </div>
            {m.kind === 'video' && (
              <button
                type="button"
                onClick={() => setMuted((v) => !v)}
                aria-label={t(muted ? 'memories.soundOn' : 'memories.soundOff')}
                className={cn(iconButton, 'pointer-events-auto')}
              >
                {muted ? <VolumeX /> : <Volume2 />}
              </button>
            )}
            {canShareFiles() && (
              <button
                type="button"
                onClick={async () => {
                  const r = await shareMemories([m]);
                  if (r === 'retry') toast.message(t('memories.shareRetry'));
                  else if (r === 'unsupported' || r === 'failed') {
                    toast.error(t('memories.shareUnsupported'));
                  }
                }}
                aria-label={t('memories.share')}
                className={cn(iconButton, 'pointer-events-auto')}
              >
                <Share2 />
              </button>
            )}
            <button
              type="button"
              onClick={() => downloadMemories([m])}
              aria-label={t('memories.download')}
              className={cn(iconButton, 'pointer-events-auto')}
            >
              <Download />
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label={t('common.close')}
              className={cn(iconButton, 'pointer-events-auto')}
            >
              <X />
            </button>
          </div>

          {index > 0 && (
            <button
              type="button"
              onClick={() => go(-1)}
              aria-label={t('common.back')}
              className={cn(iconButton, 'absolute top-1/2 left-3 hidden -translate-y-1/2 sm:block')}
            >
              <ChevronLeft />
            </button>
          )}
          {index < memories.length - 1 && (
            <button
              type="button"
              onClick={() => go(1)}
              aria-label={t('steps.next')}
              className={cn(
                iconButton,
                'absolute top-1/2 right-3 hidden -translate-y-1/2 sm:block',
              )}
            >
              <ChevronRight />
            </button>
          )}

          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end gap-3 bg-gradient-to-t from-black/75 to-transparent p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
            <div className="pointer-events-auto min-w-0 flex-1 text-sm">
              {m.status !== 'ready' && (
                <p className="mb-1 text-amber-300">
                  {t(m.status === 'processing' ? 'memories.processing' : 'memories.failed')}
                </p>
              )}
              {m.caption && <p className="whitespace-pre-wrap">{m.caption}</p>}
              {hasPoint(m) && (
                <a
                  className="mt-1 flex items-center gap-1 text-xs text-white/80 underline"
                  href={`https://www.openstreetmap.org/?mlat=${m.lat}&mlon=${m.lon}#map=16/${m.lat}/${m.lon}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <MapPin className="size-3" />
                  {m.placeName ?? t('memories.openMap')}
                </a>
              )}
            </div>
            {m.mine && (
              <button
                type="button"
                onClick={() => onEdit(m)}
                aria-label={t('common.edit')}
                className={cn(iconButton, 'pointer-events-auto')}
              >
                <Pencil />
              </button>
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
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
  const [placeName, setPlaceName] = useState<string | null>(m.placeName);
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
        placeName: point ? placeName : null,
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
          <PlaceField
            point={point}
            name={placeName}
            tripId={tripId}
            onChange={(p, n) => {
              setPoint(p);
              setPlaceName(n);
            }}
          />
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

type Point = { lat: number; lon: number };

/**
 * Dove è stato fatto un ricordo: si cerca un luogo per nome (OpenStreetMap), si sceglie uno dei
 * luoghi salvati nel viaggio, si usa la posizione attuale o si tocca la mappa. Il punto prende
 * subito il nome del luogo (reverse lookup).
 */
function PlaceField({
  point,
  name,
  tripId,
  onChange,
}: {
  point: Point | null;
  name: string | null;
  tripId: string;
  onChange: (point: Point | null, name: string | null) => void;
}) {
  const { t } = useTranslation();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [resolving, setResolving] = useState(false);
  const search = useQuery({
    ...trpc.memories.searchPlace.queryOptions({ query: submitted }),
    enabled: submitted.length >= 2,
    retry: false,
  });
  const { data: plan } = useQuery({
    ...trpc.plan.get.queryOptions({ tripId }),
    enabled: !!tripId,
  });
  const places = plan?.plan?.places ?? [];
  const latest = useRef<Point | null>(point);
  latest.current = point;

  /** Sceglie un punto; se il nome non si conosce lo chiede a OpenStreetMap. */
  const choose = async (next: Point, known: string | null = null) => {
    latest.current = next;
    onChange(next, known);
    if (known) return;
    setResolving(true);
    try {
      const { label } = await queryClient.fetchQuery(trpc.memories.reverse.queryOptions(next));
      // Se nel frattempo si è scelto un altro punto, il nome non vale più.
      if (latest.current === next) onChange(next, label);
    } finally {
      setResolving(false);
    }
  };
  // Un ricordo con la posizione letta dal file ma senza nome: si completa all'apertura.
  useEffect(() => {
    if (point && !name) void choose(point);
    // solo al montaggio
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = () => setSubmitted(query.trim());
  const pickSaved = async (id: string) => {
    const place = places.find((p) => p.id === id);
    if (!place) return;
    if (place.location)
      return choose({ lat: place.location.lat, lon: place.location.lng }, place.name);
    setResolving(true);
    try {
      const hits = await queryClient.fetchQuery(
        trpc.memories.searchPlace.queryOptions({
          query: [place.name, place.address].filter(Boolean).join(', '),
        }),
      );
      const hit = hits[0];
      if (hit) await choose({ lat: hit.lat, lon: hit.lon }, place.name);
      else toast.error(t('memories.placeNotFound'));
    } catch {
      toast.error(t('memories.searchFailed'));
    } finally {
      setResolving(false);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-2">
      <span className="text-sm font-medium">{t('memories.place')}</span>
      <div className="flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={t('memories.searchPlace')}
          aria-label={t('memories.searchPlace')}
          className="flex h-11 min-w-0 flex-1 rounded-xl border bg-background px-3 text-base"
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-11"
          onClick={submit}
          disabled={query.trim().length < 2}
          aria-label={t('common.search')}
        >
          {search.isFetching ? <Loader2 className="animate-spin" /> : <Search />}
        </Button>
      </div>
      {submitted.length >= 2 && !search.isFetching && (
        <div className="grid grid-cols-1 overflow-hidden rounded-xl border">
          {search.isError ? (
            <p className="p-3 text-sm text-destructive">{t('memories.searchFailed')}</p>
          ) : (search.data ?? []).length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">{t('memories.placeNotFound')}</p>
          ) : (
            search.data!.map((hit) => (
              <button
                key={`${hit.lat},${hit.lon}`}
                type="button"
                onClick={() => {
                  void choose({ lat: hit.lat, lon: hit.lon }, hit.label);
                  setSubmitted('');
                  setQuery('');
                }}
                className="border-b px-3 py-2 text-left last:border-b-0 hover:bg-muted"
              >
                <span className="block text-sm font-medium">{hit.label}</span>
                <span className="block truncate text-xs text-muted-foreground">{hit.detail}</span>
              </button>
            ))
          )}
        </div>
      )}
      {places.length > 0 && (
        <Select
          value=""
          onChange={(e) => void pickSaved(e.target.value)}
          aria-label={t('memories.savedPlaces')}
        >
          <option value="">{t('memories.savedPlaces')}</option>
          {places.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      )}
      <Suspense fallback={<div className="h-56 animate-pulse rounded-xl bg-muted" />}>
        <PlacePicker value={point} onChange={(p) => void choose(p)} />
      </Suspense>
      <p className="flex min-h-5 items-center gap-1.5 text-sm">
        {resolving ? (
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        ) : (
          <MapPin className="size-4 text-primary" />
        )}
        {point ? (
          <span className="min-w-0 truncate">
            {name ?? `${point.lat.toFixed(4)}, ${point.lon.toFixed(4)}`}
          </span>
        ) : (
          <span className="text-muted-foreground">{t('memories.placeHint')}</span>
        )}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            navigator.geolocation?.getCurrentPosition(
              (p) => void choose({ lat: p.coords.latitude, lon: p.coords.longitude }),
              () => toast.error(t('memories.locationDenied')),
            )
          }
        >
          <LocateFixed />
          {t('memories.useMyPosition')}
        </Button>
        {point && (
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null, null)}>
            <MapPinOff />
            {t('memories.removePlace')}
          </Button>
        )}
      </div>
    </div>
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

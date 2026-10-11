import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { Place } from '@tripshare/shared/trip-format';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { ZoomImage } from '@/components/zoom-image';
import { usePlanOps } from '@/lib/plan';
import { useTRPC } from '@/lib/trpc';

interface Slide {
  full: string;
  thumb: string;
  title: string;
  credit: string;
  /** Foto già salvata nel luogo (le altre vengono dalla ricerca). */
  current?: boolean;
}

/** Quante pagine (da 10 foto) si possono caricare al massimo per un luogo. */
const MAX_PAGES = 15;

/**
 * Anteprima delle foto di un luogo: si parte da quella del luogo, poi si scorre di lato e,
 * avvicinandosi alla fine, se ne caricano altre 10 dalle stesse fonti della ricerca
 * (Wikimedia Commons e web). Chi può modificare il programma può usarne una come foto del luogo.
 */
export function PlaceGallery({
  tripId,
  place,
  destination,
  canEdit,
  onClose,
}: {
  tripId: string;
  place: Pick<Place, 'id' | 'name' | 'kind' | 'photo' | 'photoCredit'>;
  destination?: string;
  canEdit?: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { apply } = usePlanOps(tripId);
  const download = useMutation(trpc.plan.placePhotoFromUrl.mutationOptions());
  const [slides, setSlides] = useState<Slide[]>(() =>
    place.photo
      ? [
          {
            full: place.photo,
            thumb: place.photo,
            title: place.name,
            credit: place.photoCredit ?? '',
            current: true,
          },
        ]
      : [],
  );
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [failed, setFailed] = useState<Set<string>>(new Set());
  const page = useRef(0);
  const busy = useRef(false);
  const scroller = useRef<HTMLDivElement>(null);

  const loadMore = useCallback(async () => {
    if (busy.current || page.current >= MAX_PAGES) return;
    busy.current = true;
    setLoading(true);
    try {
      const found = await queryClient.fetchQuery({
        ...trpc.plan.placePhotoSearch.queryOptions({
          tripId,
          query: [place.name, destination].filter(Boolean).join(' '),
          page: page.current,
          name: place.name,
          kind: place.kind,
        }),
        staleTime: 600_000,
      });
      page.current += 1;
      if (found.length === 0) setDone(true);
      setSlides((prev) => {
        const known = new Set(prev.map((s) => s.full));
        const fresh = found
          .filter((p) => !known.has(p.full))
          .map((p) => ({
            full: p.full,
            thumb: p.thumb,
            title: p.title,
            credit: p.credit ?? p.source,
          }));
        return [...prev, ...fresh];
      });
    } catch {
      setDone(true);
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }, [queryClient, trpc, tripId, place.name, place.kind, destination]);

  // Prima pagina all'apertura; poi altre quando ci si avvicina alla fine.
  useEffect(() => {
    void loadMore();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!done && !loading && slides.length - index <= 3) void loadMore();
  }, [index, slides.length, done, loading, loadMore]);

  const goTo = (i: number) => {
    const el = scroller.current;
    if (el) el.scrollTo({ left: i * el.clientWidth, behavior: 'smooth' });
  };
  const current = slides[index];

  const use = async (slide: Slide) => {
    const saved = await download.mutateAsync({ tripId, url: slide.full }).catch(() => null);
    if (!saved) return void toast.error(t('placePhoto.error'));
    await apply([
      {
        type: 'setPlacePhoto',
        id: place.id,
        photo: saved.url,
        ...(slide.credit ? { photoCredit: slide.credit } : {}),
      },
    ]);
    toast.success(t('placePhoto.gallery.used'));
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={place.name}
        description={current?.credit || undefined}
        className="sm:max-w-2xl"
      >
        <div className="relative">
          <div
            ref={scroller}
            onScroll={(e) => {
              const el = e.currentTarget;
              setIndex(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)));
            }}
            className="flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain rounded-xl [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {slides.map((s) => (
              <div key={s.full} className="grid w-full shrink-0 snap-center place-items-center">
                <ZoomImage
                  src={failed.has(s.full) ? s.thumb : s.full}
                  alt={s.title || place.name}
                  referrerPolicy="no-referrer"
                  onError={() => setFailed((f) => new Set(f).add(s.full))}
                  className="max-h-[60dvh] w-full rounded-xl object-contain"
                />
              </div>
            ))}
            {slides.length === 0 && !loading && (
              <p className="w-full py-16 text-center text-sm text-muted-foreground">
                {t('placePhoto.gallery.none')}
              </p>
            )}
            {loading && slides.length === 0 && (
              <div className="grid w-full place-items-center py-16">
                <Loader2 className="animate-spin text-muted-foreground" />
              </div>
            )}
          </div>
          {slides.length > 1 && (
            <>
              <Button
                type="button"
                size="icon"
                variant="secondary"
                className="absolute top-1/2 left-2 hidden -translate-y-1/2 rounded-full opacity-90 sm:flex"
                aria-label={t('placePhoto.gallery.prev')}
                disabled={index === 0}
                onClick={() => goTo(index - 1)}
              >
                <ChevronLeft />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="secondary"
                className="absolute top-1/2 right-2 hidden -translate-y-1/2 rounded-full opacity-90 sm:flex"
                aria-label={t('placePhoto.gallery.next')}
                disabled={index >= slides.length - 1}
                onClick={() => goTo(index + 1)}
              >
                <ChevronRight />
              </Button>
            </>
          )}
        </div>
        <div className="flex items-center justify-between gap-3 pt-3">
          <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
            {slides.length > 0 && (
              <span className="tabular">
                {index + 1} / {slides.length}
                {!done && '+'}
              </span>
            )}
            {loading && slides.length > 0 && <Loader2 className="size-4 animate-spin" />}
          </span>
          {canEdit && current && !current.current && (
            <Button type="button" disabled={download.isPending} onClick={() => use(current)}>
              {download.isPending ? <Loader2 className="animate-spin" /> : <Check />}
              {t('placePhoto.gallery.use')}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

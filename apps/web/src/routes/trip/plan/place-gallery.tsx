import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { Place } from '@tripshare/shared/trip-format';
import { Button } from '@/components/ui/button';
import { ImageViewer } from '@/components/image-viewer';
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
  const page = useRef(0);
  const busy = useRef(false);

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
    <ImageViewer
      slides={slides.map((s) => ({
        key: s.full,
        src: s.full,
        fallback: s.thumb,
        alt: s.title || place.name,
      }))}
      index={index}
      onIndex={setIndex}
      onClose={onClose}
      title={place.name}
      subtitle={current?.credit || undefined}
      loadingMore={loading}
      hasMore={!done}
      footer={
        <div className="flex flex-wrap items-center gap-3">
          {current && !current.current && (
            <span className="rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-medium">
              {t('placePhoto.gallery.auto')}
            </span>
          )}
          {slides.length === 0 && !loading && (
            <span className="text-white/80">{t('placePhoto.gallery.none')}</span>
          )}
          <span className="flex-1" />
          {canEdit && current && !current.current && (
            <Button type="button" disabled={download.isPending} onClick={() => use(current)}>
              {download.isPending ? <Loader2 className="animate-spin" /> : <Check />}
              {t('placePhoto.gallery.use')}
            </Button>
          )}
        </div>
      }
    />
  );
}

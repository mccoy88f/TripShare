import { useMutation, useQuery } from '@tanstack/react-query';
import { ImagePlus, Loader2, Search, Trash2, Upload } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useTRPC } from '@/lib/trpc';
import { uploadImage } from '@/lib/upload';

export interface PlacePhoto {
  photo?: string;
  photoCredit?: string;
}

/** Foto del luogo: anteprima, caricamento dal dispositivo, ricerca online e rimozione. */
export function PlacePhotoField({
  tripId,
  value,
  searchQuery,
  onChange,
}: {
  tripId: string;
  value: PlacePhoto;
  searchQuery: string;
  onChange: (next: PlacePhoto) => void;
}) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [searching, setSearching] = useState(false);

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const url = await uploadImage(`/api/trips/${tripId}/place-photo`, file);
      onChange({ photo: url });
    } catch (err) {
      toast.error(
        t(`placePhoto.errors.${err instanceof Error ? err.message : ''}`, {
          defaultValue: t('placePhoto.error'),
        }),
      );
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-2">
      {value.photo ? (
        <div className="relative overflow-hidden rounded-xl border">
          <img src={value.photo} alt="" className="aspect-[3/2] w-full object-cover" />
          {value.photoCredit && (
            <span className="absolute right-2 bottom-2 rounded-full bg-black/55 px-2 py-0.5 text-[11px] text-white">
              {value.photoCredit}
            </span>
          )}
        </div>
      ) : (
        <div className="grid aspect-[3/1] place-items-center rounded-xl border border-dashed text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-2">
            <ImagePlus className="size-4" />
            {t('placePhoto.none')}
          </span>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={uploading}
          onClick={() => input.current?.click()}
        >
          {uploading ? <Loader2 className="animate-spin" /> : <Upload />}
          {t('placePhoto.upload')}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => setSearching(true)}>
          <Search />
          {t('placePhoto.search')}
        </Button>
        {value.photo && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="text-destructive"
            onClick={() => onChange({})}
          >
            <Trash2 />
            {t('placePhoto.remove')}
          </Button>
        )}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void upload(file);
        }}
      />
      {searching && (
        <PhotoSearchDialog
          tripId={tripId}
          initialQuery={searchQuery}
          onClose={() => setSearching(false)}
          onPick={(photo) => {
            onChange(photo);
            setSearching(false);
          }}
        />
      )}
    </div>
  );
}

function PhotoSearchDialog({
  tripId,
  initialQuery,
  onClose,
  onPick,
}: {
  tripId: string;
  initialQuery: string;
  onClose: () => void;
  onPick: (photo: PlacePhoto) => void;
}) {
  const { t } = useTranslation();
  const trpc = useTRPC();
  const [draft, setDraft] = useState(initialQuery);
  const [query, setQuery] = useState(initialQuery.trim());
  const search = useQuery({
    ...trpc.plan.placePhotoSearch.queryOptions({ tripId, query }),
    enabled: query.length >= 2,
    staleTime: 600_000,
    retry: false,
  });
  const download = useMutation(trpc.plan.placePhotoFromUrl.mutationOptions());
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setQuery(draft.trim());
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={t('placePhoto.searchTitle')}
        description={t('placePhoto.rights')}
        className="sm:max-w-2xl"
      >
        <form onSubmit={submit} className="flex gap-2 pt-2">
          <Input
            autoFocus
            value={draft}
            placeholder={t('placePhoto.placeholder')}
            onChange={(e) => setDraft(e.target.value)}
            aria-label={t('placePhoto.placeholder')}
          />
          <Button
            type="submit"
            size="icon"
            className="shrink-0"
            aria-label={t('placePhoto.search')}
          >
            <Search />
          </Button>
        </form>
        <div className="mt-4 min-h-40">
          {(search.isFetching || download.isPending) && (
            <Loader2 className="mx-auto mt-10 animate-spin text-muted-foreground" />
          )}
          {search.isError && (
            <p className="text-sm text-destructive">
              {t(`placePhoto.errors.${search.error.message}`, {
                defaultValue: t('placePhoto.searchError'),
              })}
            </p>
          )}
          {download.isError && (
            <p className="mb-2 text-sm text-destructive">
              {t(`placePhoto.errors.${download.error.message}`, {
                defaultValue: t('placePhoto.error'),
              })}
            </p>
          )}
          {search.data && !search.isFetching && search.data.length === 0 && (
            <p className="text-center text-sm text-muted-foreground">{t('placePhoto.noResults')}</p>
          )}
          {search.data && !search.isFetching && !download.isPending && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {search.data.map((p) => (
                <button
                  key={p.full}
                  type="button"
                  onClick={async () => {
                    const saved = await download
                      .mutateAsync({ tripId, url: p.full })
                      .catch(() => null);
                    if (saved)
                      onPick({
                        photo: saved.url,
                        photoCredit: p.credit ?? (p.source || undefined),
                      });
                  }}
                  className="group relative aspect-[4/3] overflow-hidden rounded-lg bg-muted text-left"
                  title={p.title}
                >
                  <img
                    src={p.thumb}
                    alt={p.title}
                    loading="lazy"
                    className="size-full object-cover transition group-hover:scale-105"
                  />
                  {(p.credit ?? p.source) && (
                    <span className="absolute inset-x-0 bottom-0 truncate bg-black/55 px-2 py-1 text-[11px] text-white">
                      {p.credit ?? p.source}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

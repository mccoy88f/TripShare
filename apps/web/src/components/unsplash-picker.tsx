import { useQuery } from '@tanstack/react-query';
import { Loader2, Search } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useTRPC } from '@/lib/trpc';

export interface UnsplashPick {
  id: string;
  thumb: string;
  author: string;
  authorUrl: string;
}

export function useUnsplashEnabled() {
  const trpc = useTRPC();
  const { data } = useQuery({ ...trpc.public.config.queryOptions(), staleTime: 300_000 });
  return !!data?.unsplash;
}

/** Ricerca di una foto di copertina su Unsplash. */
export function UnsplashPicker({
  open,
  initialQuery,
  onOpenChange,
  onPick,
}: {
  open: boolean;
  initialQuery: string;
  onOpenChange: (open: boolean) => void;
  onPick: (photo: UnsplashPick) => void;
}) {
  const { t } = useTranslation();
  const trpc = useTRPC();
  const [draft, setDraft] = useState(initialQuery);
  const [query, setQuery] = useState(initialQuery.trim());
  const search = useQuery({
    ...trpc.trips.coverSearch.queryOptions({ query }),
    enabled: open && query.length >= 2,
    staleTime: 600_000,
    retry: false,
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setQuery(draft.trim());
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={t('unsplash.title')} className="sm:max-w-2xl">
        <form onSubmit={submit} className="flex gap-2 pt-2">
          <Input
            autoFocus
            value={draft}
            placeholder={t('unsplash.placeholder')}
            onChange={(e) => setDraft(e.target.value)}
            aria-label={t('unsplash.placeholder')}
          />
          <Button type="submit" size="icon" className="shrink-0" aria-label={t('unsplash.search')}>
            <Search />
          </Button>
        </form>
        <div className="mt-4 min-h-40">
          {search.isFetching && (
            <Loader2 className="mx-auto mt-10 animate-spin text-muted-foreground" />
          )}
          {search.isError && (
            <p className="text-sm text-destructive">
              {t('unsplash.error')} ({search.error.message})
            </p>
          )}
          {search.data && search.data.length === 0 && (
            <p className="text-center text-sm text-muted-foreground">{t('unsplash.none')}</p>
          )}
          {search.data && !search.isFetching && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {search.data.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    onPick({ id: p.id, thumb: p.thumb, author: p.author, authorUrl: p.authorUrl });
                    onOpenChange(false);
                  }}
                  className="group relative aspect-[4/3] overflow-hidden rounded-lg text-left"
                  style={{ background: p.color ?? undefined }}
                >
                  <img
                    src={p.thumb}
                    alt={p.description ?? ''}
                    loading="lazy"
                    className="size-full object-cover transition group-hover:scale-105"
                  />
                  <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/70 to-transparent px-2 pt-4 pb-1 text-[11px] text-white">
                    {p.author}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          {t('unsplash.credit')}{' '}
          <a
            href="https://unsplash.com/?utm_source=TripShare&utm_medium=referral"
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            Unsplash
          </a>
        </p>
      </DialogContent>
    </Dialog>
  );
}

/** Citazione dell'autore della foto (obbligatoria per Unsplash). */
export function CoverCredit({ credit }: { credit: unknown }) {
  const { t } = useTranslation();
  const c = credit as { name?: string; url?: string } | null;
  if (!c?.name || !c.url) return null;
  return (
    <span className="text-[11px] text-white/80">
      {t('unsplash.photoBy')}{' '}
      <a href={c.url} target="_blank" rel="noreferrer" className="underline">
        {c.name}
      </a>{' '}
      ·{' '}
      <a
        href="https://unsplash.com/?utm_source=TripShare&utm_medium=referral"
        target="_blank"
        rel="noreferrer"
        className="underline"
      >
        Unsplash
      </a>
    </span>
  );
}

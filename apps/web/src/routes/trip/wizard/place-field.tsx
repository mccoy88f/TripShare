import { useQueryClient } from '@tanstack/react-query';
import { Loader2, MapPin, Search, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/input';
import { useTRPC } from '@/lib/trpc';
import type { GeoPlace } from '@tripshare/shared/trip-format';

interface Hit extends GeoPlace {
  detail: string;
}

/**
 * Campo per scegliere un luogo cercandolo su OpenStreetMap: si scrive, si preme Invio (o la
 * lente) e si tocca il risultato giusto. Il luogo scelto resta come etichetta con le coordinate.
 */
export function PlaceField({
  id,
  label,
  hint,
  placeholder,
  value,
  onChange,
  clearOnPick = false,
}: {
  id: string;
  label: string;
  hint?: string;
  placeholder?: string;
  value: GeoPlace | null;
  onChange: (place: GeoPlace | null) => void;
  /** Per i campi che aggiungono elementi a un elenco: dopo la scelta si svuota. */
  clearOnPick?: boolean;
}) {
  const { t } = useTranslation();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const search = async () => {
    const q = query.trim();
    if (q.length < 2 || loading) return;
    setLoading(true);
    setFailed(false);
    try {
      const res = await queryClient.fetchQuery(trpc.geo.search.queryOptions({ query: q }));
      setHits(res.map((h) => ({ label: h.label, lat: h.lat, lon: h.lon, detail: h.detail })));
    } catch {
      setHits(null);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  };

  const pick = (h: Hit) => {
    onChange({ label: h.label, lat: h.lat, lon: h.lon });
    setHits(null);
    setQuery('');
  };

  if (value && !clearOnPick)
    return (
      <Field label={label} htmlFor={id}>
        <div className="flex items-center gap-2 rounded-xl border bg-card px-3 py-2.5">
          <MapPin className="size-4 shrink-0 text-primary" />
          <span className="min-w-0 flex-1 truncate font-medium">{value.label}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={() => onChange(null)}
            aria-label={t('wizard.change')}
            title={t('wizard.change')}
          >
            <X />
          </Button>
        </div>
      </Field>
    );

  return (
    <Field label={label} htmlFor={id} hint={hint}>
      <div className="flex gap-2">
        <input
          id={id}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void search();
            }
          }}
          placeholder={placeholder}
          enterKeyHint="search"
          autoComplete="off"
          className="flex h-11 min-w-0 flex-1 rounded-xl border bg-background px-3 text-base"
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-11"
          onClick={() => void search()}
          disabled={query.trim().length < 2}
          aria-label={t('common.search')}
        >
          {loading ? <Loader2 className="animate-spin" /> : <Search />}
        </Button>
      </div>
      {failed && <p className="text-sm text-destructive">{t('wizard.searchFailed')}</p>}
      {hits && (
        <div className="grid grid-cols-1 overflow-hidden rounded-xl border">
          {hits.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">{t('wizard.noResults')}</p>
          ) : (
            hits.map((h) => (
              <button
                key={`${h.lat},${h.lon}`}
                type="button"
                onClick={() => pick(h)}
                className="border-b px-3 py-2 text-left last:border-b-0 hover:bg-muted"
              >
                <span className="block text-sm font-medium">{h.label}</span>
                <span className="block truncate text-xs text-muted-foreground">{h.detail}</span>
              </button>
            ))
          )}
        </div>
      )}
    </Field>
  );
}

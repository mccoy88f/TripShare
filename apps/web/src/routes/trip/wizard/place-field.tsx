import { useQueryClient } from '@tanstack/react-query';
import { Loader2, MapPin, Search, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/input';
import { useTRPC } from '@/lib/trpc';
import type { GeoPlace } from '@tripshare/shared/trip-format';

interface Hit extends GeoPlace {
  detail: string;
}

/** Dopo questa pausa nella scrittura la ricerca parte da sola. */
const AUTO_SEARCH_MS = 700;

/**
 * Campo per scegliere un luogo cercandolo su OpenStreetMap: si scrive e, dopo una breve pausa (o
 * subito con Invio o la lente), compaiono i risultati da toccare. Il luogo scelto resta come
 * etichetta con le coordinate.
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

  // Conta le ricerche: conta solo l'ultima, le risposte in ritardo di quelle vecchie si scartano.
  const seq = useRef(0);

  const search = async (text = query) => {
    const q = text.trim();
    if (q.length < 2) return;
    const mine = ++seq.current;
    setLoading(true);
    setFailed(false);
    try {
      const res = await queryClient.fetchQuery(trpc.geo.search.queryOptions({ query: q }));
      if (mine !== seq.current) return;
      setHits(res.map((h) => ({ label: h.label, lat: h.lat, lon: h.lon, detail: h.detail })));
    } catch {
      if (mine !== seq.current) return;
      setHits(null);
      setFailed(true);
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  };

  const lastSearched = useRef('');
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      // Testo cancellato: i risultati di prima non valgono più.
      seq.current++;
      lastSearched.current = '';
      setHits(null);
      setLoading(false);
      return;
    }
    if (q === lastSearched.current) return;
    const timer = setTimeout(() => {
      lastSearched.current = q;
      void search(q);
    }, AUTO_SEARCH_MS);
    return () => clearTimeout(timer);
    // `search` usa solo valori stabili o letti al momento della chiamata
  }, [query]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (h: Hit) => {
    onChange({ label: h.label, lat: h.lat, lon: h.lon });
    seq.current++;
    setHits(null);
    setQuery('');
    setLoading(false);
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
              lastSearched.current = query.trim();
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
          onClick={() => {
            lastSearched.current = query.trim();
            void search();
          }}
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

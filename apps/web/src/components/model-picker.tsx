import { Check, ChevronDown, Image as ImageIcon, Search, Sparkles } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

export interface ModelOption {
  id: string;
  name: string;
  contextLength: number | null;
  free: boolean;
  imageInput: boolean;
  promptPerM: number | null;
  completionPerM: number | null;
  structuredOutput: boolean;
  tools: boolean;
}

type PriceFilter = 'all' | 'free' | 'paid';

const AUTO_ID = 'openrouter/auto';

function price(value: number | null) {
  if (value === null) return '?';
  if (value === 0) return '0';
  return value < 0.1 ? value.toFixed(3) : value < 10 ? value.toFixed(2) : value.toFixed(0);
}

function context(n: number | null) {
  if (!n) return null;
  return n >= 1_000_000 ? `${Math.round(n / 100_000) / 10}M` : `${Math.round(n / 1000)}k`;
}

export function ModelInfo({ model }: { model: ModelOption }) {
  const { t } = useTranslation();
  return (
    <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
      {model.free ? (
        <Badge variant="success">{t('models.free')}</Badge>
      ) : model.promptPerM === null && model.completionPerM === null ? (
        <Badge variant="outline">{t('models.paid')}</Badge>
      ) : (
        <span className="tabular">
          {t('models.price', {
            input: price(model.promptPerM),
            output: price(model.completionPerM),
          })}
        </span>
      )}
      {model.imageInput && (
        <span className="inline-flex items-center gap-1" title={t('models.imageInput')}>
          <ImageIcon className="size-3.5" />
          {t('models.images')}
        </span>
      )}
      {model.structuredOutput && <span title={t('models.structuredHint')}>JSON</span>}
      {context(model.contextLength) && (
        <span>{t('models.context', { size: context(model.contextLength) })}</span>
      )}
    </span>
  );
}

/**
 * Menu a tendina per scegliere un modello OpenRouter: ricerca, filtro gratis / a pagamento e,
 * quando serve, solo i modelli che accettano immagini in input.
 */
export function ModelPicker({
  models,
  value,
  onChange,
  requireImage = false,
  allowAuto = true,
  id,
  placeholder,
}: {
  models: ModelOption[];
  value: string | null;
  onChange: (id: string) => void;
  requireImage?: boolean;
  /** Mostra la voce "openrouter/auto" (solo per OpenRouter). */
  allowAuto?: boolean;
  id?: string;
  placeholder?: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [priceFilter, setPriceFilter] = useState<PriceFilter>('all');
  const [imagesOnly, setImagesOnly] = useState(false);
  const selected = models.find((m) => m.id === value);
  const onlyImages = requireImage || imagesOnly;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return models.filter(
      (m) =>
        m.id !== AUTO_ID &&
        (!onlyImages || m.imageInput) &&
        (priceFilter === 'all' || (priceFilter === 'free' ? m.free : !m.free)) &&
        (!q || m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q)),
    );
  }, [models, query, priceFilter, onlyImages]);
  const free = filtered.filter((m) => m.free);
  const paid = filtered.filter((m) => !m.free);

  const pick = (modelId: string) => {
    onChange(modelId);
    setOpen(false);
    setQuery('');
  };

  const Row = ({ m }: { m: ModelOption }) => (
    <button
      type="button"
      onClick={() => pick(m.id)}
      className={cn(
        'flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left hover:bg-muted',
        m.id === value && 'bg-primary/10',
      )}
    >
      <Check className={cn('mt-0.5 size-4 shrink-0 text-primary', m.id !== value && 'invisible')} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{m.name}</span>
        <span className="block truncate font-mono text-[11px] text-muted-foreground">{m.id}</span>
        <ModelInfo model={m} />
      </span>
    </button>
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          className="flex min-h-11 w-full items-center gap-2 rounded-md border border-input bg-card px-3.5 py-2 text-left outline-none focus-visible:border-ring focus-visible:ring-4 focus-visible:ring-ring/20"
        >
          <span className="min-w-0 flex-1">
            {value === AUTO_ID ? (
              <span className="inline-flex items-center gap-1.5 text-sm font-medium">
                <Sparkles className="size-4 text-accent" />
                {t('models.auto')}
              </span>
            ) : selected ? (
              <>
                <span className="block truncate text-sm font-medium">{selected.name}</span>
                <ModelInfo model={selected} />
              </>
            ) : value ? (
              <span className="block truncate font-mono text-sm">{value}</span>
            ) : (
              <span className="text-sm text-muted-foreground">
                {placeholder ?? t('models.choose')}
              </span>
            )}
          </span>
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(92vw,30rem)] p-0">
        <div className="grid grid-cols-1 gap-2 border-b p-3">
          <div className="flex items-center gap-2 rounded-md bg-muted px-3">
            <Search className="size-4 text-muted-foreground" />
            <input
              autoFocus
              className="h-9 flex-1 bg-transparent text-sm outline-none"
              placeholder={t('models.search')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-full bg-muted p-1">
              {(['all', 'free', 'paid'] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setPriceFilter(f)}
                  className={cn(
                    'rounded-full px-3 py-1 text-xs font-semibold',
                    priceFilter === f ? 'bg-card shadow-sm' : 'text-muted-foreground',
                  )}
                >
                  {t(`models.filters.${f}`)}
                </button>
              ))}
            </div>
            <label
              className={cn(
                'inline-flex items-center gap-1.5 text-xs font-medium',
                requireImage && 'text-muted-foreground',
              )}
            >
              <input
                type="checkbox"
                className="accent-[var(--primary)]"
                checked={onlyImages}
                disabled={requireImage}
                onChange={(e) => setImagesOnly(e.target.checked)}
              />
              <ImageIcon className="size-3.5" />
              {requireImage ? t('models.imagesRequired') : t('models.imagesOnly')}
            </label>
          </div>
        </div>
        <div className="max-h-[50vh] overflow-y-auto p-1.5">
          {allowAuto && (
            <button
              type="button"
              onClick={() => pick(AUTO_ID)}
              className={cn(
                'flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left hover:bg-muted',
                value === AUTO_ID && 'bg-primary/10',
              )}
            >
              <Check
                className={cn(
                  'mt-0.5 size-4 shrink-0 text-primary',
                  value !== AUTO_ID && 'invisible',
                )}
              />
              <span>
                <span className="inline-flex items-center gap-1.5 text-sm font-medium">
                  <Sparkles className="size-4 text-accent" />
                  {t('models.auto')}
                </span>
                <span className="block text-xs text-muted-foreground">{t('models.autoHint')}</span>
              </span>
            </button>
          )}
          {free.length > 0 && (
            <p className="px-2.5 pt-3 pb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              {t('models.groupFree', { count: free.length })}
            </p>
          )}
          {free.map((m) => (
            <Row key={m.id} m={m} />
          ))}
          {paid.length > 0 && (
            <p className="px-2.5 pt-3 pb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              {t('models.groupPaid', { count: paid.length })}
            </p>
          )}
          {paid.map((m) => (
            <Row key={m.id} m={m} />
          ))}
          {filtered.length === 0 && (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              {t('models.none')}
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

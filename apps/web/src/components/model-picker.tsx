import { Check, ChevronDown, Image as ImageIcon, Search, Sparkles } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

interface ModelOption {
  id: string;
  name: string;
  contextLength: number | null;
  free: boolean;
  priceUnknown?: boolean;
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
      {model.priceUnknown ? null : model.free ? (
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
  compact = false,
}: {
  models: ModelOption[];
  value: string | null;
  onChange: (id: string) => void;
  requireImage?: boolean;
  /** Mostra la voce "openrouter/auto" (solo per OpenRouter). */
  allowAuto?: boolean;
  id?: string;
  placeholder?: string;
  /** Una sola riga bassa (per le tabelle): i dettagli restano nell'elenco. */
  compact?: boolean;
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
  const unknown = filtered.filter((m) => m.priceUnknown);
  const free = filtered.filter((m) => m.free && !m.priceUnknown);
  const paid = filtered.filter((m) => !m.free && !m.priceUnknown);

  const pick = (modelId: string) => {
    onChange(modelId);
    setOpen(false);
    setQuery('');
  };

  /** Una riga bassa: nome a sinistra, in piccolo a destra gratis/prezzo, immagini e contesto. */
  const Row = ({ m }: { m: ModelOption }) => (
    <button
      type="button"
      onClick={() => pick(m.id)}
      title={m.id}
      className={cn(
        'flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left hover:bg-muted',
        m.id === value && 'bg-primary/10',
      )}
    >
      <Check className={cn('size-3.5 shrink-0 text-primary', m.id !== value && 'invisible')} />
      <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{m.name}</span>
      <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground">
        {m.priceUnknown ? null : m.free ? (
          <span className="rounded bg-success/15 px-1 font-semibold text-success">
            {t('models.free')}
          </span>
        ) : m.promptPerM !== null || m.completionPerM !== null ? (
          <span className="tabular">
            {price(m.promptPerM)}/{price(m.completionPerM)}
          </span>
        ) : null}
        {m.imageInput && <ImageIcon className="size-3" aria-label={t('models.imageInput')} />}
        {context(m.contextLength) && <span className="tabular">{context(m.contextLength)}</span>}
      </span>
    </button>
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          title={compact ? (selected?.id ?? value ?? undefined) : undefined}
          className={cn(
            'flex w-full items-center gap-2 rounded-md border border-input bg-card text-left outline-none focus-visible:border-ring focus-visible:ring-4 focus-visible:ring-ring/20',
            compact ? 'h-8 px-2.5' : 'min-h-11 px-3.5 py-2',
          )}
        >
          <span className="min-w-0 flex-1">
            {compact && selected && value !== AUTO_ID ? (
              <span className="block truncate text-xs font-medium">{selected.name}</span>
            ) : value === AUTO_ID ? (
              <span className="inline-flex items-center gap-1.5 text-sm font-medium">
                <Sparkles className="size-4 text-accent" />
                {compact ? <span className="text-xs">{t('models.auto')}</span> : t('models.auto')}
              </span>
            ) : selected ? (
              <>
                <span className="block truncate text-sm font-medium">{selected.name}</span>
                <ModelInfo model={selected} />
              </>
            ) : value ? (
              <span className={cn('block truncate font-mono', compact ? 'text-xs' : 'text-sm')}>
                {value}
              </span>
            ) : (
              <span className="text-sm text-muted-foreground">
                {placeholder ?? t('models.choose')}
              </span>
            )}
          </span>
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(92vw,26rem)] p-0">
        <div className="grid grid-cols-1 gap-1.5 border-b p-2">
          <div className="flex items-center gap-2 rounded-md bg-muted px-2.5">
            <Search className="size-4 text-muted-foreground" />
            <input
              autoFocus
              className="h-8 flex-1 bg-transparent text-sm outline-none"
              placeholder={t('models.search')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-full bg-muted p-0.5">
              {(['all', 'free', 'paid'] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setPriceFilter(f)}
                  className={cn(
                    'rounded-full px-2.5 py-0.5 text-xs font-semibold',
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
        <div className="max-h-[50vh] overflow-y-auto p-1">
          {allowAuto && (
            <button
              type="button"
              onClick={() => pick(AUTO_ID)}
              title={t('models.autoHint')}
              className={cn(
                'flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left hover:bg-muted',
                value === AUTO_ID && 'bg-primary/10',
              )}
            >
              <Check
                className={cn('size-3.5 shrink-0 text-primary', value !== AUTO_ID && 'invisible')}
              />
              <Sparkles className="size-3.5 text-accent" />
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                {t('models.auto')}
              </span>
            </button>
          )}
          {free.length > 0 && (
            <p className="px-2 pt-2 pb-0.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
              {t('models.groupFree', { count: free.length })}
            </p>
          )}
          {free.map((m) => (
            <Row key={m.id} m={m} />
          ))}
          {paid.length > 0 && (
            <p className="px-2 pt-2 pb-0.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
              {t('models.groupPaid', { count: paid.length })}
            </p>
          )}
          {paid.map((m) => (
            <Row key={m.id} m={m} />
          ))}
          {unknown.length > 0 && (
            <p className="px-2 pt-2 pb-0.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
              {t('models.groupUnknown', { count: unknown.length })}
            </p>
          )}
          {unknown.map((m) => (
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

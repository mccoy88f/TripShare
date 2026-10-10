import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Check,
  Circle,
  Loader2,
  RotateCcw,
  SkipForward,
  Sparkles,
  X,
} from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useTRPC } from '@/lib/trpc';
import { cn } from '@/lib/utils';

type StepKey = 'strategy' | 'places' | 'days' | 'bookings' | 'budget' | 'packing' | 'photos';
/** Dopo questo tempo senza avanzamenti la fase si considera bloccata (come nel server). */
const STUCK_MS = 4 * 60_000;
const COUNT_KEY: Partial<Record<StepKey, string>> = {
  places: 'places',
  days: 'days',
  bookings: 'bookings',
  budget: 'items',
  packing: 'items',
  photos: 'photos',
};

/**
 * Avanzamento della creazione del viaggio con l'AI, fase per fase: cosa è stato fatto, cosa è in
 * corso e, a lavoro finito, cosa conviene controllare. Se una fase si ferma si riprova da quella.
 */
export function GenerationPanel({ tripId, canEdit }: { tripId: string; canEdit: boolean }) {
  const { t } = useTranslation();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { data: gen } = useQuery({
    ...trpc.ai.generation.state.queryOptions({ tripId }),
    refetchInterval: (q) => (q.state.data?.status === 'running' ? 2000 : false),
  });
  const start = useMutation(trpc.ai.start.mutationOptions());
  const dismiss = useMutation(trpc.ai.generation.dismiss.mutationOptions());

  // Quando una fase finisce il programma è cambiato: schede e liste si aggiornano.
  const progress = gen?.steps.map((s) => s.status).join(',') ?? '';
  const seen = useRef(progress);
  useEffect(() => {
    if (progress === seen.current) return;
    seen.current = progress;
    void queryClient.invalidateQueries({
      predicate: (q) => JSON.stringify(q.queryKey).includes(tripId),
    });
    void queryClient.invalidateQueries({ queryKey: trpc.trips.list.queryKey() });
  }, [progress, queryClient, tripId, trpc]);

  if (!gen || gen.dismissed) return null;
  const done = gen.steps.filter((s) => s.status === 'done' || s.status === 'skipped').length;
  const failed = gen.steps.find((s) => s.status === 'failed');
  // Una fase in corso che non salva più da qualche minuto è rimasta bloccata.
  const stuck =
    gen.status === 'running' && !!gen.updatedAt && Date.now() - Date.parse(gen.updatedAt) > STUCK_MS
      ? gen.steps.find((s) => s.status === 'running')
      : undefined;
  const stopped = failed ?? stuck;
  const retry = async (from: StepKey, skip = false) => {
    try {
      await start.mutateAsync({ tripId, input: { kind: 'generateTrip', from, skip } });
      await queryClient.invalidateQueries({
        queryKey: trpc.ai.generation.state.queryKey({ tripId }),
      });
    } catch (err) {
      toast.error(
        t(`ai.errors.${err instanceof Error ? err.message : ''}`, {
          defaultValue: t('common.error'),
        }),
      );
    }
  };

  return (
    <Card className="mb-5 overflow-hidden p-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 text-accent">
          {gen.status === 'running' ? (
            <Loader2 className="size-6 animate-spin" />
          ) : failed ? (
            <AlertTriangle className="size-6 text-amber-500" />
          ) : (
            <Sparkles className="size-6" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">
            {t(
              gen.status === 'running'
                ? 'generation.title.running'
                : failed
                  ? 'generation.title.failed'
                  : 'generation.title.done',
            )}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t(
              gen.status === 'running'
                ? 'generation.text.running'
                : failed
                  ? 'generation.text.failed'
                  : 'generation.text.done',
            )}
          </p>
        </div>
        {gen.status !== 'running' && canEdit && (
          <Button
            variant="ghost"
            size="icon"
            className="size-8 shrink-0"
            aria-label={t('common.close')}
            onClick={() => dismiss.mutate({ tripId }, { onSuccess: () => void refreshState() })}
          >
            <X />
          </Button>
        )}
      </div>

      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-500"
          style={{ width: `${Math.round((done / gen.steps.length) * 100)}%` }}
        />
      </div>

      <ol className="mt-3 grid grid-cols-1 gap-1.5">
        {gen.steps.map((s) => (
          <li key={s.key} className="flex items-center gap-2.5 text-sm">
            <span
              className={cn(
                'grid size-5 shrink-0 place-items-center rounded-full',
                s.status === 'done' && 'bg-primary text-primary-foreground',
                s.status === 'running' && 'text-primary',
                s.status === 'failed' && 'bg-amber-500 text-white',
                (s.status === 'pending' || s.status === 'skipped') && 'text-muted-foreground/50',
              )}
            >
              {s.status === 'done' ? (
                <Check className="size-3.5" />
              ) : s.status === 'running' ? (
                <Loader2 className="size-4 animate-spin" />
              ) : s.status === 'failed' ? (
                <X className="size-3.5" />
              ) : s.status === 'skipped' ? (
                <SkipForward className="size-3.5" />
              ) : (
                <Circle className="size-3.5" />
              )}
            </span>
            <span
              className={cn(
                'min-w-0 flex-1',
                s.status === 'pending' && 'text-muted-foreground',
                s.status === 'running' && 'font-medium',
              )}
            >
              {t(`generation.steps.${s.key}`)}
              {s.status === 'running' && s.detail && (
                <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                  {t(`generation.detail.${s.detail.k}`, s.detail.p)}
                </span>
              )}
            </span>
            {s.status === 'done' && s.count !== undefined && COUNT_KEY[s.key] && (
              <span className="text-xs text-muted-foreground">
                {t(`generation.count.${COUNT_KEY[s.key]}`, { count: s.count })}
              </span>
            )}
          </li>
        ))}
      </ol>

      {stopped && canEdit && (gen.status === 'failed' || stuck) && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-amber-500/10 p-3 text-sm">
          <span className="min-w-0 flex-1">
            {failed
              ? t(`ai.errors.${failed.error ?? ''}`, { defaultValue: t('generation.failedStep') })
              : t('generation.stuck')}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={start.isPending}
            onClick={() => void retry(stopped.key, true)}
          >
            <SkipForward />
            {t('generation.skip')}
          </Button>
          <Button size="sm" disabled={start.isPending} onClick={() => void retry(stopped.key)}>
            {start.isPending ? <Loader2 className="animate-spin" /> : <RotateCcw />}
            {t('generation.retry')}
          </Button>
        </div>
      )}

      {gen.status === 'done' && gen.warnings.length > 0 && (
        <div className="mt-3 rounded-lg bg-muted/60 p-3 text-sm">
          <p className="font-medium">{t('generation.review')}</p>
          <ul className="mt-1.5 grid list-disc gap-1 pl-5 text-muted-foreground">
            {gen.warnings.map((w, i) => (
              <li key={i}>{t(`generation.warnings.${w.k}`, w.p)}</li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );

  function refreshState() {
    return queryClient.invalidateQueries({
      queryKey: trpc.ai.generation.state.queryKey({ tripId }),
    });
  }
}

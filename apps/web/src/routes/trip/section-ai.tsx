import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useAiStatus } from '@/lib/ai';
import { useTRPC } from '@/lib/trpc';
import type { TripDetail } from '@/lib/types';

type StepKey = 'strategy' | 'places' | 'days' | 'bookings' | 'budget' | 'packing' | 'photos';

/**
 * "✨ Proponi con l'AI" per una sezione vuota: l'AI prepara solo quella parte (dopo aver deciso,
 * se serve, la strategia del viaggio) senza cambiare titolo né il resto. L'avanzamento si vede
 * in cima alla pagina del viaggio. Serve un viaggio con le date e chi lo ha creato.
 */
export function SectionAiButton({
  trip,
  from,
  until,
  label,
}: {
  trip: TripDetail;
  from: StepKey;
  until: StepKey;
  label: string;
}) {
  const { t } = useTranslation();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const ai = useAiStatus();
  const start = useMutation(trpc.ai.start.mutationOptions());
  const { data: gen } = useQuery(trpc.ai.generation.state.queryOptions({ tripId: trip.id }));
  if (!ai.data?.available || trip.role !== 'owner') return null;
  const running = gen?.status === 'running';
  const missingDates = !trip.startDate || !trip.endDate;
  return (
    <div className="grid justify-items-center gap-1.5">
      <Button
        variant="outline"
        disabled={running || start.isPending || missingDates}
        onClick={async () => {
          try {
            await start.mutateAsync({
              tripId: trip.id,
              input: { kind: 'generateTrip', from, until, keep: true },
            });
            await queryClient.invalidateQueries({
              queryKey: trpc.ai.generation.state.queryKey({ tripId: trip.id }),
            });
            window.scrollTo({ top: 0, behavior: 'smooth' });
          } catch (err) {
            toast.error(
              t(`ai.errors.${err instanceof Error ? err.message : ''}`, {
                defaultValue: t('common.error'),
              }),
            );
          }
        }}
      >
        {start.isPending || running ? (
          <Loader2 className="animate-spin" />
        ) : (
          <Sparkles className="text-accent" />
        )}
        {label}
      </Button>
      {missingDates && <p className="text-xs text-muted-foreground">{t('section.needDates')}</p>}
    </div>
  );
}

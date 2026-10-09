import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Download, Loader2, Upload } from 'lucide-react';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { usePlan } from '@/lib/plan';
import { useTRPC } from '@/lib/trpc';

/** Importa un viaggio nel formato standard TripShare (JSON) sostituendo il programma. */
export function ImportPlanButton({
  tripId,
  variant = 'outline',
}: {
  tripId: string;
  variant?: 'outline' | 'default';
}) {
  const { t } = useTranslation();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const replace = useMutation(
    trpc.plan.replace.mutationOptions({
      onSuccess: async () => {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: trpc.plan.get.queryKey({ tripId }) }),
          queryClient.invalidateQueries({ queryKey: trpc.trips.get.queryKey({ id: tripId }) }),
          queryClient.invalidateQueries({ queryKey: trpc.trips.list.queryKey() }),
        ]);
        toast.success(t('plan.imported'));
      },
      onError: (err) =>
        toast.error(
          t('plan.errors.invalid', { detail: err.message.replace(/^PLAN_INVALID:/, '') }),
        ),
    }),
  );
  return (
    <>
      <Button
        type="button"
        variant={variant}
        disabled={replace.isPending}
        onClick={() => input.current?.click()}
      >
        {replace.isPending ? <Loader2 className="animate-spin" /> : <Upload />}
        {t('plan.import')}
      </Button>
      <input
        ref={input}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          let json: unknown;
          try {
            json = JSON.parse(await file.text());
          } catch {
            toast.error(t('plan.errors.notJson'));
            return;
          }
          if (!confirm(t('plan.confirmImport'))) return;
          replace.mutate({ tripId, plan: json, updateTrip: true });
        }}
      />
    </>
  );
}

export function ExportPlanButton({ tripId, title }: { tripId: string; title: string }) {
  const { t } = useTranslation();
  const { data } = usePlan(tripId);
  return (
    <Button
      type="button"
      variant="outline"
      disabled={!data}
      onClick={() => {
        if (!data) return;
        const doc = { $schema: 'https://tripshare.app/schema/trip.v1.schema.json', ...data.plan };
        const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${title.replace(/[^\p{L}\p{N}]+/gu, '-').toLowerCase() || 'viaggio'}.trip.json`;
        a.click();
        URL.revokeObjectURL(a.href);
      }}
    >
      <Download />
      {t('plan.export')}
    </Button>
  );
}

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { isCurrencyCode } from '@tripshare/shared';
import { DEFAULT_COVER } from '@/components/trip-cover';
import { toTripInput, TripForm } from '@/components/trip-form';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useTRPC } from '@/lib/trpc';
import type { TripDetail } from '@/lib/types';
import { uploadImage } from '@/lib/upload';
import { ExportPlanButton, ImportPlanButton } from './plan/import-export';

export function SettingsTab({ trip }: { trip: TripDetail }) {
  const { t } = useTranslation();
  const trpc = useTRPC();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [uploading, setUploading] = useState(false);
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: trpc.trips.get.queryKey({ id: trip.id }) }),
      queryClient.invalidateQueries({ queryKey: trpc.trips.list.queryKey() }),
    ]);
  const onError = (err: { message: string }) =>
    toast.error(t(`trip.errors.${err.message}`, { defaultValue: t('common.error') }));
  const update = useMutation(trpc.trips.update.mutationOptions({ onError }));
  const removeCover = useMutation(
    trpc.trips.removeCover.mutationOptions({ onSuccess: refresh, onError }),
  );
  const remove = useMutation(trpc.trips.delete.mutationOptions({ onError }));
  const hasExpenses = trip.ledger.total > 0;

  return (
    <div className="grid grid-cols-1 gap-6 pb-8">
      <TripForm
        key={trip.updatedAt.toString()}
        initial={{
          title: trip.title,
          emoji: trip.emoji,
          destination: trip.destination ?? '',
          description: trip.description ?? '',
          startDate: trip.startDate ?? '',
          endDate: trip.endDate ?? '',
          currency: isCurrencyCode(trip.currency) ? trip.currency : 'EUR',
          coverColor: trip.coverColor ?? DEFAULT_COVER,
        }}
        coverImage={trip.coverImage}
        currencyLocked={hasExpenses}
        submitLabel={t('common.save')}
        pending={update.isPending || uploading}
        onRemoveCover={() => removeCover.mutate({ id: trip.id })}
        onSubmit={async (values, file) => {
          await update.mutateAsync({ id: trip.id, data: toTripInput(values) });
          if (file) {
            setUploading(true);
            await uploadImage(`/api/trips/${trip.id}/cover`, file).catch(() =>
              toast.error(t('trip.form.photoError')),
            );
            setUploading(false);
          }
          await refresh();
          toast.success(t('common.saved'));
        }}
      />
      <Card>
        <CardHeader>
          <CardTitle>{t('plan.importExportTitle')}</CardTitle>
          <CardDescription>{t('plan.importExportText')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <ExportPlanButton tripId={trip.id} title={trip.title} />
          <ImportPlanButton tripId={trip.id} />
        </CardContent>
      </Card>
      <Card className="border-destructive/30">
        <CardHeader>
          <CardTitle className="text-destructive">{t('trip.deleteTitle')}</CardTitle>
          <CardDescription>{t('trip.deleteText')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant="destructive"
            disabled={remove.isPending}
            onClick={async () => {
              const typed = prompt(t('trip.deleteConfirm', { title: trip.title }));
              if (typed?.trim() !== trip.title.trim()) return;
              await remove.mutateAsync({ id: trip.id });
              await queryClient.invalidateQueries({ queryKey: trpc.trips.list.queryKey() });
              await navigate({ to: '/app' });
            }}
          >
            <Trash2 />
            {t('trip.delete')}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

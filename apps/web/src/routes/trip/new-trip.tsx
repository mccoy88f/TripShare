import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { isCurrencyCode } from '@tripshare/shared';
import { useMe } from '@/components/layouts/app-layout';
import { emptyTripForm, toTripInput, TripForm } from '@/components/trip-form';
import { useAiStatus } from '@/lib/ai';
import { useTRPC } from '@/lib/trpc';
import { cn } from '@/lib/utils';
import { GenerateTripForm } from './plan/generate-trip';
import { uploadImage } from '@/lib/upload';

export function NewTripPage() {
  const { t } = useTranslation();
  const trpc = useTRPC();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: me } = useMe();
  const [uploading, setUploading] = useState(false);
  const create = useMutation(trpc.trips.create.mutationOptions());
  const setCover = useMutation(trpc.trips.setUnsplashCover.mutationOptions());

  const replace = useMutation(trpc.plan.replace.mutationOptions());
  const ai = useAiStatus();
  const [mode, setMode] = useState<'manual' | 'ai'>('manual');

  if (!me) return null;
  const currency = isCurrencyCode(me.defaultCurrency) ? me.defaultCurrency : 'EUR';
  return (
    <div>
      <h1 className="mb-6 text-3xl font-bold tracking-tight">{t('trip.new.title')}</h1>
      {ai.data?.available && (
        <div className="mb-6 inline-flex rounded-full bg-muted p-1">
          {(['manual', 'ai'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={cn(
                'rounded-full px-4 py-1.5 text-sm font-medium transition',
                mode === m ? 'bg-card shadow-sm' : 'text-muted-foreground',
              )}
            >
              {m === 'ai' ? `✨ ${t('ai.generate.withAi')}` : t('ai.generate.manual')}
            </button>
          ))}
        </div>
      )}
      {mode === 'ai' ? (
        <div className="max-w-2xl">
          <p className="mb-4 text-sm text-muted-foreground">{t('ai.generate.hint')}</p>
          <GenerateTripForm
            submitLabel={t('ai.generate.create')}
            initial={{
              prompt: '',
              destination: '',
              startDate: '',
              endDate: '',
              travelers: '2',
              departureFrom: '',
              currency,
              budget: '',
              budgetBasis: 'total',
              style: [],
            }}
            onGenerated={async (plan, values) => {
              try {
                const { id } = await create.mutateAsync({
                  title: plan.trip.title.slice(0, 120),
                  emoji: plan.trip.emoji ?? null,
                  currency: values.currency,
                  destination: plan.trip.destination.name.slice(0, 120),
                });
                await replace.mutateAsync({ tripId: id, plan, updateTrip: true });
                await queryClient.invalidateQueries({ queryKey: trpc.trips.list.queryKey() });
                toast.success(t('ai.generate.done'));
                await navigate({ to: '/app/trips/$tripId', params: { tripId: id } });
              } catch {
                toast.error(t('common.error'));
              }
            }}
          />
        </div>
      ) : (
        <TripForm
          initial={emptyTripForm(currency)}
          submitLabel={t('trip.new.submit')}
          pending={create.isPending || uploading}
          onSubmit={async (values, file, unsplash) => {
            try {
              const { id } = await create.mutateAsync(toTripInput(values));
              if (file) {
                setUploading(true);
                await uploadImage(`/api/trips/${id}/cover`, file).catch(() =>
                  toast.error(t('trip.form.photoError')),
                );
                setUploading(false);
              }
              if (unsplash) {
                setUploading(true);
                await setCover
                  .mutateAsync({ id: id, photoId: unsplash.id })
                  .catch(() => toast.error(t('trip.form.photoError')));
                setUploading(false);
              }
              await queryClient.invalidateQueries({ queryKey: trpc.trips.list.queryKey() });
              await navigate({ to: '/app/trips/$tripId', params: { tripId: id } });
            } catch {
              toast.error(t('common.error'));
            }
          }}
        />
      )}
    </div>
  );
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { PlanOp } from '@tripshare/shared/trip-format';
import { useTRPC } from './trpc';

export const PLACE_KIND_EMOJI: Record<string, string> = {
  sight: '🏛️',
  museum: '🖼️',
  nature: '🌲',
  viewpoint: '🔭',
  restaurant: '🍽️',
  cafe: '☕',
  bar: '🍺',
  lodging: '🏨',
  airport: '🛫',
  station: '🚉',
  parking: '🅿️',
  car_rental: '🚗',
  shop: '🛍️',
  neighborhood: '🏘️',
  city: '🏙️',
  other: '📍',
};

export const ACTIVITY_TYPE_EMOJI: Record<string, string> = {
  travel: '🚗',
  flight: '✈️',
  visit: '🏛️',
  meal: '🍽️',
  checkin: '🛎️',
  checkout: '🧳',
  pickup: '🔑',
  dropoff: '🔑',
  activity: '🥾',
  shopping: '🛍️',
  free_time: '☀️',
  other: '📌',
};

export const TRANSPORT_EMOJI: Record<string, string> = {
  car: '🚗',
  walk: '🚶',
  bike: '🚲',
  taxi: '🚕',
  rideshare: '🚙',
  bus: '🚌',
  tram: '🚊',
  metro: '🚇',
  train: '🚆',
  ferry: '⛴️',
  flight: '✈️',
  shuttle: '🚐',
  other: '➡️',
};

export const BOOKING_EMOJI: Record<string, string> = {
  flight: '✈️',
  lodging: '🏨',
  car_rental: '🚗',
  parking: '🅿️',
  train: '🚆',
  bus: '🚌',
  ferry: '⛴️',
  tour: '🧭',
  ticket: '🎟️',
  insurance: '🛡️',
  other: '📄',
};

/** Codici meteo WMO → emoji. */
export function weatherEmoji(code: number) {
  if (code === 0) return '☀️';
  if (code <= 2) return '🌤️';
  if (code === 3) return '☁️';
  if (code <= 48) return '🌫️';
  if (code <= 57) return '🌦️';
  if (code <= 67) return '🌧️';
  if (code <= 77) return '🌨️';
  if (code <= 82) return '🌧️';
  if (code <= 86) return '🌨️';
  return '⛈️';
}

export const mapsUrl = (query: string) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;

export function minutesLabel(min?: number | null) {
  if (!min) return '';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h}h${m ? ` ${String(m).padStart(2, '0')}` : ''}` : `${m} min`;
}

export function usePlan(tripId: string) {
  const trpc = useTRPC();
  return useQuery(trpc.plan.get.queryOptions({ tripId }));
}

/** Applica operazioni al programma, aggiorna la cache e mostra gli errori. */
export function usePlanOps(tripId: string) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const mutation = useMutation(
    trpc.plan.applyOps.mutationOptions({
      onSuccess: (res) => {
        // Foto indicate con un indirizzo che non si è riusciti a scaricare.
        if (res.photoFailures?.length) toast.warning(t('placePhoto.failed'));
        return Promise.all([
          queryClient.invalidateQueries({ queryKey: trpc.plan.get.queryKey({ tripId }) }),
          queryClient.invalidateQueries({ queryKey: trpc.trips.get.queryKey({ id: tripId }) }),
        ]);
      },
      onError: (err) =>
        toast.error(
          err.message.startsWith('PLAN_INVALID')
            ? t('plan.errors.invalid', { detail: err.message.slice(13) })
            : t('common.error'),
        ),
    }),
  );
  return {
    apply: (ops: PlanOp[]) => mutation.mutateAsync({ tripId, ops: ops as never }),
    pending: mutation.isPending,
  };
}

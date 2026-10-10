import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { UserAvatar, type AvatarUser } from '@/components/ui/avatar';
import { describeNotification, notificationTarget } from './notifications';
import { focusItem } from './search-focus';
import { useTRPC } from './trpc';

interface ChangeMessage {
  tripId: string;
  kind: string;
  entityId?: string | null;
  data?: Record<string, unknown>;
  count?: number;
  actorName?: string | null;
  actor?: AvatarUser | null;
  notify: boolean;
}

/**
 * Tiene aperto il flusso di aggiornamenti dell'API: quando un altro membro modifica un viaggio
 * le schermate si aggiornano da sole, il contatore delle notifiche sale e compare un avviso.
 */
export function useRealtime(enabled: boolean) {
  const queryClient = useQueryClient();
  const trpc = useTRPC();
  const navigate = useNavigate();
  const { t } = useTranslation();

  useEffect(() => {
    if (!enabled || typeof EventSource === 'undefined') return;
    const source = new EventSource('/api/events', { withCredentials: true });
    let opened = false;
    source.onopen = () => {
      // Dopo una riconnessione si può aver perso qualcosa: si rileggono i dati.
      if (opened) void queryClient.invalidateQueries();
      opened = true;
    };
    source.addEventListener('change', (e) => {
      let msg: ChangeMessage;
      try {
        msg = JSON.parse((e as MessageEvent<string>).data) as ChangeMessage;
      } catch {
        return;
      }
      // Tutto ciò che riguarda quel viaggio (ricerche con il suo id) si rilegge.
      void queryClient.invalidateQueries({
        predicate: (q) => JSON.stringify(q.queryKey).includes(msg.tripId),
      });
      void queryClient.invalidateQueries({ queryKey: trpc.trips.list.queryKey() });
      if (!msg.notify) return;
      void queryClient.invalidateQueries({ queryKey: trpc.notifications.unread.queryKey() });
      void queryClient.invalidateQueries({ queryKey: ['notifications', 'list'] });
      if (document.visibilityState !== 'visible') return;
      const text = describeNotification(
        { type: msg.kind, count: msg.count ?? 1, data: msg.data ?? {} },
        msg.actorName,
      );
      const target = notificationTarget(msg.kind, msg.entityId ?? null, msg.data ?? {});
      toast(text, {
        duration: 6000,
        icon: msg.actor ? <UserAvatar user={msg.actor} size="sm" /> : undefined,
        action: {
          label: t('notifications.open'),
          onClick: () => {
            void navigate({
              to: '/app/trips/$tripId',
              params: { tripId: msg.tripId },
              search: { tab: target.tab === 'plan' ? undefined : target.tab, view: target.view },
            }).then(() => {
              if (target.key || target.date) focusItem(target.key, target.date);
            });
          },
        },
      });
    });
    return () => source.close();
  }, [enabled, queryClient, trpc, navigate, t]);
}

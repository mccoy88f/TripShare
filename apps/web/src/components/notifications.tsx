import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Bell, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Locale } from '@tripshare/shared';
import { UserAvatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { money, timeAgo } from '@/lib/format';
import { notificationTarget } from '@/lib/notifications';
import { focusItem } from '@/lib/search-focus';
import { trpcClient, useTRPC } from '@/lib/trpc';
import { cn } from '@/lib/utils';

/** Campanella con il numero di notifiche non lette; apre l'elenco delle novità dei viaggi. */
export function NotificationBell({ className }: { className?: string }) {
  const { t } = useTranslation();
  const trpc = useTRPC();
  const [open, setOpen] = useState(false);
  const { data } = useQuery({
    ...trpc.notifications.unread.queryOptions(),
    staleTime: 15_000,
    refetchInterval: 60_000,
  });
  const total = data?.total ?? 0;
  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className={cn('relative', className)}
        onClick={() => setOpen(true)}
        title={t('notifications.title')}
        aria-label={
          total > 0 ? t('notifications.titleUnread', { count: total }) : t('notifications.title')
        }
      >
        <Bell />
        {total > 0 && (
          <span className="absolute top-1 right-1 flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] leading-4 font-bold text-white">
            {total > 99 ? '99+' : total}
          </span>
        )}
      </Button>
      {open && <NotificationsPanel onClose={() => setOpen(false)} />}
    </>
  );
}

function NotificationsPanel({ onClose }: { onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const locale = (i18n.resolvedLanguage ?? 'it') as Locale;
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const listKey = ['notifications', 'list'];
  const list = useInfiniteQuery({
    queryKey: listKey,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      trpcClient.notifications.list.query({ limit: 30, before: pageParam }),
    getNextPageParam: (last) =>
      last.hasMore ? new Date(last.items.at(-1)!.createdAt).toISOString() : undefined,
  });
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: trpc.notifications.unread.queryKey() }),
      queryClient.invalidateQueries({ queryKey: listKey }),
    ]);
  const markRead = useMutation(trpc.notifications.markRead.mutationOptions({ onSuccess: refresh }));
  const markAll = useMutation(
    trpc.notifications.markAllRead.mutationOptions({ onSuccess: refresh }),
  );
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const unread = items.some((i) => !i.read);

  const text = (item: (typeof items)[number]) => {
    const d = item.event.data as Record<string, unknown>;
    const amount =
      typeof d.amount === 'number' && typeof d.currency === 'string'
        ? money(d.amount, d.currency)
        : '';
    return t(`notifications.types.${item.event.type}`, {
      count: item.event.count,
      actor: item.actor?.name ?? t('notifications.someone'),
      title: typeof d.title === 'string' ? d.title : '',
      name: typeof d.name === 'string' ? d.name : '',
      role:
        typeof d.role === 'string' ? t(`members.roles.${d.role}`, { defaultValue: d.role }) : '',
      days: typeof d.days === 'number' ? d.days : 0,
      amount,
      defaultValue: t('notifications.unknown'),
    });
  };

  const open = async (item: (typeof items)[number]) => {
    if (!item.read) markRead.mutate({ ids: [item.id] });
    const target = notificationTarget(
      item.event.type,
      item.event.entityId,
      item.event.data as Record<string, unknown>,
    );
    onClose();
    await navigate({
      to: '/app/trips/$tripId',
      params: { tripId: item.tripId },
      search: {
        tab: target.tab === 'plan' ? undefined : target.tab,
        view: target.view,
      },
    });
    if (target.key || target.date) focusItem(target.key, target.date);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={t('notifications.title')} className="sm:max-w-lg">
        <div className="flex items-center justify-end pb-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={!unread || markAll.isPending}
            onClick={() => markAll.mutate(undefined)}
          >
            {t('notifications.markAll')}
          </Button>
        </div>
        {list.isPending && <Loader2 className="mx-auto my-10 animate-spin text-muted-foreground" />}
        {list.data && items.length === 0 && (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            {t('notifications.empty')}
          </p>
        )}
        <ul className="grid grid-cols-1 divide-y">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => void open(item)}
                className="flex w-full items-start gap-3 px-1 py-3 text-left transition hover:bg-muted/50"
              >
                {item.actor ? (
                  <UserAvatar user={item.actor} size="sm" />
                ) : (
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted">
                    <Bell className="size-4" />
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className={cn('block text-sm', !item.read && 'font-semibold')}>
                    {text(item)}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {item.tripEmoji ? `${item.tripEmoji} ` : ''}
                    {item.tripTitle} · {timeAgo(item.createdAt, locale)}
                  </span>
                </span>
                {!item.read && (
                  <span
                    className="mt-1.5 size-2.5 shrink-0 rounded-full bg-primary"
                    aria-label={t('notifications.unreadDot')}
                  />
                )}
              </button>
            </li>
          ))}
        </ul>
        {list.hasNextPage && (
          <Button
            variant="outline"
            className="mt-3 w-full"
            disabled={list.isFetchingNextPage}
            onClick={() => void list.fetchNextPage()}
          >
            {list.isFetchingNextPage && <Loader2 className="animate-spin" />}
            {t('notifications.more')}
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}

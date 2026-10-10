import { formatNotification } from '@tripshare/shared';
import { currentLocale } from './i18n';

export { notificationTarget, type NotificationTarget } from '@tripshare/shared';

/** Testo di una notifica, composto nella lingua corrente dai parametri dell'evento. */
export function describeNotification(
  event: { type: string; count: number; data: Record<string, unknown> },
  actorName: string | null | undefined,
): string {
  return formatNotification(currentLocale(), event, actorName);
}

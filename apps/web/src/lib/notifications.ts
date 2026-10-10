/** Dove portare chi tocca una notifica: tab del viaggio, elemento da evidenziare, giorno. */
export interface NotificationTarget {
  tab: string;
  view?: string;
  /** Valore di data-search-id dell'elemento (vuoto se non c'è più o non è puntuale). */
  key: string;
  date?: string;
}

export function notificationTarget(
  type: string,
  entityId: string | null,
  data: Record<string, unknown>,
): NotificationTarget {
  const id = entityId ?? '';
  const date = typeof data.date === 'string' ? data.date : undefined;
  const deleted = type.endsWith('.deleted');
  const key = (kind: string) => (deleted || !id ? '' : `${kind}:${id}`);
  if (type.startsWith('expense.')) return { tab: 'expenses', key: key('expense') };
  if (type === 'settlement.created') return { tab: 'expenses', view: 'balances', key: '' };
  if (type.startsWith('plan.activity.')) return { tab: 'plan', key: key('activity'), date };
  if (type.startsWith('plan.day.')) return { tab: 'plan', key: '', date };
  if (type.startsWith('plan.place.')) return { tab: 'places', key: key('place') };
  if (type.startsWith('plan.booking.')) return { tab: 'bookings', key: key('booking') };
  if (type.startsWith('plan.budget.'))
    return { tab: 'expenses', view: 'budget', key: key('budget') };
  if (type.startsWith('plan.packing.')) return { tab: 'packing', key: key('packing') };
  if (type === 'ticket.added') return { tab: 'bookings', key: id ? `booking:${id}` : '' };
  if (type.startsWith('note.')) return { tab: 'notes', key: key('note') };
  if (type.startsWith('member.')) return { tab: 'members', key: '' };
  return { tab: 'plan', key: '' };
}

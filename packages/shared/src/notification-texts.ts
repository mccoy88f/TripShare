import type { Locale } from './locales.js';
import { isCurrencyCode, type CurrencyCode } from './currencies.js';
import { formatMoney } from './money.js';

/**
 * Testi delle notifiche, uguali per l'app e per le notifiche push del server: il testo si compone
 * dai parametri dell'evento nella lingua di chi legge. `one` vale per una sola modifica, `other`
 * per più modifiche fuse insieme.
 */
export interface NotificationTexts {
  types: Record<string, { one: string; other: string }>;
  roles: Record<string, string>;
  someone: string;
  unknown: string;
}

export const NOTIFICATION_TEXTS: Record<Locale, NotificationTexts> = {
  it: {
    types: {
      'expense.created': {
        one: '{{actor}} ha aggiunto la spesa «{{title}}» ({{amount}})',
        other: '{{actor}} ha aggiunto {{count}} spese',
      },
      'expense.updated': {
        one: '{{actor}} ha modificato la spesa «{{title}}»',
        other: '{{actor}} ha modificato la spesa «{{title}}»',
      },
      'expense.deleted': {
        one: '{{actor}} ha eliminato la spesa «{{title}}»',
        other: '{{actor}} ha eliminato {{count}} spese',
      },
      'expense.paid': {
        one: '{{actor}} ha segnato come pagata «{{title}}» ({{amount}})',
        other: '{{actor}} ha segnato come pagate {{count}} spese',
      },
      'settlement.created': {
        one: '{{actor}} ha registrato un rimborso di {{amount}}',
        other: '{{actor}} ha registrato {{count}} rimborsi',
      },
      'plan.activity.added': {
        one: "{{actor}} ha aggiunto l'attività «{{title}}»",
        other: '{{actor}} ha aggiunto {{count}} attività',
      },
      'plan.activity.updated': {
        one: "{{actor}} ha modificato l'attività «{{title}}»",
        other: "{{actor}} ha modificato l'attività «{{title}}»",
      },
      'plan.activity.deleted': {
        one: "{{actor}} ha tolto l'attività «{{title}}»",
        other: '{{actor}} ha tolto {{count}} attività',
      },
      'plan.day.added': {
        one: '{{actor}} ha aggiunto il giorno «{{title}}»',
        other: '{{actor}} ha aggiunto {{count}} giorni',
      },
      'plan.day.deleted': {
        one: '{{actor}} ha tolto il giorno «{{title}}»',
        other: '{{actor}} ha tolto {{count}} giorni',
      },
      'plan.place.added': {
        one: '{{actor}} ha aggiunto il luogo «{{title}}»',
        other: '{{actor}} ha aggiunto {{count}} luoghi',
      },
      'plan.place.updated': {
        one: '{{actor}} ha modificato il luogo «{{title}}»',
        other: '{{actor}} ha modificato il luogo «{{title}}»',
      },
      'plan.place.photo': {
        one: '{{actor}} ha cambiato la foto di «{{title}}»',
        other: '{{actor}} ha cambiato la foto di «{{title}}»',
      },
      'plan.place.deleted': {
        one: '{{actor}} ha tolto il luogo «{{title}}»',
        other: '{{actor}} ha tolto {{count}} luoghi',
      },
      'plan.booking.added': {
        one: '{{actor}} ha aggiunto la prenotazione «{{title}}»',
        other: '{{actor}} ha aggiunto {{count}} prenotazioni',
      },
      'plan.booking.updated': {
        one: '{{actor}} ha modificato la prenotazione «{{title}}»',
        other: '{{actor}} ha modificato la prenotazione «{{title}}»',
      },
      'plan.booking.deleted': {
        one: '{{actor}} ha tolto la prenotazione «{{title}}»',
        other: '{{actor}} ha tolto {{count}} prenotazioni',
      },
      'plan.budget.added': {
        one: '{{actor}} ha aggiunto la voce di budget «{{title}}»',
        other: '{{actor}} ha aggiunto {{count}} voci di budget',
      },
      'plan.budget.updated': {
        one: '{{actor}} ha modificato la voce di budget «{{title}}»',
        other: '{{actor}} ha modificato la voce di budget «{{title}}»',
      },
      'plan.budget.deleted': {
        one: '{{actor}} ha tolto la voce di budget «{{title}}»',
        other: '{{actor}} ha tolto {{count}} voci di budget',
      },
      'plan.packing.added': {
        one: '{{actor}} ha aggiunto ai bagagli «{{title}}»',
        other: '{{actor}} ha aggiunto {{count}} elementi ai bagagli',
      },
      'plan.packing.deleted': {
        one: '{{actor}} ha tolto dai bagagli «{{title}}»',
        other: '{{actor}} ha tolto {{count}} elementi dai bagagli',
      },
      'plan.tips.updated': {
        one: '{{actor}} ha modificato i consigli del programma',
        other: '{{actor}} ha modificato i consigli del programma',
      },
      'plan.replaced': {
        one: '{{actor}} ha sostituito il programma ({{days}} giorni)',
        other: '{{actor}} ha sostituito il programma ({{days}} giorni)',
      },
      'ticket.added': {
        one: '{{actor}} ha aggiunto un biglietto',
        other: '{{actor}} ha aggiunto {{count}} biglietti',
      },
      'note.created': {
        one: '{{actor}} ha aggiunto la nota «{{title}}»',
        other: '{{actor}} ha aggiunto {{count}} note',
      },
      'note.updated': {
        one: '{{actor}} ha modificato la nota «{{title}}»',
        other: '{{actor}} ha modificato la nota «{{title}}»',
      },
      'member.joined': {
        one: '{{name}} è entrato nel viaggio',
        other: '{{count}} persone sono entrate nel viaggio',
      },
      'member.left': {
        one: '{{name}} è uscito dal viaggio',
        other: '{{count}} persone sono uscite dal viaggio',
      },
      'member.role': {
        one: '{{actor}} ha cambiato il ruolo di {{name}}: {{role}}',
        other: '{{actor}} ha cambiato il ruolo di {{name}}: {{role}}',
      },
      'trip.updated': {
        one: '{{actor}} ha modificato i dati del viaggio',
        other: '{{actor}} ha modificato i dati del viaggio',
      },
      'trip.reset': {
        one: '{{actor}} ha azzerato il viaggio',
        other: '{{actor}} ha azzerato il viaggio',
      },
    },
    roles: {
      owner: 'Proprietario',
      editor: 'Può modificare',
      viewer: 'Solo lettura',
    },
    someone: 'Qualcuno',
    unknown: 'Il viaggio è stato modificato',
  },
  en: {
    types: {
      'expense.created': {
        one: '{{actor}} added the expense “{{title}}” ({{amount}})',
        other: '{{actor}} added {{count}} expenses',
      },
      'expense.updated': {
        one: '{{actor}} edited the expense “{{title}}”',
        other: '{{actor}} edited the expense “{{title}}”',
      },
      'expense.deleted': {
        one: '{{actor}} deleted the expense “{{title}}”',
        other: '{{actor}} deleted {{count}} expenses',
      },
      'expense.paid': {
        one: '{{actor}} marked “{{title}}” as paid ({{amount}})',
        other: '{{actor}} marked {{count}} expenses as paid',
      },
      'settlement.created': {
        one: '{{actor}} recorded a repayment of {{amount}}',
        other: '{{actor}} recorded {{count}} repayments',
      },
      'plan.activity.added': {
        one: '{{actor}} added the activity “{{title}}”',
        other: '{{actor}} added {{count}} activities',
      },
      'plan.activity.updated': {
        one: '{{actor}} edited the activity “{{title}}”',
        other: '{{actor}} edited the activity “{{title}}”',
      },
      'plan.activity.deleted': {
        one: '{{actor}} removed the activity “{{title}}”',
        other: '{{actor}} removed {{count}} activities',
      },
      'plan.day.added': {
        one: '{{actor}} added the day “{{title}}”',
        other: '{{actor}} added {{count}} days',
      },
      'plan.day.deleted': {
        one: '{{actor}} removed the day “{{title}}”',
        other: '{{actor}} removed {{count}} days',
      },
      'plan.place.added': {
        one: '{{actor}} added the place “{{title}}”',
        other: '{{actor}} added {{count}} places',
      },
      'plan.place.updated': {
        one: '{{actor}} edited the place “{{title}}”',
        other: '{{actor}} edited the place “{{title}}”',
      },
      'plan.place.photo': {
        one: '{{actor}} changed the photo of “{{title}}”',
        other: '{{actor}} changed the photo of “{{title}}”',
      },
      'plan.place.deleted': {
        one: '{{actor}} removed the place “{{title}}”',
        other: '{{actor}} removed {{count}} places',
      },
      'plan.booking.added': {
        one: '{{actor}} added the booking “{{title}}”',
        other: '{{actor}} added {{count}} bookings',
      },
      'plan.booking.updated': {
        one: '{{actor}} edited the booking “{{title}}”',
        other: '{{actor}} edited the booking “{{title}}”',
      },
      'plan.booking.deleted': {
        one: '{{actor}} removed the booking “{{title}}”',
        other: '{{actor}} removed {{count}} bookings',
      },
      'plan.budget.added': {
        one: '{{actor}} added the budget item “{{title}}”',
        other: '{{actor}} added {{count}} budget items',
      },
      'plan.budget.updated': {
        one: '{{actor}} edited the budget item “{{title}}”',
        other: '{{actor}} edited the budget item “{{title}}”',
      },
      'plan.budget.deleted': {
        one: '{{actor}} removed the budget item “{{title}}”',
        other: '{{actor}} removed {{count}} budget items',
      },
      'plan.packing.added': {
        one: '{{actor}} added “{{title}}” to the packing list',
        other: '{{actor}} added {{count}} items to the packing list',
      },
      'plan.packing.deleted': {
        one: '{{actor}} removed “{{title}}” from the packing list',
        other: '{{actor}} removed {{count}} items from the packing list',
      },
      'plan.tips.updated': {
        one: '{{actor}} edited the plan tips',
        other: '{{actor}} edited the plan tips',
      },
      'plan.replaced': {
        one: '{{actor}} replaced the plan ({{days}} days)',
        other: '{{actor}} replaced the plan ({{days}} days)',
      },
      'ticket.added': {
        one: '{{actor}} added a ticket',
        other: '{{actor}} added {{count}} tickets',
      },
      'note.created': {
        one: '{{actor}} added the note “{{title}}”',
        other: '{{actor}} added {{count}} notes',
      },
      'note.updated': {
        one: '{{actor}} edited the note “{{title}}”',
        other: '{{actor}} edited the note “{{title}}”',
      },
      'member.joined': {
        one: '{{name}} joined the trip',
        other: '{{count}} people joined the trip',
      },
      'member.left': {
        one: '{{name}} left the trip',
        other: '{{count}} people left the trip',
      },
      'member.role': {
        one: "{{actor}} changed {{name}}'s role: {{role}}",
        other: "{{actor}} changed {{name}}'s role: {{role}}",
      },
      'trip.updated': {
        one: '{{actor}} edited the trip details',
        other: '{{actor}} edited the trip details',
      },
      'trip.reset': {
        one: '{{actor}} reset the trip',
        other: '{{actor}} reset the trip',
      },
    },
    roles: {
      owner: 'Owner',
      editor: 'Can edit',
      viewer: 'View only',
    },
    someone: 'Someone',
    unknown: 'The trip was updated',
  },
};

export interface NotificationEventLike {
  type: string;
  count: number;
  data: Record<string, unknown>;
}

/** Testo di una notifica nella lingua indicata. */
export function formatNotification(
  locale: Locale,
  event: NotificationEventLike,
  actorName: string | null | undefined,
): string {
  const texts = NOTIFICATION_TEXTS[locale] ?? NOTIFICATION_TEXTS.it;
  const entry = texts.types[event.type];
  if (!entry) return texts.unknown;
  const d = event.data;
  const amount =
    typeof d.amount === 'number' && typeof d.currency === 'string'
      ? formatMoney(
          d.amount,
          (isCurrencyCode(d.currency) ? d.currency : 'EUR') as CurrencyCode,
          locale,
        )
      : '';
  const params: Record<string, string> = {
    count: String(event.count),
    actor: actorName ?? texts.someone,
    title: typeof d.title === 'string' ? d.title : '',
    name: typeof d.name === 'string' ? d.name : '',
    role: typeof d.role === 'string' ? (texts.roles[d.role] ?? d.role) : '',
    days: typeof d.days === 'number' ? String(d.days) : '0',
    amount,
  };
  return (event.count === 1 ? entry.one : entry.other).replace(
    /\{\{(\w+)\}\}/g,
    (_m, key: string) => params[key] ?? '',
  );
}

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


/** Indirizzo relativo da aprire per una notifica (tab, vista, elemento da evidenziare, giorno). */
export function notificationUrl(
  tripId: string,
  type: string,
  entityId: string | null,
  data: Record<string, unknown>,
): string {
  const t = notificationTarget(type, entityId, data);
  const params = new URLSearchParams();
  if (t.tab !== 'plan') params.set('tab', t.tab);
  if (t.view) params.set('view', t.view);
  if (t.key) params.set('focus', t.key);
  if (t.date) params.set('date', t.date);
  const query = params.toString();
  return `/app/trips/${tripId}${query ? `?${query}` : ''}`;
}

/** Categorie di notifica che l'utente può attivare o disattivare. */
export const NOTIFICATION_CATEGORIES = ['expenses', 'plan', 'notes', 'group'] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

/** Categoria di un tipo di evento: spese e rimborsi, programma, note, gruppo e viaggio. */
export function eventCategory(type: string): NotificationCategory {
  if (type.startsWith('expense.') || type.startsWith('settlement.')) return 'expenses';
  if (type.startsWith('plan.') || type.startsWith('ticket.')) return 'plan';
  if (type.startsWith('note.')) return 'notes';
  return 'group';
}

import type { Locale } from './locales.js';

/** Categorie di spesa con emoji predefinita e nomi localizzati. */
export const EXPENSE_CATEGORIES = {
  lodging: { emoji: '🏨', it: 'Alloggio', en: 'Lodging' },
  flights: { emoji: '✈️', it: 'Voli', en: 'Flights' },
  transport: { emoji: '🚕', it: 'Trasporti', en: 'Transport' },
  car: { emoji: '🚗', it: 'Noleggio auto', en: 'Car rental' },
  fuel: { emoji: '⛽', it: 'Carburante', en: 'Fuel' },
  parking: { emoji: '🅿️', it: 'Parcheggi e pedaggi', en: 'Parking and tolls' },
  food: { emoji: '🍽️', it: 'Ristoranti', en: 'Restaurants' },
  groceries: { emoji: '🛒', it: 'Spesa', en: 'Groceries' },
  drinks: { emoji: '🍺', it: 'Bar e drink', en: 'Bars and drinks' },
  coffee: { emoji: '☕', it: 'Caffè e colazioni', en: 'Coffee and breakfast' },
  tickets: { emoji: '🎟️', it: 'Ingressi', en: 'Tickets' },
  activities: { emoji: '🎯', it: 'Attività ed escursioni', en: 'Activities and tours' },
  shopping: { emoji: '🛍️', it: 'Acquisti', en: 'Shopping' },
  fees: { emoji: '🧾', it: 'Visti e tasse', en: 'Visas and fees' },
  insurance: { emoji: '🛡️', it: 'Assicurazioni', en: 'Insurance' },
  health: { emoji: '💊', it: 'Salute', en: 'Health' },
  communication: { emoji: '📶', it: 'Telefono e internet', en: 'Phone and internet' },
  tips: { emoji: '💁', it: 'Mance', en: 'Tips' },
  other: { emoji: '📦', it: 'Altro', en: 'Other' },
} as const satisfies Record<string, { emoji: string } & Record<Locale, string>>;

export type ExpenseCategory = keyof typeof EXPENSE_CATEGORIES;
export const EXPENSE_CATEGORY_KEYS = Object.keys(EXPENSE_CATEGORIES) as [
  ExpenseCategory,
  ...ExpenseCategory[],
];

export function categoryLabel(category: ExpenseCategory, locale: Locale): string {
  return EXPENSE_CATEGORIES[category][locale];
}

export function categoryEmoji(category: ExpenseCategory): string {
  return EXPENSE_CATEGORIES[category].emoji;
}

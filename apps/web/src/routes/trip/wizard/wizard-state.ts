import {
  distributeNights,
  haversineKm,
  nightsBetween,
  orderStops,
  type GeoPoint,
} from '@tripshare/shared';
import {
  AiPrefsSchema,
  type AiPrefs,
  type GeoPlace,
  type Stop,
  type TripBrief,
} from '@tripshare/shared/trip-format';

export const MAX_STOPS = 8;
export const MAX_DAYS = 90;
export const MAX_PEOPLE = 30;

export interface Person {
  name: string;
  email: string;
}

export interface WizardState {
  main: GeoPlace | null;
  origin: GeoPlace | null;
  differentReturn: boolean;
  returnTo: GeoPlace | null;
  /** Tappe nell'ordine del percorso. */
  stops: Stop[];
  /** L'utente ha scelto l'ordine a mano. */
  manualOrder: boolean;
  /** L'utente ha cambiato le notti a mano. */
  nightsTouched: boolean;
  start: string;
  end: string;
  adults: number;
  /** Età dei bambini. */
  children: number[];
  /** Nome ed email di chi viaggia oltre a chi crea il viaggio: prima gli adulti, poi i bambini. */
  people: Person[];
  mode: 'empty' | 'ai' | null;
  ai: AiPrefs;
  title: string;
}

export const emptyWizard = (origin: GeoPlace | null): WizardState => ({
  main: null,
  origin,
  differentReturn: false,
  returnTo: null,
  stops: [],
  manualOrder: false,
  nightsTouched: false,
  start: '',
  end: '',
  adults: 2,
  children: [],
  people: [],
  mode: null,
  ai: AiPrefsSchema.parse({}),
  title: '',
});

const point = (p: GeoPlace): GeoPoint => ({ lat: p.lat, lon: p.lon });

/** Punto in cui finisce il viaggio. */
export const returnPoint = (s: WizardState): GeoPlace | null =>
  s.differentReturn ? s.returnTo : s.origin;

export const totalNights = (s: WizardState) =>
  s.start && s.end && s.end >= s.start ? nightsBetween(s.start, s.end) : 0;

/** Riordina le tappe (se l'ordine non è manuale) e ripartisce le notti (se non sono state toccate). */
export function normalize(s: WizardState): WizardState {
  let next = s;
  if (!next.manualOrder && next.stops.length > 1 && next.origin) {
    const ret = returnPoint(next);
    const { order } = orderStops(point(next.origin), next.stops, ret ? point(ret) : undefined);
    next = { ...next, stops: order };
  }
  if (!next.nightsTouched && next.stops.length > 0) {
    const nights = distributeNights(totalNights(next), next.stops.length);
    next = { ...next, stops: next.stops.map((st, i) => ({ ...st, nights: nights[i] ?? 0 })) };
  }
  return next;
}

/** Km totali e per tratto, in linea d'aria, del percorso nell'ordine attuale. */
export function route(s: WizardState): { legs: number[]; total: number } | null {
  if (!s.origin || s.stops.length === 0) return null;
  const ret = returnPoint(s) ?? s.origin;
  const pts = [s.origin, ...s.stops, ret];
  const legs = pts.slice(1).map((p, i) => haversineKm(point(pts[i]!), point(p)));
  return { legs, total: legs.reduce((a, b) => a + b, 0) };
}

/** Km in più rispetto all'ordine migliore, se l'ordine scelto a mano è più lungo. */
export function extraKm(s: WizardState): number {
  const current = route(s);
  if (!current || s.stops.length < 2 || !s.origin) return 0;
  const ret = returnPoint(s);
  const best = orderStops(point(s.origin), s.stops, ret ? point(ret) : undefined).totalKm;
  return Math.max(0, current.total - best);
}

export const nightsAssigned = (s: WizardState) => s.stops.reduce((n, x) => n + x.nights, 0);

export const peopleCount = (s: WizardState) => s.adults + s.children.length;

/** Righe per chi viaggia oltre a chi crea il viaggio (adulti dal secondo, poi i bambini). */
export const otherPeople = (s: WizardState) => s.adults - 1 + s.children.length;

export function toBrief(s: WizardState, mode: 'empty' | 'ai'): TripBrief {
  return {
    main: s.main!,
    origin: s.origin ?? undefined,
    returnTo: s.differentReturn && s.returnTo ? s.returnTo : undefined,
    stops: s.stops,
    travelers: { adults: s.adults, children: s.children },
    ai: mode === 'ai' ? s.ai : undefined,
  };
}

const DRAFT = 'tripshare.wizardDraft';
const ORIGIN = 'tripshare.lastOrigin';

export function loadDraft(): WizardState | null {
  try {
    const raw = localStorage.getItem(DRAFT);
    return raw ? { ...emptyWizard(null), ...(JSON.parse(raw) as WizardState) } : null;
  } catch {
    return null;
  }
}
export function saveDraft(s: WizardState | null) {
  try {
    if (s) localStorage.setItem(DRAFT, JSON.stringify(s));
    else localStorage.removeItem(DRAFT);
  } catch {
    // bozza non salvata
  }
}
export function lastOrigin(): GeoPlace | null {
  try {
    const raw = localStorage.getItem(ORIGIN);
    return raw ? (JSON.parse(raw) as GeoPlace) : null;
  } catch {
    return null;
  }
}
export function rememberOrigin(p: GeoPlace) {
  try {
    localStorage.setItem(ORIGIN, JSON.stringify(p));
  } catch {
    // non salvato
  }
}

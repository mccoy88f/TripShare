import { z } from 'zod';

/**
 * Scheda del viaggio compilata nella creazione guidata: dove, con chi e, se si usa l'AI, cosa si
 * desidera. Si conserva con il viaggio e guida la generazione e le richieste di modifica.
 */
export const GeoPlaceSchema = z.object({
  label: z.string().trim().min(1).max(160),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
});
export type GeoPlace = z.infer<typeof GeoPlaceSchema>;

export const StopSchema = GeoPlaceSchema.extend({
  nights: z.number().int().min(0).max(60).default(1),
});
export type Stop = z.infer<typeof StopSchema>;

export const TRIP_TYPES = [
  'relax',
  'culture',
  'adventure',
  'fun',
  'nature',
  'food',
  'other',
] as const;
export const INTENSITIES = ['easy', 'normal', 'intense'] as const;
export const TRANSPORT_PREFS = ['car', 'train', 'bus', 'plane', 'ferry', 'walk_bike'] as const;
export const EXPERIENCES = ['local', 'alternative', 'mainstream'] as const;
export const BUDGET_TIERS = ['low', 'mid', 'high'] as const;
export const LODGINGS = ['any', 'hotel', 'apartment', 'bnb', 'hostel', 'camping'] as const;
export const NEEDS = ['reduced_mobility', 'vegetarian', 'pets', 'allergies'] as const;

export const AiPrefsSchema = z.object({
  types: z.array(z.enum(TRIP_TYPES)).max(TRIP_TYPES.length).default([]),
  intensity: z.enum(INTENSITIES).default('normal'),
  transport: z.array(z.enum(TRANSPORT_PREFS)).max(TRANSPORT_PREFS.length).default([]),
  experience: z.enum(EXPERIENCES).default('mainstream'),
  budget: z.enum(BUDGET_TIERS).default('mid'),
  lodging: z.enum(LODGINGS).default('any'),
  needs: z.array(z.enum(NEEDS)).max(NEEDS.length).default([]),
  /** Prenotazioni già fatte, in testo libero (voli, hotel, date fisse). */
  booked: z.string().trim().max(1500).optional(),
  /** Altro che l'AI deve tenere in considerazione. */
  notes: z.string().trim().max(1500).optional(),
});
export type AiPrefs = z.infer<typeof AiPrefsSchema>;

export const TripBriefSchema = z.object({
  main: GeoPlaceSchema,
  origin: GeoPlaceSchema.optional(),
  /** Se manca, si rientra dove si è partiti. */
  returnTo: GeoPlaceSchema.optional(),
  /** Tappe già nell'ordine del percorso (massimo 8). */
  stops: z.array(StopSchema).max(8).default([]),
  travelers: z.object({
    adults: z.number().int().min(1).max(30),
    /** Età dei bambini. */
    children: z.array(z.number().int().min(0).max(17)).max(20).default([]),
  }),
  ai: AiPrefsSchema.optional(),
});
export type TripBrief = z.infer<typeof TripBriefSchema>;

/** Persone che viaggiano, bambini compresi. */
export const briefTravelers = (b: Pick<TripBrief, 'travelers'>) =>
  b.travelers.adults + b.travelers.children.length;

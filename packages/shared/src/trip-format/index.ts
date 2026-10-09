import { TripDocumentSchema, type TripDocument } from './schema.js';

export * from './schema.js';
export * from './json-schema.js';
export * from './prompt.js';
export * from './ops.js';
export * from './budget.js';

export interface TripFormatIssue {
  path: string;
  message: string;
}

export type TripParseResult =
  { success: true; data: TripDocument } | { success: false; issues: TripFormatIssue[] };

/** Valida un documento (già decodificato da JSON) e applica i valori predefiniti. */
export function parseTripDocument(input: unknown): TripParseResult {
  const result = TripDocumentSchema.safeParse(input);
  if (result.success) return { success: true, data: result.data };
  return {
    success: false,
    issues: result.error.issues.map((i) => ({
      path: i.path.map(String).join('.') || '(root)',
      message: i.message,
    })),
  };
}

/**
 * Estrae il JSON dalla risposta di un modello: accetta JSON puro o racchiuso in un blocco
 * ```json … ```, ed eventuale testo prima o dopo.
 */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced?.[1] ?? text).trim();
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start === -1 || end <= start) throw new Error('No JSON object found in model output');
    return JSON.parse(candidate.slice(start, end + 1));
  }
}

import { z } from 'zod';
import { TripDocumentSchema, TRIP_FORMAT_SCHEMA_ID } from './schema.js';

/** JSON Schema (draft 2020-12) del formato, da passare a OpenRouter come `response_format`. */
export function tripDocumentJsonSchema(): Record<string, unknown> {
  const schema = z.toJSONSchema(TripDocumentSchema, {
    target: 'draft-2020-12',
    io: 'input',
    unrepresentable: 'any',
  }) as Record<string, unknown>;
  return { ...schema, $id: TRIP_FORMAT_SCHEMA_ID };
}

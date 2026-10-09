import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildRepairMessage,
  buildTripGenerationRequest,
  extractJson,
  parseTripDocument,
  tripDocumentJsonSchema,
} from '../src/trip-format/index.js';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const example = JSON.parse(read('../examples/scozia.trip.json'));

describe('trip format', () => {
  it('accepts the Scotland example', () => {
    const result = parseTripDocument(example);
    if (!result.success) console.error(result.issues);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.days).toHaveLength(5);
      expect(result.data.places[0]!.links).toBeDefined();
    }
  });

  it('reports broken references, duplicates and out of range days', () => {
    const broken = structuredClone(example);
    broken.days[0].activities[1].placeIds = ['does-not-exist'];
    broken.days[1].activities[0].id = broken.days[0].activities[0].id;
    broken.days[4].date = '2026-10-20';
    const result = parseTripDocument(broken);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.issues.map((i) => `${i.path}: ${i.message}`).join('\n');
      expect(messages).toContain('unknown place "does-not-exist"');
      expect(messages).toContain('duplicate id "d1-departure"');
      expect(messages).toContain('outside the trip dates');
    }
  });

  it('keeps the committed JSON Schema in sync (run `pnpm schema:trip`)', () => {
    const committed = JSON.parse(read('../schema/trip.v1.schema.json'));
    expect(committed).toEqual(tripDocumentJsonSchema());
  });

  it('extracts JSON from model output', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Ecco il viaggio: {"a":{"b":2}} buon viaggio')).toEqual({ a: { b: 2 } });
    expect(() => extractJson('niente')).toThrow();
  });

  it('builds a localized generation request', () => {
    const req = buildTripGenerationRequest(
      { prompt: 'Scozia in auto', currency: 'EUR', travelers: 4, today: '2026-10-09' },
      'it',
    );
    expect(req.messages[0]!.content).toContain('TripShare Trip Format');
    expect(req.messages[1]!.content).toContain('Viaggiatori: 4');
    expect(req.response_format.json_schema.schema).toHaveProperty('$id');
    expect(buildRepairMessage([{ path: 'days', message: 'x' }], 'en').content).toContain('days: x');
  });
});

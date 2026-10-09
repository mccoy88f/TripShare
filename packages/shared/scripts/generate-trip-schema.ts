import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tripDocumentJsonSchema } from '../src/trip-format/json-schema.js';

// Rigenera schema/trip.v1.schema.json dallo schema Zod. Il test verifica che il file sia aggiornato.
const target = fileURLToPath(new URL('../schema/trip.v1.schema.json', import.meta.url));
writeFileSync(target, `${JSON.stringify(tripDocumentJsonSchema(), null, 2)}\n`);
console.log(`Scritto ${target}`);

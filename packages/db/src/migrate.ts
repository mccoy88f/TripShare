import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDb } from './client.js';

/**
 * Cartella delle migrazioni: MIGRATIONS_DIR se impostata (immagine Docker), altrimenti
 * packages/db/drizzle nel monorepo.
 */
export function migrationsFolder(): string {
  if (process.env.MIGRATIONS_DIR) return resolve(process.env.MIGRATIONS_DIR);
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [resolve(here, '../drizzle'), resolve(here, 'drizzle'), resolve(process.cwd(), 'drizzle')];
  return candidates.find((dir) => existsSync(dir)) ?? candidates[0]!;
}

export async function runMigrations(url: string): Promise<void> {
  const { db, close } = createDb(url, { max: 1 });
  try {
    await migrate(db, { migrationsFolder: migrationsFolder() });
  } finally {
    await close();
  }
}

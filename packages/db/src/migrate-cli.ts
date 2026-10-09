import { runMigrations } from './migrate.js';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL non impostata');
  process.exit(1);
}
await runMigrations(url);
console.log('Migrazioni applicate');

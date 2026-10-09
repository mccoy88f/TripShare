import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index.js';

export function createDb(url: string, options: { max?: number } = {}) {
  const client = postgres(url, { max: options.max ?? 10, onnotice: () => {} });
  const db = drizzle({ client, schema, casing: 'snake_case' });
  return { db, client, close: () => client.end({ timeout: 5 }) };
}

export type Database = ReturnType<typeof createDb>['db'];

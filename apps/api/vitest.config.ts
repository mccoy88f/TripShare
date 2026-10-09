import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // I test di integrazione usano un database PostgreSQL reale (TEST_DATABASE_URL).
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});

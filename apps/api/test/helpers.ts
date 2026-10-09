import { sql } from 'drizzle-orm';
import { createDb, runMigrations } from '@tripshare/db';
import { createAuth } from '../src/auth.js';
import type { EmailJob, EmailSender } from '../src/email/index.js';
import { loadEnv } from '../src/env.js';
import { buildServer } from '../src/server.js';
import { SettingsService } from '../src/settings.js';
import { FileStorage } from '../src/storage.js';

/** Server completo su un database di test, con email catturate in memoria. */
export async function createTestApp(databaseUrl: string, uploadsDir?: string) {
  const env = loadEnv({
    NODE_ENV: 'test',
    APP_URL: 'http://localhost:5173',
    DATABASE_URL: databaseUrl,
    AUTH_SECRET: 'test-secret-'.padEnd(40, 'x'),
    ENCRYPTION_KEY: Buffer.alloc(32, 3).toString('base64'),
    SMTP_HOST: 'localhost',
    SUPERADMIN_EMAIL: 'admin@example.com',
  });
  const sent: EmailJob[] = [];
  const email: EmailSender = { send: async (job) => void sent.push(job) };
  await runMigrations(env.DATABASE_URL);
  const { db, close } = createDb(env.DATABASE_URL, { max: 2 });
  const settings = new SettingsService(db, env.ENCRYPTION_KEY);
  const auth = createAuth({ env, db, settings, email });
  const storage = uploadsDir ? new FileStorage(uploadsDir) : undefined;
  await storage?.init();
  const app = await buildServer({
    env,
    db,
    auth,
    settings,
    email,
    storage,
    fxRate: async (from, to) => ({
      rate: from === 'GBP' && to === 'EUR' ? 1.16 : 1,
      date: '2026-10-12',
    }),
  });

  const headers = (cookie?: string, extra: Record<string, string> = {}) => ({
    'content-type': 'application/json',
    origin: 'http://localhost:5173',
    ...(cookie ? { cookie } : {}),
    ...extra,
  });
  const cookieOf = (res: { headers: Record<string, unknown> }) =>
    ([] as string[])
      .concat((res.headers['set-cookie'] as string | string[] | undefined) ?? [])
      .map((c) => c.split(';')[0])
      .join('; ');

  const api = {
    env,
    db,
    app,
    auth,
    settings,
    sent,
    headers,
    cookieOf,
    async reset() {
      await db.execute(
        sql`truncate table "user", app_setting, audit_log, trip restart identity cascade`,
      );
      settings.clearCache();
      sent.length = 0;
    },
    async close() {
      await app.close();
      await close();
    },
    /** Chiamata tRPC: query se `input` è undefined o `kind` è 'query', altrimenti mutation. */
    async trpc<T = unknown>(
      path: string,
      cookie: string,
      input?: unknown,
      kind: 'query' | 'mutation' = 'mutation',
    ) {
      const res =
        kind === 'query'
          ? await app.inject({
              method: 'GET',
              url: `/api/trpc/${path}${input === undefined ? '' : `?input=${encodeURIComponent(JSON.stringify(input))}`}`,
              headers: headers(cookie),
            })
          : await app.inject({
              method: 'POST',
              url: `/api/trpc/${path}`,
              headers: headers(cookie),
              payload: JSON.stringify(input ?? {}),
            });
      const body = res.json();
      return {
        status: res.statusCode,
        data: body.result?.data as T,
        error: body.error as { message: string } | undefined,
      };
    },
    async signUp(email: string, name: string, extraHeaders: Record<string, string> = {}) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/sign-up/email',
        headers: headers(undefined, extraHeaders),
        payload: JSON.stringify({ email, password: 'password-123', name }),
      });
      if (res.statusCode !== 200) return { status: res.statusCode, body: res.json(), cookie: '' };
      const mail = sent.find((m) => m.to === email && m.template.kind === 'verify-email');
      const url = new URL((mail!.template as { url: string }).url);
      const verify = await app.inject({ method: 'GET', url: url.pathname + url.search });
      return { status: 200, body: null, cookie: cookieOf(verify) };
    },
  };
  return api;
}

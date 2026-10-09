import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, runMigrations } from '@tripshare/db';
import { createAuth } from '../src/auth.js';
import { bootstrap } from '../src/bootstrap.js';
import type { EmailJob, EmailSender } from '../src/email/index.js';
import { loadEnv } from '../src/env.js';
import { buildServer } from '../src/server.js';
import { SettingsService } from '../src/settings.js';

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const run = DATABASE_URL ? describe : describe.skip;

run('auth and profile (integration)', () => {
  const env = loadEnv({
    NODE_ENV: 'test',
    APP_URL: 'http://localhost:5173',
    DATABASE_URL: DATABASE_URL!,
    AUTH_SECRET: 'test-secret-'.padEnd(40, 'x'),
    ENCRYPTION_KEY: Buffer.alloc(32, 3).toString('base64'),
    SMTP_HOST: 'localhost',
    SUPERADMIN_EMAIL: 'admin@example.com',
  });
  const sent: EmailJob[] = [];
  const email: EmailSender = { send: async (job) => void sent.push(job) };
  const { db, close } = createDb(env.DATABASE_URL, { max: 2 });
  const settings = new SettingsService(db, env.ENCRYPTION_KEY);
  const auth = createAuth({ env, db, settings, email });
  let app: Awaited<ReturnType<typeof buildServer>>;

  const json = (body: unknown) => ({
    headers: { 'content-type': 'application/json', origin: 'http://localhost:5173' },
    payload: JSON.stringify(body),
  });
  const cookieOf = (res: { headers: Record<string, unknown> }) =>
    ([] as string[])
      .concat((res.headers['set-cookie'] as string | string[] | undefined) ?? [])
      .map((c) => c.split(';')[0])
      .join('; ');
  const trpc = (path: string, cookie: string, input?: unknown) =>
    input === undefined
      ? app.inject({ method: 'GET', url: `/api/trpc/${path}`, headers: { cookie } })
      : app.inject({
          method: 'POST',
          url: `/api/trpc/${path}`,
          ...json(input),
          headers: { ...json(input).headers, cookie },
        });

  async function signUpAndVerify(address: string, locale = 'it') {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      ...json({
        email: address,
        password: 'password-123',
        name: 'Luca',
        locale,
        defaultCurrency: 'GBP',
      }),
    });
    expect(res.statusCode).toBe(200);
    const mail = sent.find((m) => m.to === address && m.template.kind === 'verify-email');
    expect(mail).toBeDefined();
    const url = new URL((mail!.template as { url: string }).url);
    const verify = await app.inject({ method: 'GET', url: url.pathname + url.search });
    expect([200, 302]).toContain(verify.statusCode);
    return cookieOf(verify);
  }

  beforeAll(async () => {
    await runMigrations(env.DATABASE_URL);
    app = await buildServer({ env, db, auth, settings, email });
  });

  beforeEach(async () => {
    await db.execute(sql`truncate table "user", app_setting, audit_log restart identity cascade`);
    settings.clearCache();
    sent.length = 0;
  });

  afterAll(async () => {
    await app?.close();
    await close();
  });

  it('signs up, verifies the email and updates the profile', async () => {
    const cookie = await signUpAndVerify('luca@example.com', 'en');
    expect(sent[0]!.locale).toBe('en');

    const me = await trpc('me.get', cookie);
    expect(me.statusCode).toBe(200);
    expect(me.json().result.data).toMatchObject({
      email: 'luca@example.com',
      role: 'user',
      locale: 'en',
      defaultCurrency: 'GBP',
    });

    const update = await trpc('me.update', cookie, {
      avatarEmoji: '🦊',
      paypalMe: 'https://paypal.me/Luca88',
      theme: 'dark',
    });
    expect(update.statusCode).toBe(200);
    const after = await trpc('me.get', cookie);
    expect(after.json().result.data).toMatchObject({
      avatarEmoji: '🦊',
      paypalMe: 'Luca88',
      theme: 'dark',
    });

    const forbidden = await trpc('admin.settings.list', cookie);
    expect(forbidden.statusCode).toBe(403);
  });

  it('blocks sign in before email verification', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      ...json({ email: 'a@example.com', password: 'password-123', name: 'A' }),
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      ...json({ email: 'a@example.com', password: 'password-123' }),
    });
    expect(res.statusCode).toBe(403);
  });

  it('respects the registration mode and allowed domains', async () => {
    await settings.set('registration.mode', 'closed');
    const closed = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      ...json({ email: 'b@example.com', password: 'password-123', name: 'B' }),
    });
    expect(closed.statusCode).toBe(400);
    expect(closed.json().code).toBe('REGISTRATION_CLOSED');

    await settings.set('registration.mode', 'open');
    await settings.set('registration.allowedDomains', ['company.com']);
    const wrongDomain = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      ...json({ email: 'b@example.com', password: 'password-123', name: 'B' }),
    });
    expect(wrongDomain.json().code).toBe('EMAIL_DOMAIN_NOT_ALLOWED');
  });

  it('bootstraps the super admin, who can manage settings', async () => {
    await bootstrap({ env, db, auth, settings, log: { info() {}, warn() {} } });
    const mail = sent.find((m) => m.template.kind === 'set-password');
    expect(mail?.to).toBe('admin@example.com');

    const link = new URL((mail!.template as { url: string }).url);
    const redirect = await app.inject({ method: 'GET', url: link.pathname + link.search });
    const location = new URL(redirect.headers.location as string);
    const token = location.searchParams.get('token');
    expect(token).toBeTruthy();
    const reset = await app.inject({
      method: 'POST',
      url: '/api/auth/reset-password',
      ...json({ token, newPassword: 'admin-password-1' }),
    });
    expect(reset.statusCode).toBe(200);

    const signIn = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      ...json({ email: 'admin@example.com', password: 'admin-password-1' }),
    });
    expect(signIn.statusCode).toBe(200);
    const cookie = cookieOf(signIn);

    const update = await trpc('admin.settings.update', cookie, {
      key: 'openrouter.apiKey',
      value: 'sk-or-v1-secret-value-1234',
    });
    expect(update.statusCode).toBe(200);
    const list = await trpc('admin.settings.list', cookie);
    const body = JSON.stringify(list.json());
    expect(body).not.toContain('secret-value');
    expect(list.json().result.data['openrouter.apiKey']).toMatchObject({
      secret: true,
      set: true,
      preview: 'sk-or-…1234',
    });
    expect(await settings.get('openrouter.apiKey')).toBe('sk-or-v1-secret-value-1234');

    const bad = await trpc('admin.settings.update', cookie, {
      key: 'registration.mode',
      value: 'everyone',
    });
    expect(bad.statusCode).toBe(400);
    const users = await trpc(
      `admin.users.list?input=${encodeURIComponent(JSON.stringify({}))}`,
      cookie,
    );
    expect(users.json().result.data.total).toBe(1);
  });

  it('serves the trip format schema', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/trip-format/v1/schema.json' });
    expect(res.statusCode).toBe(200);
    expect(res.json().title).toBe('TripShare Trip Format v1');
  });
});

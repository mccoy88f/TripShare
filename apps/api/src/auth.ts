import { APIError, betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { admin, magicLink } from 'better-auth/plugins';
import { createAccessControl } from 'better-auth/plugins/access';
import { adminAc, defaultStatements, userAc } from 'better-auth/plugins/admin/access';
import { and, eq } from 'drizzle-orm';
import { account, schema, type Database } from '@tripshare/db';
import {
  CURRENCY_CODES,
  DEFAULT_CURRENCY,
  LOCALES,
  isLocale,
  pickLocale,
  type Locale,
} from '@tripshare/shared';
import type { EmailSender } from './email/index.js';
import type { Env } from './env.js';
import type { SettingsService } from './settings.js';

export const ROLES = ['user', 'superadmin'] as const;
export type Role = (typeof ROLES)[number];

// Ruoli del plugin admin di Better Auth: solo il super admin gestisce gli utenti.
const ac = createAccessControl(defaultStatements);
const roles = {
  user: ac.newRole({ ...userAc.statements }),
  superadmin: ac.newRole({ ...adminAc.statements }),
};

export interface AuthDeps {
  env: Env;
  db: Database;
  settings: SettingsService;
  email: EmailSender;
}

function localeOf(user: { locale?: unknown }, request?: Request): Locale {
  if (isLocale(user.locale)) return user.locale;
  return pickLocale(request?.headers.get('accept-language'));
}

/** Verifica se un indirizzo può registrarsi, in base alle impostazioni dell'istanza. */
export async function checkRegistration(deps: AuthDeps, email: string): Promise<void> {
  const normalized = email.toLowerCase();
  if (deps.env.SUPERADMIN_EMAIL && normalized === deps.env.SUPERADMIN_EMAIL.toLowerCase()) return;

  const mode = await deps.settings.get('registration.mode');
  if (mode === 'closed') {
    // 400 e non 403: con la verifica email obbligatoria Better Auth trasforma i 403 della
    // registrazione in una risposta generica di successo, per non rivelare gli indirizzi esistenti.
    throw new APIError('BAD_REQUEST', {
      message: 'Registration is closed',
      code: 'REGISTRATION_CLOSED',
    });
  }
  if (mode === 'invite_only') {
    // Gli inviti ai viaggi arrivano nella fase 2: per ora la modalità blocca le registrazioni.
    throw new APIError('BAD_REQUEST', {
      message: 'Registration requires an invitation',
      code: 'INVITATION_REQUIRED',
    });
  }
  const domains = await deps.settings.get('registration.allowedDomains');
  if (domains.length > 0) {
    const domain = normalized.split('@')[1] ?? '';
    if (!domains.some((d) => d.toLowerCase() === domain)) {
      throw new APIError('BAD_REQUEST', {
        message: 'Email domain not allowed',
        code: 'EMAIL_DOMAIN_NOT_ALLOWED',
      });
    }
  }
}

export function createAuth(deps: AuthDeps) {
  const { env, db } = deps;
  return betterAuth({
    appName: env.APP_NAME,
    baseURL: env.APP_URL,
    basePath: '/api/auth',
    secret: env.AUTH_SECRET,
    trustedOrigins: env.trustedOrigins,
    database: drizzleAdapter(db, { provider: 'pg', schema }),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
      async sendResetPassword({ user, url }, request) {
        // Chi non ha ancora una password (es. il super admin creato all'avvio) riceve
        // l'email "imposta password" invece di "reimposta password".
        const [credential] = await db
          .select({ id: account.id })
          .from(account)
          .where(and(eq(account.userId, user.id), eq(account.providerId, 'credential')));
        await deps.email.send({
          to: user.email,
          locale: localeOf(user as { locale?: unknown }, request),
          template: { kind: credential ? 'reset-password' : 'set-password', url, name: user.name },
        });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      expiresIn: 60 * 60 * 24,
      async sendVerificationEmail({ user, url }, request) {
        await deps.email.send({
          to: user.email,
          locale: localeOf(user as { locale?: unknown }, request),
          template: { kind: 'verify-email', url, name: user.name },
        });
      },
    },
    user: {
      additionalFields: {
        locale: { type: [...LOCALES], required: false, defaultValue: 'it', input: true },
        defaultCurrency: {
          type: [...CURRENCY_CODES],
          required: false,
          defaultValue: DEFAULT_CURRENCY,
          input: true,
        },
        timezone: { type: 'string', required: false, input: true },
        avatarEmoji: { type: 'string', required: false, input: true },
        avatarColor: { type: 'string', required: false, input: true },
        paypalMe: { type: 'string', required: false, input: true },
        theme: {
          type: ['system', 'light', 'dark'],
          required: false,
          defaultValue: 'system',
          input: true,
        },
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: true, maxAge: 5 * 60 },
    },
    rateLimit: { enabled: env.NODE_ENV === 'production', window: 60, max: 100 },
    advanced: {
      useSecureCookies: env.APP_URL.startsWith('https://'),
      ipAddress: { ipAddressHeaders: ['x-forwarded-for'] },
    },
    plugins: [
      admin({ ac, roles, defaultRole: 'user', adminRoles: ['superadmin'] }),
      magicLink({
        disableSignUp: true,
        expiresIn: 5 * 60,
        async sendMagicLink({ email, url }, ctx) {
          const request = ctx?.request;
          await deps.email.send({
            to: email,
            locale: pickLocale(request?.headers.get('accept-language')),
            template: { kind: 'magic-link', url },
          });
        },
      }),
    ],
    databaseHooks: {
      user: {
        create: {
          async before(user) {
            await checkRegistration(deps, user.email);
            const isSuperadmin =
              !!env.SUPERADMIN_EMAIL &&
              user.email.toLowerCase() === env.SUPERADMIN_EMAIL.toLowerCase();
            return { data: { ...user, role: isSuperadmin ? 'superadmin' : 'user' } };
          },
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
export type AuthSession = NonNullable<Awaited<ReturnType<Auth['api']['getSession']>>>;

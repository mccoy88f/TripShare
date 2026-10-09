import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { user, type Database } from '@tripshare/db';
import type { Auth } from './auth.js';
import type { Env } from './env.js';
import type { SettingsService } from './settings.js';

interface Logger {
  info(msg: string): void;
  warn(msg: string): void;
}

/**
 * Operazioni al primo avvio:
 * - crea il super admin indicato da SUPERADMIN_EMAIL e gli invia il link per impostare la password;
 * - salva la chiave OpenRouter delle variabili d'ambiente come valore iniziale.
 */
export async function bootstrap(deps: {
  env: Env;
  db: Database;
  auth: Auth;
  settings: SettingsService;
  log: Logger;
}) {
  const { env, db, auth, settings, log } = deps;

  if (env.OPENROUTER_API_KEY) await settings.seed('openrouter.apiKey', env.OPENROUTER_API_KEY);
  if (env.GEMINI_API_KEY) {
    await settings.seed('gemini.apiKey', env.GEMINI_API_KEY);
    // Con la sola chiave Gemini nelle variabili d'ambiente, Gemini diventa il provider centrale.
    if (!env.OPENROUTER_API_KEY) await settings.seed('ai.provider', 'gemini');
  }

  if (!env.SUPERADMIN_EMAIL) {
    log.warn('SUPERADMIN_EMAIL non impostata: nessun super admin verrà creato');
    return;
  }
  const email = env.SUPERADMIN_EMAIL.toLowerCase();
  const [existing] = await db.select().from(user).where(eq(user.email, email));
  if (existing) {
    if (existing.role !== 'superadmin') {
      await db
        .update(user)
        .set({ role: 'superadmin', updatedAt: new Date() })
        .where(eq(user.id, existing.id));
      log.info(`Utente ${email} promosso a super admin`);
    }
    return;
  }
  await db.insert(user).values({
    id: randomUUID(),
    name: 'Admin',
    email,
    emailVerified: true,
    role: 'superadmin',
  });
  await auth.api.requestPasswordReset({
    body: { email, redirectTo: `${env.appOrigin}/reset-password` },
  });
  log.info(`Super admin ${email} creato: inviato il link per impostare la password`);
}

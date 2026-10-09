import { and, count, eq, gte, sql } from 'drizzle-orm';
import { aiJob, userSecret, type Database } from '@tripshare/db';
import { decrypt, type EncryptedValue } from '../crypto.js';
import type { SettingsService } from '../settings.js';
import type { AiProvider } from './client.js';

export type AiPurpose = 'vision' | 'planner' | 'chat' | 'web' | 'light';
export const AI_PROVIDERS = ['openrouter', 'gemini'] as const;

export interface AiAccess {
  provider: AiProvider;
  apiKey: string;
  source: 'central' | 'user';
  model: string;
  fallbacks: string[];
  denyDataCollection: boolean;
}

export class AiAccessError extends Error {}

function open(value: unknown, encryptionKey: string): string | null {
  if (!value) return null;
  try {
    return decrypt(value as EncryptedValue, encryptionKey);
  } catch {
    return null;
  }
}

/** Chiavi personali dell'utente (decifrate) e provider preferito. */
export async function userKeys(db: Database, encryptionKey: string, userId: string) {
  const [row] = await db.select().from(userSecret).where(eq(userSecret.userId, userId));
  return {
    openrouter: open(row?.openrouterKey, encryptionKey),
    gemini: open(row?.geminiKey, encryptionKey),
    preferred: (row?.aiProvider === 'gemini' ? 'gemini' : 'openrouter') as AiProvider,
  };
}

function monthStart() {
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  return start;
}

/** Consumo del mese corrente sulla chiave centrale: costo in dollari e numero di richieste. */
export async function monthlyCentralUsage(db: Database, userId: string) {
  const [row] = await db
    .select({ cost: sql<number>`coalesce(sum(${aiJob.cost}), 0)`, requests: count() })
    .from(aiJob)
    .where(
      and(
        eq(aiJob.userId, userId),
        eq(aiJob.keySource, 'central'),
        gte(aiJob.createdAt, monthStart()),
      ),
    );
  return { cost: Number(row?.cost ?? 0), requests: Number(row?.requests ?? 0) };
}

/**
 * Sceglie provider, chiave e modello per un utente secondo la modalità impostata dal super admin:
 * - central: chiave dell'istanza (provider scelto dall'admin), con quota mensile per utente;
 * - per_user: solo le chiavi personali (OpenRouter o Gemini);
 * - mixed: la chiave personale se c'è, altrimenti quella centrale (con quota).
 * I modelli per ogni compito sono quelli scelti dall'admin per il provider usato.
 */
export async function resolveAiAccess(
  deps: { db: Database; settings: SettingsService; encryptionKey: string },
  userId: string,
  purpose: AiPurpose,
): Promise<AiAccess> {
  const { settings } = deps;
  const mode = await settings.get('openrouter.mode');
  let provider: AiProvider;
  let apiKey: string | null;
  let source: AiAccess['source'];

  const own = mode === 'central' ? null : await userKeys(deps.db, deps.encryptionKey, userId);
  const ownProvider = own
    ? own[own.preferred]
      ? own.preferred
      : own.openrouter
        ? 'openrouter'
        : own.gemini
          ? 'gemini'
          : null
    : null;

  if (own && ownProvider) {
    provider = ownProvider;
    apiKey = own[ownProvider];
    source = 'user';
  } else if (mode === 'per_user') {
    throw new AiAccessError('AI_KEY_REQUIRED');
  } else {
    provider = await settings.get('ai.provider');
    apiKey = await settings.get(provider === 'gemini' ? 'gemini.apiKey' : 'openrouter.apiKey');
    if (!apiKey) throw new AiAccessError('AI_NOT_CONFIGURED');
    const [quotaUsd, quotaRequests, usage] = await Promise.all([
      settings.get('openrouter.monthlyQuotaUsd'),
      settings.get('ai.monthlyRequests'),
      monthlyCentralUsage(deps.db, userId),
    ]);
    if (usage.cost >= quotaUsd || (quotaRequests > 0 && usage.requests >= quotaRequests))
      throw new AiAccessError('AI_QUOTA_EXCEEDED');
    source = 'central';
  }

  const models = await settings.get(provider === 'gemini' ? 'gemini.models' : 'openrouter.models');
  return {
    provider,
    apiKey: apiKey!,
    source,
    model: models[purpose],
    fallbacks: models.fallbacks,
    denyDataCollection: await settings.get('openrouter.denyDataCollection'),
  };
}

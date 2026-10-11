import { and, count, eq, gte, sql } from 'drizzle-orm';
import { aiJob, userSecret, type Database } from '@tripshare/db';
import { decrypt, type EncryptedValue } from '../crypto.js';
import type { SettingsService } from '../settings.js';
import { AiError, type AiProvider } from './client.js';

export type AiPurpose = 'vision' | 'planner' | 'chat' | 'web' | 'light';
export const AI_PROVIDERS = ['openrouter', 'gemini'] as const;

/** Una configurazione da provare: provider, chiave e modelli. */
export interface AiCandidate {
  /** Identificativo stabile (id del profilo, "legacy" o "user:<provider>"). */
  id: string;
  name: string;
  provider: AiProvider;
  apiKey: string;
  model: string;
  fallbacks: string[];
}

export interface AiAccess {
  /** Come la prima di `candidates`: provider, chiave e modelli da provare per primi. */
  provider: AiProvider;
  apiKey: string;
  source: 'central' | 'user';
  model: string;
  fallbacks: string[];
  /** Configurazioni in ordine: se una fallisce si passa alla successiva. */
  candidates: AiCandidate[];
  denyDataCollection: boolean;
}

/** Un tentativo fallito, per il registro del lavoro. */
export interface AiAttempt {
  profile: string;
  provider: string;
  model: string;
  error: string;
  ms: number;
}

const cooldowns = new Map<string, number>();

/** Mette una configurazione in pausa dopo un errore che dipende da lei. */
export function coolDown(id: string, ms: number) {
  cooldowns.set(id, Date.now() + ms);
}

/** Svuota le pause (dopo aver cambiato le configurazioni). */
export function clearCooldowns() {
  cooldowns.clear();
}

/** Le configurazioni non in pausa vengono prima; se sono tutte in pausa si provano comunque. */
export function orderByCooldown(candidates: AiCandidate[]): AiCandidate[] {
  const now = Date.now();
  const ready = candidates.filter((c) => (cooldowns.get(c.id) ?? 0) <= now);
  const waiting = candidates.filter((c) => (cooldowns.get(c.id) ?? 0) > now);
  return [...ready, ...waiting];
}

/**
 * L'errore dipende dalla configurazione (chiave, credito, limiti, rete, modello inesistente) e
 * quindi ha senso provare la successiva? Una richiesta sbagliata (400) invece fallirebbe ovunque.
 * Restituisce la durata della pausa, o null se non si deve passare oltre.
 */
export function failoverPause(err: unknown): number | null {
  if (err instanceof AiError) {
    // Input che questo provider non gestisce (es. PDF): si passa oltre senza pausa.
    if (err.message.startsWith('AI_UNSUPPORTED_INPUT')) return 0;
    const s = err.status ?? 0;
    if (s === 401 || s === 403 || err.message.startsWith('AI_INVALID_KEY')) return 10 * 60_000;
    if (s === 402 || err.message.startsWith('AI_NO_CREDIT')) return 10 * 60_000;
    if (s === 429 || err.message.startsWith('AI_RATE_LIMITED')) return 2 * 60_000;
    if (s === 404) return 5 * 60_000;
    // Richiesta troppo grande per questo provider: tocca a un altro, senza metterlo in pausa.
    if (s === 413) return 0;
    if (s === 408 || s >= 500) return 60_000;
    return null;
  }
  // Rete irraggiungibile o tempo scaduto.
  if (
    err instanceof Error &&
    /fetch failed|timeout|abort|network|ECONN|ENOTFOUND/i.test(err.name + err.message)
  )
    return 60_000;
  return null;
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
  let candidates: AiCandidate[];
  let source: AiAccess['source'];

  const own = mode === 'central' ? null : await userKeys(deps.db, deps.encryptionKey, userId);
  const ownProviders = own
    ? (['openrouter', 'gemini'] as const)
        .filter((p) => own[p])
        .sort((a, b) => (a === own.preferred ? -1 : b === own.preferred ? 1 : 0))
    : [];

  if (own && ownProviders.length > 0) {
    source = 'user';
    candidates = await Promise.all(
      ownProviders.map(async (provider) => {
        const m = await modelsFor(settings, provider, purpose);
        return {
          id: `user:${provider}`,
          name: provider,
          provider,
          apiKey: own[provider]!,
          ...m,
        };
      }),
    );
  } else if (mode === 'per_user') {
    throw new AiAccessError('AI_KEY_REQUIRED');
  } else {
    candidates = await centralCandidates(settings, purpose);
    if (candidates.length === 0) throw new AiAccessError('AI_NOT_CONFIGURED');
    const [quotaUsd, quotaRequests, usage] = await Promise.all([
      settings.get('openrouter.monthlyQuotaUsd'),
      settings.get('ai.monthlyRequests'),
      monthlyCentralUsage(deps.db, userId),
    ]);
    if (usage.cost >= quotaUsd || (quotaRequests > 0 && usage.requests >= quotaRequests))
      throw new AiAccessError('AI_QUOTA_EXCEEDED');
    source = 'central';
  }

  const first = candidates[0]!;
  return {
    provider: first.provider,
    apiKey: first.apiKey,
    source,
    model: first.model,
    fallbacks: first.fallbacks,
    candidates,
    denyDataCollection: await settings.get('openrouter.denyDataCollection'),
  };
}

/** Modello e riserva per un provider: quelli del primo profilo attivo, altrimenti le impostazioni storiche. */
async function modelsFor(settings: SettingsService, provider: AiProvider, purpose: AiPurpose) {
  if (provider === 'groq') return { model: 'llama-3.3-70b-versatile', fallbacks: [] as string[] };
  if (provider === 'nvidia')
    return { model: 'meta/llama-3.3-70b-instruct', fallbacks: [] as string[] };
  if (provider === 'llm7') return { model: 'gpt-4.1-nano-2025-04-14', fallbacks: [] as string[] };
  const profile = (await settings.get('ai.profiles')).find(
    (p) => p.enabled && p.provider === provider,
  );
  if (profile)
    return { model: profile.model, fallbacks: profile.backupModel ? [profile.backupModel] : [] };
  const models = await settings.get(provider === 'gemini' ? 'gemini.models' : 'openrouter.models');
  return { model: models[purpose], fallbacks: models.fallbacks };
}

/** Configurazioni centrali: l'elenco dell'admin, oppure (se vuoto) le impostazioni storiche. */
async function centralCandidates(
  settings: SettingsService,
  purpose: AiPurpose,
): Promise<AiCandidate[]> {
  const profiles = (await settings.get('ai.profiles')).filter((p) => p.enabled);
  if (profiles.length > 0)
    return profiles.map((p) => ({
      id: p.id,
      name: p.name,
      provider: p.provider,
      apiKey: p.apiKey,
      model: p.model,
      fallbacks: p.backupModel ? [p.backupModel] : [],
    }));
  const provider = await settings.get('ai.provider');
  const apiKey = await settings.get(provider === 'gemini' ? 'gemini.apiKey' : 'openrouter.apiKey');
  if (!apiKey) return [];
  const m = await modelsFor(settings, provider, purpose);
  return [{ id: 'legacy', name: provider, provider, apiKey, ...m }];
}

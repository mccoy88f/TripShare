import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { appSetting, type Database } from '@tripshare/db';
import { decrypt, encrypt, maskSecret, type EncryptedValue } from './crypto.js';

/**
 * Registro delle impostazioni dell'istanza. Ogni chiave ha uno schema e un valore predefinito.
 * Le chiavi `secret` sono salvate cifrate e non tornano mai in chiaro al client.
 */
const MODEL_ID = z.string().min(1).max(200);

export const SETTINGS = {
  'general.appName': { schema: z.string().min(1).max(60).nullable(), default: null, secret: false },
  'registration.mode': {
    schema: z.enum(['open', 'invite_only', 'closed']),
    default: 'open' as const,
    secret: false,
  },
  'registration.allowedDomains': {
    schema: z.array(z.string().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/i)).max(50),
    default: [] as string[],
    secret: false,
  },
  /** Provider usato con la chiave centrale. */
  'ai.provider': {
    schema: z.enum(['openrouter', 'gemini']),
    default: 'openrouter' as const,
    secret: false,
  },
  /** Richieste AI al mese per utente sulla chiave centrale (0 = nessun limite). */
  'ai.monthlyRequests': {
    schema: z.number().int().min(0).max(100_000),
    default: 300,
    secret: false,
  },
  'gemini.apiKey': {
    schema: z.string().min(10).max(300).nullable(),
    default: null,
    secret: true,
  },
  'gemini.models': {
    schema: z.object({
      vision: MODEL_ID,
      planner: MODEL_ID,
      chat: MODEL_ID,
      web: MODEL_ID,
      light: MODEL_ID,
      fallbacks: z.array(MODEL_ID).max(5),
    }),
    default: {
      vision: 'gemini-flash-latest',
      planner: 'gemini-flash-latest',
      chat: 'gemini-flash-latest',
      web: 'gemini-flash-latest',
      light: 'gemini-flash-lite-latest',
      fallbacks: [] as string[],
    },
    secret: false,
  },
  /** Modalità delle chiavi AI (vale per tutti i provider). */
  'openrouter.mode': {
    schema: z.enum(['central', 'per_user', 'mixed']),
    default: 'central' as const,
    secret: false,
  },
  'openrouter.apiKey': {
    schema: z.string().min(10).max(300).nullable(),
    default: null,
    secret: true,
  },
  'openrouter.models': {
    schema: z.object({
      vision: MODEL_ID,
      planner: MODEL_ID,
      chat: MODEL_ID,
      web: MODEL_ID,
      light: MODEL_ID,
      fallbacks: z.array(MODEL_ID).max(5),
    }),
    default: {
      vision: 'openrouter/auto',
      planner: 'openrouter/auto',
      chat: 'openrouter/auto',
      web: 'openrouter/auto',
      light: 'openrouter/auto',
      fallbacks: [] as string[],
    },
    secret: false,
  },
  'openrouter.monthlyQuotaUsd': {
    schema: z.number().min(0).max(10_000),
    default: 2,
    secret: false,
  },
  'openrouter.denyDataCollection': { schema: z.boolean(), default: true, secret: false },
  'payments.paypalEnabled': { schema: z.boolean(), default: true, secret: false },
  'uploads.maxMb': { schema: z.number().int().min(1).max(50), default: 10, secret: false },
  'unsplash.accessKey': {
    schema: z.string().min(10).max(200).nullable(),
    default: null,
    secret: true,
  },
  /** Chiavi VAPID per le notifiche push: si generano al primo avvio e non si cambiano. */
  'push.vapid': {
    schema: z.object({ publicKey: z.string().min(20), privateKey: z.string().min(20) }).nullable(),
    default: null,
    secret: true,
  },
} as const;

export type SettingKey = keyof typeof SETTINGS;
export type SettingValue<K extends SettingKey> = z.output<(typeof SETTINGS)[K]['schema']>;
export const SETTING_KEYS = Object.keys(SETTINGS) as SettingKey[];

export function isSettingKey(key: string): key is SettingKey {
  return key in SETTINGS;
}

export class SettingsService {
  private cache = new Map<SettingKey, unknown>();

  constructor(
    private readonly db: Database,
    private readonly encryptionKey: string,
  ) {}

  async get<K extends SettingKey>(key: K): Promise<SettingValue<K>> {
    if (this.cache.has(key)) return this.cache.get(key) as SettingValue<K>;
    const def = SETTINGS[key];
    const [row] = await this.db.select().from(appSetting).where(eq(appSetting.key, key));
    let value: unknown = def.default;
    if (row) {
      const raw = row.encrypted
        ? JSON.parse(decrypt(row.value as EncryptedValue, this.encryptionKey))
        : row.value;
      const parsed = def.schema.safeParse(raw);
      if (parsed.success) value = parsed.data;
    }
    this.cache.set(key, value);
    return value as SettingValue<K>;
  }

  async set<K extends SettingKey>(key: K, value: SettingValue<K>, actorId?: string): Promise<void> {
    const def = SETTINGS[key];
    const parsed = def.schema.parse(value);
    const stored =
      def.secret && parsed !== null ? encrypt(JSON.stringify(parsed), this.encryptionKey) : parsed;
    const encrypted = def.secret && parsed !== null;
    // Un valore vuoto (null) si salva come JSON null: la colonna non accetta NULL di SQL.
    const column = (stored === null ? sql`'null'::jsonb` : stored) as object;
    await this.db
      .insert(appSetting)
      .values({ key, value: column, encrypted, updatedBy: actorId ?? null })
      .onConflictDoUpdate({
        target: appSetting.key,
        set: {
          value: column,
          encrypted,
          updatedBy: actorId ?? null,
          updatedAt: new Date(),
        },
      });
    this.cache.set(key, parsed);
  }

  /** Imposta un valore solo se non è mai stato salvato (valori iniziali dalle variabili d'ambiente). */
  async seed<K extends SettingKey>(key: K, value: SettingValue<K>): Promise<void> {
    const [row] = await this.db
      .select({ key: appSetting.key })
      .from(appSetting)
      .where(eq(appSetting.key, key));
    if (!row) await this.set(key, value);
  }

  /** Tutte le impostazioni per il pannello admin: i segreti sono mascherati. */
  async listForAdmin() {
    const entries = await Promise.all(
      SETTING_KEYS.map(async (key) => {
        const value = await this.get(key);
        if (SETTINGS[key].secret) {
          return [
            key,
            {
              secret: true,
              set: value !== null,
              preview: typeof value === 'string' ? maskSecret(value) : null,
            },
          ] as const;
        }
        return [key, { secret: false, value }] as const;
      }),
    );
    return Object.fromEntries(entries);
  }

  clearCache() {
    this.cache.clear();
  }
}

import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0', 'yes', 'no'])
  .transform((v) => v === 'true' || v === '1' || v === 'yes');

const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === '' ? undefined : v), schema.optional());

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    HOST: z.string().default('0.0.0.0'),
    APP_NAME: z.string().min(1).default('TripShare'),
    APP_URL: z.url(),
    DATABASE_URL: z.string().min(1),
    REDIS_URL: z.string().min(1).default('redis://localhost:6379'),
    AUTH_SECRET: z.string().min(32, 'AUTH_SECRET deve avere almeno 32 caratteri'),
    ENCRYPTION_KEY: z
      .string()
      .refine((v) => Buffer.from(v, 'base64').length === 32, 'ENCRYPTION_KEY: 32 byte in base64'),
    SUPERADMIN_EMAIL: optional(z.email()),
    TRUSTED_ORIGINS: optional(z.string()),

    SMTP_HOST: z.string().min(1),
    SMTP_PORT: z.coerce.number().int().positive().default(587),
    SMTP_SECURE: optional(bool),
    SMTP_USER: optional(z.string()),
    SMTP_PASSWORD: optional(z.string()),
    SMTP_FROM: optional(z.string()),
    SMTP_TLS_REJECT_UNAUTHORIZED: optional(bool),

    OPENROUTER_API_KEY: optional(z.string()),
  })
  .transform((env) => {
    const appUrl = new URL(env.APP_URL);
    return {
      ...env,
      appOrigin: appUrl.origin,
      smtp: {
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        // Porta 465 = TLS implicito; sulle altre si usa STARTTLS se il server lo offre.
        secure: env.SMTP_SECURE ?? env.SMTP_PORT === 465,
        auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD ?? '' } : undefined,
        rejectUnauthorized: env.SMTP_TLS_REJECT_UNAUTHORIZED ?? true,
        from: resolveMailFrom(env.APP_NAME, env.SMTP_FROM, env.SMTP_USER, appUrl.hostname),
      },
      trustedOrigins: [
        appUrl.origin,
        ...(env.TRUSTED_ORIGINS?.split(',').map((o) => o.trim()).filter(Boolean) ?? []),
      ],
    };
  });

export type Env = z.output<typeof EnvSchema>;

/**
 * Mittente delle email. SMTP_FROM è facoltativa: se manca si usa SMTP_USER quando è un indirizzo
 * email (molti server accettano solo quello), altrimenti noreply@<dominio dell'app>.
 */
export function resolveMailFrom(
  appName: string,
  from: string | undefined,
  user: string | undefined,
  hostname: string,
): string {
  if (from) return from;
  const address = user && z.email().safeParse(user).success ? user : `noreply@${hostname}`;
  return `"${appName.replace(/"/g, '')}" <${address}>`;
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    const details = result.error.issues
      .map((i) => `  - ${i.path.join('.') || '(env)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Configurazione non valida:\n${details}`);
  }
  return result.data;
}

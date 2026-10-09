import { describe, expect, it } from 'vitest';
import { decrypt, encrypt, maskSecret } from '../src/crypto.js';
import { loadEnv, resolveMailFrom } from '../src/env.js';

const base = {
  APP_URL: 'https://trip.example.com',
  DATABASE_URL: 'postgres://x',
  AUTH_SECRET: 'x'.repeat(32),
  ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
  SMTP_HOST: 'smtp.example.com',
};

describe('env', () => {
  it('makes SMTP_FROM optional', () => {
    expect(resolveMailFrom('TripShare', undefined, 'bot@example.com', 'trip.example.com')).toBe(
      '"TripShare" <bot@example.com>',
    );
    expect(resolveMailFrom('TripShare', undefined, 'bot', 'trip.example.com')).toBe(
      '"TripShare" <noreply@trip.example.com>',
    );
    expect(resolveMailFrom('TripShare', 'Viaggi <v@example.com>', 'bot', 'x')).toBe(
      'Viaggi <v@example.com>',
    );
  });

  it('derives SMTP settings', () => {
    const env = loadEnv({ ...base, SMTP_PORT: '465', SMTP_USER: '', SMTP_FROM: '' });
    expect(env.smtp.secure).toBe(true);
    expect(env.smtp.auth).toBeUndefined();
    expect(env.smtp.from).toBe('"TripShare" <noreply@trip.example.com>');
    expect(loadEnv({ ...base, SMTP_USER: 'u@example.com', SMTP_PASSWORD: 'p' }).smtp).toMatchObject(
      {
        port: 587,
        secure: false,
        auth: { user: 'u@example.com', pass: 'p' },
      },
    );
  });

  it('reports invalid configuration', () => {
    expect(() => loadEnv({ ...base, SMTP_HOST: undefined, AUTH_SECRET: 'short' })).toThrow(
      /SMTP_HOST[\s\S]*AUTH_SECRET|AUTH_SECRET[\s\S]*SMTP_HOST/,
    );
  });
});

describe('crypto', () => {
  it('round-trips and masks secrets', () => {
    const key = Buffer.alloc(32, 7).toString('base64');
    const enc = encrypt('sk-or-v1-abcdef123456', key);
    expect(enc.data).not.toContain('sk-or');
    expect(decrypt(enc, key)).toBe('sk-or-v1-abcdef123456');
    expect(maskSecret('sk-or-v1-abcdef123456')).toBe('sk-or-…3456');
  });
});

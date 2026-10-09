import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export interface EncryptedValue {
  v: 1;
  iv: string;
  tag: string;
  data: string;
}

/** Cifra un testo con AES-256-GCM. `key` è ENCRYPTION_KEY in base64 (32 byte). */
export function encrypt(plain: string, key: string): EncryptedValue {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(key, 'base64'), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return {
    v: 1,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  };
}

export function decrypt(value: EncryptedValue, key: string): string {
  const decipher = createDecipheriv(
    'aes-256-gcm',
    Buffer.from(key, 'base64'),
    Buffer.from(value.iv, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(value.tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(value.data, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

/** Mostra solo l'inizio e la fine di un segreto, es. "sk-or-…a1b2". */
export function maskSecret(secret: string): string {
  if (secret.length <= 10) return '••••';
  return `${secret.slice(0, 6)}…${secret.slice(-4)}`;
}

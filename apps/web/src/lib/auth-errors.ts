import type { TFunction } from 'i18next';

/** Traduce l'errore restituito da Better Auth (codice o stato HTTP) in un messaggio per l'utente. */
export function authErrorMessage(
  t: TFunction,
  error: { code?: string; status?: number; message?: string } | null | undefined,
) {
  if (!error) return t('common.error');
  const code =
    error.code === 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL' ? 'USER_ALREADY_EXISTS' : error.code;
  if (code) {
    const key = `auth.errors.${code}`;
    const translated = t(key);
    if (translated !== key) return translated;
  }
  if (error.status === 429) return t('auth.errors.TOO_MANY_REQUESTS');
  return error.message || t('common.error');
}

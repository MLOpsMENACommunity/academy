import type { Translate } from '@/i18n/translator';
import { ApiError } from './api';

/** Friendly, translated message for an API error. */
export function errorMessage(err: unknown, t: Translate): string {
  if (err instanceof ApiError) {
    if (err.status === 429) return t('auth.errors.rateLimited');
    if (err.status === 0) return t('errors.network');
    if (err.code) {
      const key = `auth.errors.${err.code}`;
      const msg = t(key);
      if (msg !== key) return msg;
    }
    // Field validation: the API's messages are the shared schemas' English ones (e.g. "Validation
    // failed"); forms show their own translated field errors, so say which fields in the UI language.
    if (err.errors.length) return t('forms.fixErrors');
    if (err.status < 500 && err.message) return err.message;
  }
  return t('errors.generic');
}

/**
 * The message for a login page `?error=` code (Google sign-in failures). The code comes from the
 * URL, so anything unknown gets the generic Google failure, never a raw translation key.
 */
export function loginErrorMessage(code: string, t: Translate): string {
  const key = `auth.errors.${code}`;
  const msg = /^[A-Za-z_]{1,40}$/.test(code) ? t(key) : key;
  return msg === key ? t('auth.errors.google_failed') : msg;
}

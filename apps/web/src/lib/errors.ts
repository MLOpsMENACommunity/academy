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
    if (err.status < 500 && err.message) return err.message;
  }
  return t('errors.generic');
}

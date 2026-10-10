import type { Translate } from '@/i18n/translator';
import { ApiError } from '@/lib/api';
import { errorMessage } from '@/lib/errors';

/** A translated message for an assessments API error (its `code`), else the generic one. */
export function assessmentError(err: unknown, t: Translate): string {
  if (err instanceof ApiError && err.code) {
    const key = `assessments.errors.${err.code}`;
    if (t(key) !== key) return t(key);
  }
  return errorMessage(err, t);
}

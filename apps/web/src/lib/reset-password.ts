import { resetPasswordSchema } from '@academy/shared';
import { ApiError } from './api';

/**
 * Whether a reset link's token can possibly be valid (same rule as the API), so a
 * missing, truncated or mangled link shows "request a new link" instead of a form
 * that can only fail with the API's raw "String must contain at least 20 character(s)".
 */
export function resetTokenLooksValid(token: string | null | undefined): boolean {
  return resetPasswordSchema.shape.token.safeParse(token ?? '').success;
}

/** An API error meaning the link itself is dead (unknown, used or expired token, or a malformed one). */
export function isInvalidTokenError(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false;
  return err.code === 'TOKEN_INVALID' || err.errors.some((e) => e.path === 'token');
}

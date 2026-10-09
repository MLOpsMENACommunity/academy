import { describe, expect, it } from 'vitest';
import { ApiError } from './api';
import { isInvalidTokenError, resetTokenLooksValid } from './reset-password';

describe('reset-password links', () => {
  it('only offers the form for a token the API could accept', () => {
    expect(resetTokenLooksValid('a'.repeat(43))).toBe(true);
    for (const bad of [null, undefined, '', 'short', 'x'.repeat(19), 'x'.repeat(201)]) expect(resetTokenLooksValid(bad)).toBe(false);
  });

  it('treats a dead or malformed token as an invalid link, not a form error', () => {
    expect(isInvalidTokenError(new ApiError(400, 'TOKEN_INVALID', 'This link is invalid or has expired'))).toBe(true);
    expect(
      isInvalidTokenError(new ApiError(400, undefined, 'Validation failed', [{ path: 'token', message: 'String must contain at least 20 character(s)' }])),
    ).toBe(true);
    expect(isInvalidTokenError(new ApiError(400, undefined, 'Validation failed', [{ path: 'password', message: 'too short' }]))).toBe(false);
    expect(isInvalidTokenError(new ApiError(429, undefined, 'Too many requests'))).toBe(false);
    expect(isInvalidTokenError(new Error('x'))).toBe(false);
  });
});

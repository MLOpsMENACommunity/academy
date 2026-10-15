import { describe, expect, it } from 'vitest';
import { createTranslator } from '@/i18n/translator';
import { ApiError } from './api';
import { errorMessage } from './errors';

describe('errorMessage', () => {
  const ar = createTranslator('ar');
  const en = createTranslator('en');

  it('never shows the API\'s English "Validation failed": field errors become "fix the highlighted fields"', () => {
    const err = new ApiError(400, undefined, 'Validation failed', [{ path: 'email', message: 'Invalid email' }]);
    expect(errorMessage(err, en)).toBe(en('forms.fixErrors'));
    expect(errorMessage(err, ar)).toBe(ar('forms.fixErrors'));
    expect(errorMessage(err, ar)).not.toMatch(/Validation failed/);
  });

  it('translates known codes first, and keeps a message the API wrote for people', () => {
    expect(errorMessage(new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid email or password'), ar)).toBe(ar('auth.errors.INVALID_CREDENTIALS'));
    expect(errorMessage(new ApiError(404, undefined, 'Course not found'), en)).toBe('Course not found');
    expect(errorMessage(new ApiError(500, undefined, 'Internal server error'), en)).toBe(en('errors.generic'));
  });
});

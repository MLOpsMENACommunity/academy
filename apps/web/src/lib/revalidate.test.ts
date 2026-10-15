import { describe, expect, it } from 'vitest';
import { revalidateTokenMatches } from './revalidate';

describe('revalidateTokenMatches', () => {
  const token = 't'.repeat(40);
  it('accepts only the exact secret', () => {
    expect(revalidateTokenMatches(token, token)).toBe(true);
    expect(revalidateTokenMatches(`${token}x`, token)).toBe(false);
    expect(revalidateTokenMatches(token.slice(1), token)).toBe(false);
    expect(revalidateTokenMatches(null, token)).toBe(false);
    expect(revalidateTokenMatches('', token)).toBe(false);
  });
  it('never matches when the secret is unset or too short', () => {
    expect(revalidateTokenMatches('', undefined)).toBe(false);
    expect(revalidateTokenMatches('short', 'short')).toBe(false);
  });
});

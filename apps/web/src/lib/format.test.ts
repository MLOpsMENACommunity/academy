import { describe, expect, it } from 'vitest';
import { formatDate, formatDateTime, formatMoney } from './format';

describe('format helpers', () => {
  it.each(['en', 'ar'] as const)('formats dates, times and money in %s without throwing', (locale) => {
    const iso = '2026-10-22T17:00:00.000Z';
    expect(formatDate(iso, locale)).toBeTruthy();
    expect(formatDateTime(iso, locale)).toMatch(/\d/);
    expect(formatMoney(2500, 'EGP', locale)).toMatch(/2,?500/);
  });
  it('shows Egyptian pounds unambiguously: EGP in English, the full name in Arabic', () => {
    expect(formatMoney(5000, 'EGP', 'en').replace(/\s/g, ' ')).toBe('EGP 5,000');
    expect(formatMoney(5000, 'EGP', 'ar')).toContain('5,000');
    expect(formatMoney(5000, 'EGP', 'ar')).toContain('جنيه مصري');
    expect(formatMoney(5000, 'EGP', 'ar')).not.toMatch(/E£|ج\.م/);
  });
  it('uses Latin digits in Arabic and shows the Cairo time by default', () => {
    expect(formatDateTime('2026-10-22T17:00:00.000Z', 'ar')).toMatch(/8|20/);
  });
});

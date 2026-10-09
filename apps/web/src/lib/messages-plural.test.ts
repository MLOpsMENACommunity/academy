import { describe, expect, it } from 'vitest';
import { createTranslator } from '@/i18n/translator';

describe('counted text for the new pages (ICU plurals)', () => {
  it('uses the English one/other forms', () => {
    const t = createTranslator('en');
    expect(t('paths.stepCount', { count: 1 })).toBe('1 step');
    expect(t('paths.stepCount', { count: 5 })).toBe('5 steps');
  });
  it('uses the Arabic two, few and many forms', () => {
    const t = createTranslator('ar');
    expect(t('paths.stepCount', { count: 2 })).toBe('خطوتان');
    expect(t('paths.stepCount', { count: 5 })).toBe('5 خطوات');
    expect(t('paths.stepCount', { count: 11 })).toBe('11 خطوة');
    expect(t('menu.courseCount', { count: 4 })).toBe('4 دورات');
  });
});

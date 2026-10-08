import { coreSectionSchema, eventInputSchema } from '@academy/shared';
import { describe, expect, it } from 'vitest';
import { createTranslator } from '@/i18n/translator';
import { issuesToErrors } from './zod-errors';

describe('issuesToErrors', () => {
  it('translates shared-schema errors into Arabic', () => {
    const r = coreSectionSchema.safeParse({ fullNameEn: '', phone: '0100', googleEmail: 'nope', acceptTerms: false });
    expect(r.success).toBe(false);
    const errors = issuesToErrors(r.error!.issues, createTranslator('ar'));
    expect(errors.googleEmail).toBe('أدخل بريدًا إلكترونيًا صحيحًا.');
    expect(errors.acceptTerms).toBe('يجب الموافقة للمتابعة.');
    expect(errors.phone).toContain('الصيغة الدولية');
    expect(errors.country).toBe('هذا الحقل مطلوب.');
    // No English leaks through.
    for (const msg of Object.values(errors)) expect(msg).not.toMatch(/\b(Enter|Choose|Required|must)\b/i);
  });

  it('explains what a session needs before it can be published', () => {
    const r = eventInputSchema.safeParse({
      slug: 'ama',
      status: 'PUBLISHED',
      titleEn: 'AMA',
      titleAr: '',
      startsAt: '2026-11-01T17:00:00Z',
      durationMin: 60,
      language: 'EN',
      platform: 'GOOGLE_MEET',
      liveUrl: '',
    });
    const errors = issuesToErrors(r.error!.issues, createTranslator('en'));
    expect(errors.liveUrl).toBe('Add the live link before publishing.');
    expect(errors.titleAr).toContain('goes public');
  });
});

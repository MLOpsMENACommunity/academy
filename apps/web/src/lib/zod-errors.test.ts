import { coreSectionSchema } from '@academy/shared';
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
});

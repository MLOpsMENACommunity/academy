import { describe, expect, it } from 'vitest';
import { configuredPaymentMethods, paymentsConfigured } from './payment';
import { DEFAULT_SETTINGS, publicContact, realValue, settingsSchema, whatsappUrl } from './settings';
import { courseInterestSchema, waitlistTokenSchema } from './waitlist';

describe('settings defaults', () => {
  it('ship no placeholders: everything that needs a real value starts empty', () => {
    expect(JSON.stringify(DEFAULT_SETTINGS)).not.toContain('PLACEHOLDER');
    expect(DEFAULT_SETTINGS.supportEmail).toBe('');
    expect(DEFAULT_SETTINGS.supportWhatsapp).toBe('');
    expect(paymentsConfigured(DEFAULT_SETTINGS)).toBe(false);
  });

  it('accepts an empty or a real support email, and validates WhatsApp numbers', () => {
    expect(settingsSchema.shape.supportEmail.parse('')).toBe('');
    expect(settingsSchema.shape.supportEmail.parse(' Hello@Example.com ')).toBe('hello@example.com');
    expect(settingsSchema.shape.supportEmail.safeParse('nope').success).toBe(false);
    expect(settingsSchema.shape.supportWhatsapp.parse('+20 100 123 4567')).toBe('+20 100 123 4567');
    expect(settingsSchema.shape.supportWhatsapp.safeParse('[PLACEHOLDER] +20 1xx').success).toBe(false);
  });
});

describe('public contact', () => {
  it('hides unset values, old placeholders and the academy addresses that have no inbox', () => {
    expect(realValue('[PLACEHOLDER] +20 1xx xxx xxxx')).toBe('');
    expect(publicContact({ supportEmail: 'academy@mlopsmena.com', supportWhatsapp: '' })).toEqual({ supportEmail: '', supportWhatsapp: '' });
    expect(publicContact({ supportEmail: 'help@example.com', supportWhatsapp: '+201001234567' })).toEqual({
      supportEmail: 'help@example.com',
      supportWhatsapp: '+201001234567',
    });
    expect(whatsappUrl('+20 100 123-4567')).toBe('https://wa.me/201001234567');
  });

  it('offers only payment methods with real details', () => {
    expect(configuredPaymentMethods({ instapayHandle: '[PLACEHOLDER]@instapay', vodafoneCashNumber: '01000000000' })).toEqual(['VODAFONE_CASH']);
    expect(configuredPaymentMethods({ instapayHandle: 'academy@instapay', vodafoneCashNumber: '' })).toEqual(['INSTAPAY']);
  });
});

describe('waiting list inputs', () => {
  it('normalises the email and keeps the honeypot field', () => {
    expect(courseInterestSchema.parse({ email: ' A@B.co ', website: 'x' })).toEqual({ email: 'a@b.co', website: 'x' });
    expect(courseInterestSchema.safeParse({ email: 'nope' }).success).toBe(false);
  });

  it('only accepts well-formed leave tokens', () => {
    expect(waitlistTokenSchema.safeParse({ token: 'cm1abcdefghij.' + 'a'.repeat(43) }).success).toBe(true);
    expect(waitlistTokenSchema.safeParse({ token: 'garbage' }).success).toBe(false);
  });
});

import type { ZodIssue } from 'zod';
import type { Translate } from '@/i18n/translator';

/**
 * Turns zod issues (English, from the shared schemas) into messages in the
 * viewer's language, keyed by field path. The API returns the same English
 * messages; forms always validate client-side first, so users see these.
 */
export function issuesToErrors(issues: ZodIssue[], t: Translate): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of issues) {
    const key = i.path.join('.');
    if (out[key]) continue;
    out[key] = translateIssue(i, t);
  }
  return out;
}

function translateIssue(i: ZodIssue, t: Translate): string {
  switch (i.code) {
    case 'invalid_type':
      return i.received === 'undefined' || i.received === 'null' ? t('forms.errors.required') : t('forms.errors.invalid');
    case 'too_small':
      if (i.type === 'string' && i.minimum === 1) return t('forms.errors.required');
      if (i.type === 'array') return t('forms.errors.chooseOne');
      if (i.type === 'string') return t('forms.errors.tooShort', { min: Number(i.minimum) });
      return t('forms.errors.invalid');
    case 'too_big':
      return i.type === 'string' ? t('forms.errors.tooLong', { max: Number(i.maximum) }) : t('forms.errors.invalid');
    case 'invalid_string':
      if (i.validation === 'email') return t('forms.errors.email');
      if (i.validation === 'url' || i.message.includes('http(s)')) return t('forms.errors.url');
      return t('forms.errors.invalid');
    case 'invalid_enum_value':
      return t('forms.errors.choose');
    case 'invalid_literal':
      return t('forms.errors.mustAccept');
    case 'custom': {
      const m = i.message.toLowerCase();
      if (m.includes('live link')) return t('forms.errors.liveLinkToPublish');
      if (m.includes('to publish')) return t('forms.errors.arabicToPublish');
      if (m.includes('required') || m.includes('choose at least')) return t('forms.errors.required');
      if (m.includes('drive.google.com')) return t('forms.errors.driveUrl');
      if (m.includes('linkedin.com')) return t('forms.errors.linkedinUrl');
      if (m.includes('github.com')) return t('forms.errors.githubUrl');
      if (m.includes('price')) return t('forms.errors.price');
      if (m.includes('url')) return t('forms.errors.url');
      if (m.includes('international') || m.includes('phone')) return t('forms.errors.phone');
      if (m.includes('timezone')) return t('forms.errors.choose');
      if (m.includes('option')) return t('forms.errors.choose');
      return t('forms.errors.invalid');
    }
    default:
      return t('forms.errors.invalid');
  }
}

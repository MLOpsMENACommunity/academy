import type { Locale } from '@academy/shared';

/**
 * The business details shown on the Contact and About pages (payment providers such as Paymob
 * require an email address, a phone number and the business location on the site). One place
 * to edit them.
 */
export const BUSINESS_DETAILS = {
  email: 'hello@mlopsmena.com',
  phone: '+20 128 814 9179',
  phoneIsPlaceholder: false,
  location: { en: 'Cairo, Egypt', ar: 'القاهرة، مصر' } satisfies Record<Locale, string>,
  legalName: 'MLOps MENA Community',
} as const;

/** The phone number as a tel: link target (digits and a leading +). */
export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, '')}`;
}

import type { Locale } from '@academy/shared';

/**
 * The business details shown on the Contact and About pages (payment providers such as Paymob
 * require an email address, a phone number and the business location on the site). One place
 * to edit them.
 *
 * TODO: `phone` is a placeholder. Replace it with the academy's real phone number and set
 * `phoneIsPlaceholder` to false.
 */
export const BUSINESS_DETAILS = {
  email: 'academy@mlopsmena.com',
  phone: '+20 100 000 0000',
  phoneIsPlaceholder: true,
  location: { en: 'Cairo, Egypt', ar: 'القاهرة، مصر' } satisfies Record<Locale, string>,
  legalName: 'MLOps MENA Community',
} as const;

/** The phone number as a tel: link target (digits and a leading +). */
export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, '')}`;
}

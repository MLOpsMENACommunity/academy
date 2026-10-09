import { z } from 'zod';

/**
 * A linkedin.com profile link, checked the way the student profile checks it: https, no
 * credentials, linkedin.com (or a country subdomain such as eg.linkedin.com), and a profile
 * path rather than the home page.
 *
 * Stored normalised: no query string or fragment, so links copied from the LinkedIn app
 * (`?utm_source=share&utm_medium=member_desktop…`) are stored clean. Null when it isn't one.
 */
export function normalizeLinkedinUrl(value: string): string | null {
  const v = value.trim();
  if (!/^https:\/\/[^\s]+\.[^\s]+$/i.test(v) || v.includes('\\')) return null;
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return null;
  if (host !== 'linkedin.com' && !host.endsWith('.linkedin.com')) return null;
  if (u.pathname.replace(/\/+$/, '').length <= 1) return null;
  u.search = '';
  u.hash = '';
  return u.href;
}

export const LINKEDIN_PROFILE_MESSAGE = 'Enter a linkedin.com profile link';

/** Required LinkedIn profile link (instructors and speakers), normalised. */
export const linkedinProfileUrlSchema = z
  .string({ required_error: 'Required', invalid_type_error: 'Required' })
  .trim()
  .min(1, 'Required')
  .max(300)
  .refine((v) => normalizeLinkedinUrl(v) !== null, { message: LINKEDIN_PROFILE_MESSAGE })
  .transform((v) => normalizeLinkedinUrl(v)!);

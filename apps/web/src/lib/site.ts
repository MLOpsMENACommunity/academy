export const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(/\/$/, '');

/**
 * Whether search engines may index this deployment: only production (set at build time by
 * deploy/cloudflare/configure-host.mjs). Staging, local stacks and dev builds are noindex.
 * Canonical and og:url links still use siteUrl: on staging they point at staging, never at
 * production, because staging content differs and noindex keeps it out of results anyway.
 */
export const indexable = process.env.NEXT_PUBLIC_ACADEMY_ENVIRONMENT === 'production';

export const community = {
  mainSite: 'https://mlopsmena.com',
  linkedin: 'https://www.linkedin.com/company/mlops-mena',
  youtube: 'https://www.youtube.com/@MLOpsMENACommunity',
  github: 'https://github.com/MLOpsMENACommunity',
  discord: 'https://discord.gg/eFrPegB8Gu',
  telegram: 'https://t.me/+YPhi9W3xykU2NWVk',
  x: 'https://x.com/MLOpsMENA',
};

/** The community blog on mlopsmena.com, in the reader's language. */
export const blogUrl = (locale: 'en' | 'ar') => `${community.mainSite}${locale === 'ar' ? '/ar' : ''}/articles`;

/** Absolute URL for a locale-prefixed path. */
export function absoluteUrl(path: string): string {
  return `${siteUrl}${path.startsWith('/') ? path : `/${path}`}`;
}

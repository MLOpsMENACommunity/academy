import type { MetadataRoute } from 'next';
import { indexable, siteUrl } from '@/lib/site';

/**
 * SEO-tool crawlers: they index the site for their own customers' reports and bring no
 * visitors, but each request can wake the web container (and through it the API and the
 * database), which is billed while awake. In two hours of October 2026 traffic, ibou and
 * Semrush alone made a quarter of all crawler requests. Search engines (Google, Bing) and AI
 * assistants are not on this list. They honour robots.txt; one that doesn't would need a
 * Cloudflare WAF rule instead.
 */
export const BLOCKED_CRAWLERS = ['SemrushBot', 'AhrefsBot', 'MJ12bot', 'DotBot', 'DataForSeoBot', 'BLEXBot', 'ibou'];

export default function robots(): MetadataRoute.Robots {
  // Staging and local builds: nothing may be indexed (the staging Worker also answers this itself).
  if (!indexable) return { rules: [{ userAgent: '*', disallow: '/' }] };
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/api/',
          ...['admin', 'dashboard', 'profile', 'learn', 'onboarding', 'teach'].flatMap((p) => [`/en/${p}`, `/ar/${p}`]),
          '/*/courses/*/apply',
          '/*/courses/*/notify',
        ],
      },
      { userAgent: BLOCKED_CRAWLERS, disallow: '/' },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}

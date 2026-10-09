import type { MetadataRoute } from 'next';
import { indexable, siteUrl } from '@/lib/site';

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
          ...['admin', 'dashboard', 'profile', 'learn', 'onboarding'].flatMap((p) => [`/en/${p}`, `/ar/${p}`]),
          '/*/courses/*/apply',
        ],
      },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}

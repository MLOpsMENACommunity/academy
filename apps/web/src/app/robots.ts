import type { MetadataRoute } from 'next';
import { siteUrl } from '@/lib/site';

export default function robots(): MetadataRoute.Robots {
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

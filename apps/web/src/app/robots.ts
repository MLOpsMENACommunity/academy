import type { MetadataRoute } from 'next';
import { siteUrl } from '@/lib/site';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/api/', '/en/admin', '/ar/admin', '/en/dashboard', '/ar/dashboard', '/en/profile', '/ar/profile', '/en/learn', '/ar/learn'],
      },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}

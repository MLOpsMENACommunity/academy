import type { MetadataRoute } from 'next';
import { POLICY_SLUGS } from '@/content/policies';
import { serverGet } from '@/lib/server-api';
import { absoluteUrl } from '@/lib/site';

// Built on request (the API isn't reachable at image build time), cached for an hour.
export const dynamic = 'force-dynamic';
export const revalidate = 3600;

function entry(path: string, lastModified?: Date | string, priority = 0.5): MetadataRoute.Sitemap {
  const languages = { en: absoluteUrl(`/en${path}`), ar: absoluteUrl(`/ar${path}`) };
  return (['en', 'ar'] as const).map((locale) => ({
    url: absoluteUrl(`/${locale}${path}`),
    lastModified: lastModified ? new Date(lastModified) : undefined,
    priority,
    alternates: { languages },
  }));
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const courses = (await serverGet<{ slug: string; updatedAt: string }[]>('/courses/slugs', 3600)) ?? [];
  return [
    ...entry('', undefined, 1),
    ...entry('/courses', undefined, 0.9),
    ...courses.flatMap((c) => entry(`/courses/${c.slug}`, c.updatedAt, 0.8)),
    ...POLICY_SLUGS.flatMap((s) => entry(`/${s}`, undefined, 0.2)),
  ];
}

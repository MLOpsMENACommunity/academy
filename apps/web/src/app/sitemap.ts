import type { MetadataRoute } from 'next';
import { POLICY_SLUGS } from '@/content/policies';
import { LEARNING_PATHS } from '@/lib/paths';
import { serverGet } from '@/lib/server-api';
import { absoluteUrl, indexable } from '@/lib/site';

// Built on request (the API isn't reachable at image build time). If the API is down
// the request fails rather than publishing a sitemap with every course missing.
export const dynamic = 'force-dynamic';

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
  // Not production (staging, local): an empty sitemap, so nothing points crawlers at these URLs.
  if (!indexable) return [];
  const courses = (await serverGet<{ slug: string; updatedAt: string }[]>('/courses/slugs', 3600)) ?? [];
  const events = (await serverGet<{ upcoming: { slug: string }[]; past: { slug: string }[] }>('/events', 3600)) ?? { upcoming: [], past: [] };
  // Every past session with a recording, not only the recent ones /events lists.
  const recordings = (await serverGet<{ items: { kind: string; path: string; startsAt: string }[] }>('/recordings', 3600))?.items ?? [];
  const speakers = (await serverGet<{ slug: string; updatedAt: string }[]>('/speakers', 3600)) ?? [];
  const pastPaths = [
    ...new Set([...events.past.map((e) => `/sessions/${e.slug}`), ...recordings.filter((r) => r.kind === 'event').map((r) => r.path)]),
  ];
  return [
    ...entry('', undefined, 1),
    ...entry('/courses', undefined, 0.9),
    ...courses.flatMap((c) => entry(`/courses/${c.slug}`, c.updatedAt, 0.8)),
    ...entry('/sessions', undefined, 0.8),
    ...events.upcoming.flatMap((e) => entry(`/sessions/${e.slug}`, undefined, 0.7)),
    ...entry('/sessions/recordings', undefined, 0.7),
    ...entry('/learning-paths', undefined, 0.7),
    ...LEARNING_PATHS.flatMap((p) => entry(`/learning-paths/${p.slug}`, undefined, 0.6)),
    ...entry('/speakers', undefined, 0.5),
    ...entry('/whats-new', undefined, 0.3),
    ...pastPaths.flatMap((p) => entry(p, undefined, 0.4)),
    ...speakers.flatMap((s) => entry(`/speakers/${s.slug}`, s.updatedAt, 0.4)),
    ...POLICY_SLUGS.flatMap((s) => entry(`/${s}`, undefined, 0.2)),
  ];
}

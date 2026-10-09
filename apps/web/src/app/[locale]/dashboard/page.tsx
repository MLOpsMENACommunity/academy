import type { CourseSummaryDto, RecordingsDto } from '@academy/shared';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { isLocale } from '@/i18n/config';
import { LEARNING_PATHS, resolveSteps } from '@/lib/paths';
import { serverGetOr } from '@/lib/server-api';
import { Dashboard, type CourseMeta, type DashboardPath } from './Dashboard';

export const metadata: Metadata = { robots: { index: false } };
export const revalidate = 300;

/**
 * The page shell carries only public data (course facts and learning paths, the same
 * for everyone); the student's own applications and progress load in the browser.
 */
export default async function DashboardPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const [courses, recordings] = await Promise.all([
    serverGetOr<CourseSummaryDto[]>('/courses', [], 300),
    serverGetOr<RecordingsDto>('/recordings', { items: [], topics: [] }, 300).then((r) => r.items),
  ]);
  const meta: Record<string, CourseMeta> = Object.fromEntries(
    courses.map((c) => [c.slug, { level: c.level, language: c.language, durationWeeks: c.durationWeeks, startDate: c.startDate, completed: c.completed }]),
  );
  const paths: DashboardPath[] = LEARNING_PATHS.map((p) => ({ slug: p.slug, title: p.title[locale], steps: resolveSteps(p, courses, recordings, locale) })).filter(
    (p) => p.steps.length > 0,
  );
  return <Dashboard courses={meta} paths={paths} />;
}

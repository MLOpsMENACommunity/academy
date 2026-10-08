import {
  catalogQuerySchema,
  COURSE_LANGUAGES,
  COURSE_LEVELS,
  courseAvailabilityLabels,
  courseLanguageLabels,
  courseLevelLabels,
  courseTypeLabels,
  type CourseSummaryDto,
  type Localized,
} from '@academy/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CourseCard } from '@/components/course/CourseCard';
import { buttonClass } from '@/components/ui/Button';
import { Container } from '@/components/ui/Container';
import { isLocale } from '@/i18n/config';
import { createTranslator } from '@/i18n/translator';
import { alternates } from '@/lib/seo';
import { serverGet } from '@/lib/server-api';

type Props = { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const t = createTranslator(locale);
  return {
    title: t('catalog.title'),
    description: t('catalog.metaDescription'),
    alternates: alternates(locale, '/courses'),
    openGraph: { title: t('catalog.title'), description: t('catalog.metaDescription') },
  };
}

export default async function CatalogPage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = createTranslator(locale);
  const raw = await searchParams;
  const parsed = catalogQuerySchema.safeParse(
    Object.fromEntries(Object.entries(raw).filter(([, v]) => typeof v === 'string' && v)),
  );
  const q = parsed.success ? parsed.data : {};
  const qs = new URLSearchParams(q as Record<string, string>).toString();
  const courses = (await serverGet<CourseSummaryDto[]>(`/courses${qs ? `?${qs}` : ''}`)) ?? [];
  const filtered = Object.keys(q).length > 0;

  const select = (name: string, label: string, values: readonly string[], labels: Record<string, Localized>) => (
    <label className="block text-sm">
      <span className="mb-1 block font-semibold text-fg">{label}</span>
      <select
        name={name}
        defaultValue={(q as Record<string, string>)[name] ?? ''}
        className="block min-h-11 w-full rounded-lg border border-line-strong bg-card px-3 text-base"
      >
        <option value="">{t('catalog.any')}</option>
        {values.map((v) => (
          <option key={v} value={v}>
            {labels[v]?.[locale] ?? v}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <Container className="py-10">
      <h1 className="text-3xl sm:text-4xl">{t('catalog.title')}</h1>
      <p className="mt-2 max-w-2xl text-muted">{t('catalog.subtitle')}</p>

      <form method="get" className="mt-8 rounded-card border border-line bg-card p-4" aria-label={t('catalog.filters')}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {select('availability', t('catalog.status'), ['OPEN', 'UPCOMING', 'CLOSED'], courseAvailabilityLabels)}
          {select('type', t('catalog.price'), ['FREE', 'PAID'], courseTypeLabels)}
          {select('level', t('catalog.level'), COURSE_LEVELS, courseLevelLabels)}
          {select('language', t('catalog.language'), COURSE_LANGUAGES, courseLanguageLabels)}
        </div>
        <div className="mt-3 flex gap-2">
          <button type="submit" className={buttonClass('primary', 'md')}>
            {t('catalog.apply')}
          </button>
          {filtered && (
            <Link href={`/${locale}/courses`} className={buttonClass('ghost', 'md')}>
              {t('catalog.reset')}
            </Link>
          )}
        </div>
      </form>

      <p className="mt-6 text-sm text-muted" role="status">
        {t('catalog.results', { count: courses.length })}
      </p>
      {courses.length === 0 ? (
        <p className="mt-6 rounded-card border border-dashed border-line-strong p-10 text-center text-muted">
          {filtered ? t('catalog.empty') : t('catalog.emptyAll')}
        </p>
      ) : (
        <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {courses.map((c) => (
            <li key={c.id} className="flex">
              <CourseCard course={c} locale={locale} />
            </li>
          ))}
        </ul>
      )}
    </Container>
  );
}

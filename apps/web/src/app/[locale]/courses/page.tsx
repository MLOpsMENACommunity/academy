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
import { inputClass } from '@/components/ui/input';
import { isLocale } from '@/i18n/config';
import { createTranslator } from '@/i18n/translator';
import { alternates } from '@/lib/seo';
import { serverGetOr } from '@/lib/server-api';

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
  const courses = await serverGetOr<CourseSummaryDto[]>(`/courses${qs ? `?${qs}` : ''}`, []);
  const filtered = Object.keys(q).length > 0;

  const select = (name: string, label: string, values: readonly string[], labels: Record<string, Localized>) => (
    <label className="block min-w-0 text-sm">
      <span className="mb-1.5 block font-medium text-fg">{label}</span>
      <select
        name={name}
        defaultValue={(q as Record<string, string>)[name] ?? ''}
        className={inputClass}
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
    <>
      <section className="border-b border-line bg-card">
        <Container className="py-10 sm:py-14">
          <h1 className="text-[2rem] sm:text-[2.5rem]">{t('catalog.title')}</h1>
          <p className="mt-3 max-w-2xl text-lg leading-relaxed text-muted">{t('catalog.subtitle')}</p>

          <form method="get" className="mt-8" aria-label={t('catalog.filters')}>
            <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-[repeat(4,minmax(0,1fr))_auto] lg:items-end">
              {select('availability', t('catalog.status'), ['OPEN', 'UPCOMING', 'CLOSED'], courseAvailabilityLabels)}
              {select('type', t('catalog.price'), ['FREE', 'PAID'], courseTypeLabels)}
              {select('level', t('catalog.level'), COURSE_LEVELS, courseLevelLabels)}
              {select('language', t('catalog.language'), COURSE_LANGUAGES, courseLanguageLabels)}
              <div className="col-span-2 flex flex-wrap gap-2 lg:col-span-1">
                <button type="submit" className={buttonClass('primary', 'md')}>
                  {t('catalog.apply')}
                </button>
                {filtered && (
                  <Link href={`/${locale}/courses`} className={buttonClass('ghost', 'md')}>
                    {t('catalog.reset')}
                  </Link>
                )}
              </div>
            </div>
          </form>
        </Container>
      </section>

      <Container className="py-10 sm:py-14">
        <p className="text-[0.9375rem] text-muted" role="status">
          {t('catalog.results', { count: courses.length })}
        </p>
        {courses.length === 0 ? (
          <p className="mt-5 rounded-card border border-dashed border-line-strong/50 p-10 text-center text-muted">
            {filtered ? t('catalog.empty') : t('catalog.emptyAll')}
          </p>
        ) : (
          <ul className="mt-5 grid gap-5 sm:gap-7 md:grid-cols-2">
            {courses.map((c) => (
              <li key={c.id} className="flex">
                <CourseCard course={c} locale={locale} />
              </li>
            ))}
          </ul>
        )}
      </Container>
    </>
  );
}

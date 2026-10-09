import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { courseAvailabilityLabels, type CourseSummaryDto } from '@academy/shared';
import Link from 'next/link';
import { CourseCard, priceLabel } from '@/components/course/CourseCard';
import { ButtonLink } from '@/components/ui/Button';
import { Container } from '@/components/ui/Container';
import { isLocale } from '@/i18n/config';
import { createTranslator } from '@/i18n/translator';
import { formatDate } from '@/lib/format';
import { alternates } from '@/lib/seo';
import { serverGet } from '@/lib/server-api';

export const revalidate = 300;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  return { alternates: alternates(locale, '') };
}

/** Small logo-colour markers for the "how it works" steps. */
const stepDots = ['bg-logo-cyan', 'bg-logo-green', 'bg-logo-orange'] as const;

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = createTranslator(locale);
  const steps = [1, 2, 3] as const;
  const [open, upcoming] = await Promise.all([
    // serverGet: an API failure fails the render instead of caching a home page without courses.
    serverGet<CourseSummaryDto[]>('/courses?availability=OPEN', 300).then((c) => c ?? []),
    serverGet<CourseSummaryDto[]>('/courses?availability=UPCOMING', 300).then((c) => c ?? []),
  ]);
  const courses = [...open, ...upcoming].slice(0, 4);
  const featured = open[0];

  return (
    <>
      <section className="on-dark bg-ink text-white">
        <Container className="flex flex-col gap-12 py-14 sm:py-20 lg:flex-row lg:items-center lg:gap-16 lg:py-24">
          <div className="flex min-w-0 flex-1 flex-col gap-5 sm:gap-6">
            <p className="text-sm text-on-dark-accent sm:text-[0.9375rem]">{t('home.eyebrow')}</p>
            <h1 className="max-w-3xl text-[1.875rem] leading-tight text-white sm:text-5xl sm:leading-[1.15]">{t('home.title')}</h1>
            <p className="max-w-xl text-lg leading-relaxed text-on-dark">{t('home.subtitle')}</p>
            <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <ButtonLink href={`/${locale}/courses`} variant="accent" size="lg">
                {t('home.browse')}
              </ButtonLink>
            </div>
          </div>
          {featured && (
            // Desktop only: on phones the same course leads the list right below the hero.
            <article className="on-light hidden w-full max-w-sm flex-col gap-4 rounded-card bg-card p-7 text-body lg:flex">
              <p className="flex items-center gap-2 text-sm font-medium text-primary">
                <span aria-hidden className="size-2 rounded-full bg-logo-green" />
                {courseAvailabilityLabels[featured.availability][locale]} · {priceLabel(featured, locale)}
              </p>
              <h2 className="text-2xl">{locale === 'ar' ? featured.titleAr : featured.titleEn}</h2>
              <p className="leading-relaxed text-muted">{locale === 'ar' ? featured.shortDescriptionAr : featured.shortDescriptionEn}</p>
              <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-2 text-[0.9375rem]">
                {featured.startDate && (
                  <>
                    <dt className="text-muted">{t('course.facts.start')}</dt>
                    <dd>{formatDate(featured.startDate, locale)}</dd>
                  </>
                )}
                {featured.durationWeeks ? (
                  <>
                    <dt className="text-muted">{t('course.facts.duration')}</dt>
                    <dd>{t('catalog.weeks', { count: featured.durationWeeks })}</dd>
                  </>
                ) : null}
                {featured.applicationDeadline && (
                  <>
                    <dt className="text-muted">{t('course.facts.deadline')}</dt>
                    <dd>{formatDate(featured.applicationDeadline, locale)}</dd>
                  </>
                )}
              </dl>
              <ButtonLink href={`/${locale}/courses/${featured.slug}`} variant="primary" size="lg" className="mt-1 w-full">
                {t('home.viewCourse')}
              </ButtonLink>
            </article>
          )}
        </Container>
      </section>

      {courses.length > 0 && (
        <section aria-labelledby="home-courses">
          <Container className="py-14 sm:py-20 lg:py-24">
            <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
              <h2 id="home-courses" className="text-2xl sm:text-[2rem]">
                {t('home.coursesTitle')}
              </h2>
              <Link href={`/${locale}/courses`} className="inline-flex min-h-11 items-center gap-1.5 font-medium text-fg hover:text-primary">
                {t('home.allCourses')}
                <span aria-hidden className="inline-block rtl:rotate-180">
                  →
                </span>
              </Link>
            </div>
            <ul className="mt-8 grid gap-5 sm:gap-7 md:grid-cols-2">
              {courses.map((c) => (
                <li key={c.id} className="flex">
                  <CourseCard course={c} locale={locale} headingLevel="h3" />
                </li>
              ))}
            </ul>
          </Container>
        </section>
      )}

      <section aria-labelledby="home-how" className="border-y border-line bg-card">
        <Container className="py-14 sm:py-20 lg:py-24">
          <h2 id="home-how" className="text-2xl sm:text-[2rem]">
            {t('home.howTitle')}
          </h2>
          <ol className="mt-8 grid gap-8 sm:mt-10 sm:grid-cols-3 sm:gap-10">
            {steps.map((n, i) => (
              <li key={n} className="flex flex-col gap-2.5">
                <span className="flex items-center gap-2.5 text-[0.9375rem] font-semibold text-primary">
                  <span aria-hidden className={`size-2 rounded-full ${stepDots[i]}`} />
                  {String(n).padStart(2, '0')}
                </span>
                <h3 className="text-lg">{t(`home.step${n}Title`)}</h3>
                <p className="leading-relaxed text-muted">{t(`home.step${n}Body`)}</p>
              </li>
            ))}
          </ol>
        </Container>
      </section>
    </>
  );
}

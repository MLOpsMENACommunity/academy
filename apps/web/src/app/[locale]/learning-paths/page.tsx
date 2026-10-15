import type { CourseSummaryDto, RecordingsDto } from '@academy/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PathProgressProvider } from '@/components/paths/PathProgress';
import { Stepper } from '@/components/paths/Stepper';
import { Container } from '@/components/ui/Container';
import { Arrow } from '@/components/ui/Icons';
import { isLocale } from '@/i18n/config';
import { createTranslator } from '@/i18n/translator';
import { LEARNING_PATHS, resolveSteps } from '@/lib/paths';
import { alternates, openGraph } from '@/lib/seo';
import { absoluteUrl } from '@/lib/site';
import { serverGet } from '@/lib/server-api';

type Props = { params: Promise<{ locale: string }> };

export const revalidate = 300;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const t = createTranslator(locale);
  return {
    title: t('paths.title'),
    description: t('paths.intro'),
    alternates: alternates(locale, '/learning-paths'),
    openGraph: openGraph(locale, { title: t('paths.title'), description: t('paths.intro'), url: absoluteUrl(`/${locale}/learning-paths`) }),
  };
}

export default async function LearningPathsPage({ params }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = createTranslator(locale);
  const [courses, recordings] = await Promise.all([
    serverGet<CourseSummaryDto[]>('/courses', 300).then((c) => c ?? []),
    serverGet<RecordingsDto>('/recordings', 300).then((r) => r?.items ?? []),
  ]);
  const paths = LEARNING_PATHS.map((p) => ({ path: p, steps: resolveSteps(p, courses, recordings, locale) })).filter((p) => p.steps.length > 0);
  const courseSlugs = paths.flatMap((p) => p.steps.filter((s) => s.kind === 'course').map((s) => s.slug));

  return (
    <PathProgressProvider courseSlugs={courseSlugs}>
      <section className="border-b border-line bg-muted-bg">
        <Container className="py-10 sm:py-14">
          <h1 className="text-[2rem] sm:text-[2.5rem]">{t('paths.title')}</h1>
          <p className="mt-3 max-w-2xl text-lg leading-relaxed text-muted">{t('paths.intro')}</p>
        </Container>
      </section>
      <Container className="py-10 sm:py-14">
        {paths.length === 0 ? (
          <p className="text-muted">{t('paths.noSteps')}</p>
        ) : (
          <ul className="flex flex-col gap-6">
            {paths.map(({ path, steps }) => (
              <li key={path.slug}>
                <article className="relative flex flex-col gap-6 overflow-hidden rounded-card border border-line bg-card">
                  <div aria-hidden className="h-1.5 bg-logo-green" />
                  <div className="flex flex-col gap-6 px-5 pb-6 sm:px-7 sm:pb-7">
                    <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
                      <div className="min-w-0 max-w-2xl">
                        <span className="rounded-md bg-success-soft px-2.5 py-0.5 text-[0.8125rem] font-medium text-success">
                          {t('paths.stepCount', { count: steps.length })}
                        </span>
                        <h2 className="mt-3 text-[1.375rem]">
                          <Link href={`/${locale}/learning-paths/${path.slug}`} className="hover:text-primary hover:underline">
                            {path.title[locale]}
                          </Link>
                        </h2>
                        <p className="mt-1 leading-relaxed text-muted">{path.summary[locale]}</p>
                      </div>
                      <Link
                        href={`/${locale}/learning-paths/${path.slug}`}
                        className="inline-flex min-h-11 items-center gap-1.5 font-medium text-primary hover:underline"
                        aria-label={`${t('paths.seePath')}: ${path.title[locale]}`}
                      >
                        {t('paths.seePath')} <Arrow />
                      </Link>
                    </div>
                    <Stepper steps={steps} locale={locale} size="sm" linked={false} />
                  </div>
                </article>
              </li>
            ))}
          </ul>
        )}
      </Container>
    </PathProgressProvider>
  );
}

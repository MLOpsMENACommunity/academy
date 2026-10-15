import type { CourseSummaryDto, Locale, RecordingsDto } from '@academy/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PathProgressCard, PathProgressProvider, StepPersonal } from '@/components/paths/PathProgress';
import { Stepper } from '@/components/paths/Stepper';
import { Container } from '@/components/ui/Container';
import { Arrow, IconExternal } from '@/components/ui/Icons';
import { isLocale } from '@/i18n/config';
import { createTranslator } from '@/i18n/translator';
import { durationLabel } from '@/lib/archive';
import { formatDate } from '@/lib/format';
import { jsonLd } from '@/lib/jsonld';
import { findPath, LEARNING_PATHS, resolveSteps, stepHref, type ResolvedStep } from '@/lib/paths';
import { alternates } from '@/lib/seo';
import { serverGet } from '@/lib/server-api';
import { absoluteUrl } from '@/lib/site';

type Props = { params: Promise<{ locale: string; slug: string }> };

// Static (ISR): the same HTML for everyone. A signed-in student's progress is added in the browser.
export const revalidate = 60;
// true, like every ISR page here: build-time renders are dropped (scripts/drop-isr-prerenders.mjs),
// so each path renders on its first request. Unknown slugs get notFound() below.
export const dynamicParams = true;
export function generateStaticParams() {
  return LEARNING_PATHS.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  const path = findPath(slug);
  if (!isLocale(locale) || !path) return {};
  return {
    title: path.title[locale],
    description: path.summary[locale],
    alternates: alternates(locale, `/learning-paths/${slug}`),
    openGraph: { title: path.title[locale], description: path.summary[locale] },
  };
}

const chip: Record<ResolvedStep['status'], string> = {
  open: 'bg-success-soft text-success',
  upcoming: 'bg-accent-soft text-accent',
  completed: 'bg-muted-bg text-body',
  closed: 'bg-muted-bg text-body',
  recording: 'bg-info-soft text-info',
};

export default async function LearningPathPage({ params }: Props) {
  const { locale, slug } = await params;
  const path = findPath(slug);
  if (!isLocale(locale) || !path) notFound();
  const loc: Locale = locale;
  const t = createTranslator(locale);
  // serverGet: an API failure fails the render (Next keeps the last good copy) instead of caching a path with no steps.
  const [courses, recordings] = await Promise.all([
    serverGet<CourseSummaryDto[]>('/courses').then((c) => c ?? []),
    serverGet<RecordingsDto>('/recordings').then((r) => r?.items ?? []),
  ]);
  const steps = resolveSteps(path, courses, recordings, locale);
  const courseSlugs = steps.filter((s) => s.kind === 'course').map((s) => s.slug);
  const titles = Object.fromEntries(steps.map((s) => [s.slug, s.title]));
  const others = LEARNING_PATHS.filter((p) => p.slug !== path.slug);
  const sep = locale === 'ar' ? '، ' : ', ';

  const structured = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: path.title[locale],
    description: path.summary[locale],
    itemListOrder: 'https://schema.org/ItemListOrderAscending',
    itemListElement: steps.map((s, i) => ({ '@type': 'ListItem', position: i + 1, name: s.title, url: s.external ? s.path : absoluteUrl(`/${locale}${s.path}`) })),
  };

  function line(s: ResolvedStep): string {
    if (s.kind === 'course') return [t('paths.kindCourse'), s.description].filter(Boolean).join(' · ');
    // Steps with their own badge (Live / Video) and description don't repeat the kind here.
    return [!s.format && t('paths.kindRecording'), s.date && formatDate(s.date, loc), s.durationMin && durationLabel(s.durationMin, loc)]
      .filter(Boolean)
      .join(' · ');
  }
  /** Speakers first, each linked to their speaker page when they have one, then the rest of the line. */
  function meta(s: ResolvedStep) {
    const rest = line(s);
    const people = s.speakers.flatMap((sp, i) => [
      ...(i > 0 ? [sep] : []),
      sp.slug ? (
        <Link key={sp.slug} href={`/${loc}/speakers/${sp.slug}`} className="text-body hover:text-primary hover:underline">
          {sp.name}
        </Link>
      ) : (
        <span key={`${sp.name}-${i}`}>{sp.name}</span>
      ),
    ]);
    return (
      <>
        {people}
        {people.length > 0 && rest && ' · '}
        {rest}
      </>
    );
  }
  function action(s: ResolvedStep): string {
    if (s.kind === 'video') return t('paths.watchYoutube');
    if (s.kind !== 'course') return t('paths.watch');
    if (s.status === 'open') return t('paths.apply');
    if (s.status === 'upcoming') return t('paths.notify');
    return t('catalog.viewCourse');
  }
  /** A link that leaves the site: new tab, announced to screen readers. */
  const out = { target: '_blank', rel: 'noopener noreferrer' } as const;

  return (
    <PathProgressProvider courseSlugs={courseSlugs}>
      {steps.length > 0 && <script type="application/ld+json" dangerouslySetInnerHTML={jsonLd(structured)} />}
      <section className="border-b border-line bg-muted-bg">
        <Container className="flex flex-col gap-8 pt-8 pb-10 sm:pt-12 sm:pb-14">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between lg:gap-10">
            <div className="flex min-w-0 flex-col gap-3">
              <nav aria-label={t('course.breadcrumbLabel')} className="text-sm text-muted">
                <Link href={`/${locale}/learning-paths`} className="inline-flex min-h-11 items-center text-primary hover:underline">
                  {t('menu.paths')}
                </Link>
                <span aria-hidden className="mx-2">
                  /
                </span>
                <span aria-current="page">{path.title[locale]}</span>
              </nav>
              <h1 className="text-[2rem] leading-tight sm:text-[2.75rem] sm:leading-[1.15]">{path.title[locale]}</h1>
              <p className="max-w-2xl text-lg leading-relaxed text-muted">{path.summary[locale]}</p>
            </div>
            <PathProgressCard courseSlugs={courseSlugs} titles={titles} />
          </div>
          {steps.length > 0 && (
            <div className="rounded-card border border-line bg-card p-5 sm:p-6 md:border-0 md:bg-transparent md:p-0">
              <h2 className="sr-only">{t('paths.roadmap')}</h2>
              <Stepper steps={steps} locale={locale} />
            </div>
          )}
        </Container>
      </section>

      <Container className="flex flex-col gap-12 py-12 sm:py-14 lg:flex-row lg:items-start lg:gap-12">
        <section aria-labelledby="steps" className="flex min-w-0 flex-1 flex-col gap-4">
          <h2 id="steps" className="text-[1.375rem]">
            {t('paths.stepsTitle')}
          </h2>
          {steps.length === 0 && <p className="text-muted">{t('paths.noSteps')}</p>}
          <ol className="flex flex-col gap-4">
            {steps.map((s, i) => (
              <li key={`${s.kind}:${s.slug}`} id={`step-${i + 1}`} className="scroll-mt-6">
                <article className="relative flex flex-col gap-3 rounded-card border border-line bg-card p-5 sm:px-6">
                  <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                    <span className="w-14 shrink-0 text-sm text-muted">{t('paths.stepN', { n: i + 1 })}</span>
                    <div className="min-w-0 flex-[1_1_18rem]">
                      <h3 className="text-base font-medium">
                        {s.external ? (
                          <a href={s.path} {...out} className="hover:text-primary hover:underline">
                            {s.title}
                            <span className="sr-only"> ({t('common.newTab')})</span>
                          </a>
                        ) : (
                          <Link href={stepHref(s, loc)} className="hover:text-primary hover:underline">
                            {s.title}
                          </Link>
                        )}
                      </h3>
                      <p className="line-clamp-2 text-sm text-muted">{meta(s)}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      {s.format ? (
                        <span className={`rounded-md px-2.5 py-0.5 text-[0.8125rem] font-medium ${s.format === 'live' ? 'bg-success-soft text-success' : 'bg-info-soft text-info'}`}>
                          {t(`paths.format.${s.format}`)}
                        </span>
                      ) : (
                        <span className={`rounded-md px-2.5 py-0.5 text-[0.8125rem] font-medium ${chip[s.status]}`}>{t(`paths.status.${s.status}`)}</span>
                      )}
                      <StepPersonal kind={s.kind} slug={s.slug} />
                      {s.external ? (
                        <a
                          href={s.path}
                          {...out}
                          className="inline-flex min-h-11 items-center gap-1 text-[0.9375rem] font-medium text-primary hover:underline"
                          aria-label={`${action(s)}: ${s.title} (${t('common.newTab')})`}
                        >
                          {action(s)} <IconExternal />
                        </a>
                      ) : (
                        <Link
                          href={stepHref(s, loc)}
                          className="inline-flex min-h-11 items-center gap-1 text-[0.9375rem] font-medium text-primary hover:underline"
                          aria-label={`${action(s)}: ${s.title}`}
                        >
                          {action(s)} <Arrow />
                        </Link>
                      )}
                    </div>
                  </div>
                  {s.format && s.description && <p className="text-[0.9375rem] leading-relaxed text-body sm:ps-[4.75rem]">{s.description}</p>}
                  {s.links.length > 0 && (
                    <ul className="flex flex-wrap gap-x-5 gap-y-1 text-sm sm:ps-[4.75rem]">
                      {s.links.map((l) => (
                        <li key={l.url + l.kind}>
                          <a href={l.url} {...out} className="inline-flex min-h-11 items-center gap-1.5 font-medium text-primary hover:underline sm:min-h-8">
                            {t(`paths.links.${l.kind}`)} <IconExternal />
                            <span className="sr-only">
                              {' '}
                              ({s.title}, {t('common.newTab')})
                            </span>
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}
                  <StepPersonal kind={s.kind} slug={s.slug} detailed />
                </article>
              </li>
            ))}
          </ol>
        </section>

        {others.length > 0 && (
          <aside aria-labelledby="other-paths" className="flex flex-col gap-3 rounded-card bg-muted-bg p-6 lg:w-80 lg:shrink-0">
            <h2 id="other-paths" className="text-base">
              {t('paths.otherPaths')}
            </h2>
            <ul className="flex flex-col gap-1">
              {others.map((p) => (
                <li key={p.slug}>
                  <Link href={`/${locale}/learning-paths/${p.slug}`} className="block rounded-lg py-2 hover:text-primary">
                    <span className="block font-medium text-fg">{p.title[locale]}</span>
                    <span className="block text-sm text-muted">{p.tagline[locale]}</span>
                  </Link>
                </li>
              ))}
            </ul>
            <Link href={`/${locale}/sessions/recordings`} className="inline-flex min-h-11 items-center gap-1.5 font-medium text-primary hover:underline">
              {t('sessions.browseRecordings')} <Arrow />
            </Link>
          </aside>
        )}
      </Container>
    </PathProgressProvider>
  );
}

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { CourseSummaryDto, Locale, PublicEventDto, RecordingsDto } from '@academy/shared';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { EventCard, PathCard, RecordingTile, SpeakerTile } from '@/components/catalog/cards';
import { SegmentedTabs } from '@/components/catalog/Segmented';
import { CourseCard } from '@/components/course/CourseCard';
import { RoadmapCard } from '@/components/roadmaps/RoadmapCard';
import { DateTile } from '@/components/sessions/SessionDate';
import { ButtonLink } from '@/components/ui/Button';
import { Container } from '@/components/ui/Container';
import { Arrow, IconCheck } from '@/components/ui/Icons';
import { isLocale } from '@/i18n/config';
import { createTranslator } from '@/i18n/translator';
import { LEARNING_PATHS, resolveSteps } from '@/lib/paths';
import { getRoadmaps, localizeRoadmap } from '@/lib/roadmaps';
import { alternates } from '@/lib/seo';
import { serverGet, serverGetOr } from '@/lib/server-api';
import { pick } from '@/lib/sessions';
import { loadSpeakers } from '@/lib/speakers';

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

const grid = 'grid gap-5 sm:grid-cols-2 lg:grid-cols-4';

function SeeAll({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="inline-flex min-h-11 items-center gap-1.5 font-medium text-primary hover:text-primary-hover hover:underline">
      {children} <Arrow />
    </Link>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-card border border-dashed border-line-strong/50 bg-card px-6 py-10 text-center text-muted">{children}</div>;
}

interface Upcoming {
  at: string;
  title: string;
  line: string;
  href: string;
}

/** The next dates people can act on: live sessions and application deadlines (ISR: re-checked every few minutes). */
function upcomingDates(courses: CourseSummaryDto[], events: PublicEventDto[], locale: Locale): Upcoming[] {
  const t = createTranslator(locale);
  const now = Date.now();
  const items: Upcoming[] = [
    ...events.map((e) => ({
      at: e.startsAt,
      title: pick(locale, e.titleEn, e.titleAr),
      line: [t('sessions.liveSession'), pick(locale, e.speakerName, e.speakerNameAr)].filter(Boolean).join(' · '),
      href: `/${locale}/sessions/${e.slug}`,
    })),
    ...courses
      .filter((c) => !c.completed && c.availability === 'OPEN' && c.applicationDeadline)
      .map((c) => ({
        at: c.applicationDeadline!,
        title: t('home.applicationsClose'),
        line: locale === 'ar' ? c.titleAr : c.titleEn,
        href: `/${locale}/courses/${c.slug}`,
      })),
    ...courses
      .filter((c) => !c.completed && c.availability !== 'CLOSED' && c.startDate)
      .map((c) => ({
        at: c.startDate!,
        title: t('home.courseStarts'),
        line: locale === 'ar' ? c.titleAr : c.titleEn,
        href: `/${locale}/courses/${c.slug}`,
      })),
  ];
  return items
    .filter((i) => new Date(i.at).getTime() > now)
    .sort((a, b) => a.at.localeCompare(b.at))
    .slice(0, 3);
}

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = createTranslator(locale);
  const [all, events, recordings, speakers] = await Promise.all([
    // serverGet: an API failure fails the render instead of caching a home page without courses.
    serverGet<CourseSummaryDto[]>('/courses', 300).then((c) => c ?? []),
    // The rest is optional: a section is left out rather than failing the page.
    serverGetOr<{ upcoming: PublicEventDto[] }>('/events', { upcoming: [] }, 300).then((e) => e.upcoming),
    serverGetOr<RecordingsDto>('/recordings', { items: [], topics: [], categories: [] }, 300).then((r) => r.items),
    loadSpeakers(6),
  ]);
  const rank = (c: CourseSummaryDto) => (c.completed ? 2 : c.availability === 'OPEN' ? 0 : c.availability === 'UPCOMING' ? 1 : 3);
  const courses = [...all].sort((a, b) => rank(a) - rank(b)).slice(0, 4);
  const paths = LEARNING_PATHS.map((p) => ({ path: p, steps: resolveSteps(p, all, recordings, locale) })).filter((p) => p.steps.length > 0);
  const roadmaps = getRoadmaps().map((r) => localizeRoadmap(r, locale));
  const dates = upcomingDates(all, events, locale);
  const trust = ['home.trust1', 'home.trust2', 'home.trust3'] as const;

  return (
    <>
      <section aria-labelledby="home-title">
        <Container className="flex flex-col gap-12 py-12 sm:py-20 lg:flex-row lg:items-center lg:gap-16 lg:py-24">
          <div className="flex min-w-0 flex-col lg:flex-[999_1_34rem] gap-5 sm:gap-6">
            <p className="text-sm font-medium text-primary sm:text-[0.9375rem]">{t('home.eyebrow')}</p>
            <h1 id="home-title" className="max-w-3xl text-[1.875rem] leading-tight sm:text-[3.25rem] sm:leading-[1.15] sm:tracking-[-0.01em]">
              {t('home.title')}
            </h1>
            <p className="max-w-xl text-lg leading-relaxed text-muted">{t('home.subtitle')}</p>
            <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <ButtonLink href={`/${locale}/courses`} variant="primary" size="lg">
                {t('home.browse')}
              </ButtonLink>
              <ButtonLink href={`/${locale}/sessions`} variant="secondary" size="lg">
                {t('home.joinLive')}
              </ButtonLink>
            </div>
            <ul className="mt-1 flex flex-col gap-2 text-[0.9375rem] text-body sm:flex-row sm:flex-wrap sm:gap-x-7">
              {trust.map((key) => (
                <li key={key} className="flex items-center gap-2">
                  <IconCheck size={16} className="shrink-0 text-success" />
                  {t(key)}
                </li>
              ))}
            </ul>
          </div>
          {dates.length > 0 && (
            <aside aria-labelledby="home-coming" className="min-w-0 overflow-hidden lg:flex-[1_1_20rem] rounded-card border border-line">
              <h2 id="home-coming" className="border-b border-line bg-muted-bg px-6 py-4 text-sm font-normal text-muted">
                {t('home.comingUp')}
              </h2>
              <ul>
                {dates.map((d) => (
                  <li key={d.href + d.at} className="relative flex gap-4 border-b border-line-soft px-6 py-5">
                    <DateTile iso={d.at} />
                    <div className="min-w-0">
                      <Link href={d.href} className="font-medium text-fg after:absolute after:inset-0 hover:text-primary">
                        {d.title}
                      </Link>
                      <p className="text-sm text-muted">{d.line}</p>
                    </div>
                  </li>
                ))}
              </ul>
              <Link href={`/${locale}/sessions`} className="flex min-h-12 items-center gap-1.5 px-6 font-medium text-primary hover:underline">
                {t('home.calendar')} <Arrow />
              </Link>
            </aside>
          )}
        </Container>
      </section>

      <section aria-labelledby="home-explore" className="bg-muted-bg">
        <Container className="py-14 sm:py-20 lg:py-22">
          <SegmentedTabs
            label={t('home.exploreTitle')}
            headerStart={
              <h2 id="home-explore" className="text-2xl sm:text-[2rem]">
                {t('home.exploreTitle')}
              </h2>
            }
            tabs={[
              {
                id: 'courses',
                label: t('nav.courses'),
                panel: (
                  <>
                    {courses.length ? (
                      <ul className={grid}>
                        {courses.map((c) => (
                          <li key={c.id} className="flex">
                            <CourseCard course={c} locale={locale} headingLevel="h3" />
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <Empty>{t('catalog.emptyAll')}</Empty>
                    )}
                    <div className="mt-6">
                      <SeeAll href={`/${locale}/courses`}>{t('home.allCourses')}</SeeAll>
                    </div>
                  </>
                ),
              },
              ...(paths.length
                ? [
                    {
                      id: 'paths',
                      label: t('menu.paths'),
                      panel: (
                        <>
                          <ul className={`grid gap-5 sm:grid-cols-2 lg:grid-cols-3`}>
                            {paths.map((p) => (
                              <li key={p.path.slug} className="flex">
                                <PathCard path={p.path} steps={p.steps} locale={locale} />
                              </li>
                            ))}
                          </ul>
                          <div className="mt-6">
                            <SeeAll href={`/${locale}/learning-paths`}>{t('menu.allPaths')}</SeeAll>
                          </div>
                        </>
                      ),
                    },
                  ]
                : []),
              ...(roadmaps.length
                ? [
                    {
                      id: 'roadmaps',
                      label: t('menu.roadmaps'),
                      panel: (
                        <>
                          <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                            {roadmaps.map((r) => (
                              <li key={r.slug} className="flex">
                                <RoadmapCard roadmap={r} locale={locale} />
                              </li>
                            ))}
                          </ul>
                          <div className="mt-6">
                            <SeeAll href={`/${locale}/roadmaps`}>{t('menu.allRoadmaps')}</SeeAll>
                          </div>
                        </>
                      ),
                    },
                  ]
                : []),
              {
                id: 'live',
                label: t('nav.sessions'),
                panel: (
                  <>
                    {events.length ? (
                      <ul className={grid}>
                        {events.slice(0, 4).map((e) => (
                          <li key={e.slug} className="flex">
                            <EventCard event={e} locale={locale} />
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <Empty>{t('sessions.empty')}</Empty>
                    )}
                    <div className="mt-6">
                      <SeeAll href={`/${locale}/sessions`}>{t('sessions.allSessions')}</SeeAll>
                    </div>
                  </>
                ),
              },
              ...(recordings.length
                ? [
                    {
                      id: 'recordings',
                      label: t('menu.recordings'),
                      panel: (
                        <>
                          <ul className={grid}>
                            {recordings.slice(0, 4).map((r) => (
                              <li key={r.id} className="flex">
                                <RecordingTile item={r} locale={locale} />
                              </li>
                            ))}
                          </ul>
                          <div className="mt-6">
                            <SeeAll href={`/${locale}/sessions/recordings`}>{t('sessions.browseRecordings')}</SeeAll>
                          </div>
                        </>
                      ),
                    },
                  ]
                : []),
            ]}
          />
        </Container>
      </section>

      {speakers.length > 0 && (
        <section aria-labelledby="home-speakers">
          <Container className="py-14 sm:py-20 lg:py-22">
            <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
              <div>
                <h2 id="home-speakers" className="text-2xl sm:text-[2rem]">
                  {t('home.speakersTitle')}
                </h2>
                <p className="mt-2 text-muted">{t('home.speakersBody')}</p>
              </div>
              <SeeAll href={`/${locale}/speakers`}>{t('home.allSpeakers')}</SeeAll>
            </div>
            <ul className="mt-8 grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-6 lg:gap-5">
              {speakers.map((s, i) => (
                <li key={s.slug} className="flex">
                  <SpeakerTile speaker={s} locale={locale} index={i} />
                </li>
              ))}
            </ul>
          </Container>
        </section>
      )}
    </>
  );
}

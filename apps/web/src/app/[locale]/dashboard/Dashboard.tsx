'use client';

import { PROFILE_REVIEW_DAYS, type MeResponse, type NextSessionDto } from '@academy/shared';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { MyCourses, type CourseMeta } from '@/components/applications/MyCourses';
import { StatusBadge } from '@/components/applications/StatusBadge';
import { RequireAuth } from '@/components/auth/RequireAuth';
import { SpeakerRedirect } from '@/components/auth/SpeakerRedirect';
import { MyCertificates } from '@/components/certificates/MyCertificates';
import { CalendarMenu } from '@/components/learn/CalendarMenu';
import { PathProgressFrom } from '@/components/paths/PathProgress';
import { PointsCard } from '@/components/points/PointsCard';
import { Stepper } from '@/components/paths/Stepper';
import { DateTile, DayTime } from '@/components/sessions/SessionDate';
import { MySessionsList, useMySessions } from '@/components/sessions/MySessions';
import { Alert } from '@/components/ui/Alert';
import { buttonClass } from '@/components/ui/Button';
import { Container } from '@/components/ui/Container';
import { Arrow } from '@/components/ui/Icons';
import { Progress } from '@/components/ui/Progress';
import { useI18n } from '@/i18n/client';
import { api } from '@/lib/api';
import type { ResolvedStep } from '@/lib/paths';
import { pick } from '@/lib/sessions';
import { blogUrl, community } from '@/lib/site';
import { isCompleted, useMyCourses, type CourseProgress } from '@/lib/use-progress';

export type { CourseMeta };
export interface DashboardPath {
  slug: string;
  title: string;
  steps: ResolvedStep[];
}

const card = 'rounded-card border border-line bg-card';

export function Dashboard({ courses, paths }: { courses: Record<string, CourseMeta>; paths: DashboardPath[] }) {
  return <RequireAuth>{(user) => (user.role === 'SPEAKER' ? <SpeakerRedirect /> : <Home user={user} courses={courses} paths={paths} />)}</RequireAuth>;
}

/** The soonest of my course sessions and my registered live sessions. */
function NextUp() {
  const { locale, t } = useI18n();
  const [course, setCourse] = useState<NextSessionDto[] | null>(null);
  const events = useMySessions();
  useEffect(() => {
    api<NextSessionDto[]>('/me/next-sessions').then(setCourse).catch(() => setCourse([]));
  }, []);
  if (!course || !events) return null;
  const now = Date.now();
  const options = [
    ...course.map((s) => ({
      at: s.startsAt,
      title: pick(locale, s.titleEn, s.titleAr),
      line: pick(locale, s.courseTitleEn, s.courseTitleAr),
      href: `/${locale}/learn/${s.courseSlug}`,
    })),
    ...events
      .filter((e) => e.status !== 'CANCELLED')
      .map((e) => ({ at: e.startsAt, title: pick(locale, e.titleEn, e.titleAr), line: t('sessions.liveSession'), href: `/${locale}/sessions/${e.slug}` })),
  ]
    .filter((o) => new Date(o.at).getTime() + 3 * 3_600_000 > now)
    .sort((a, b) => a.at.localeCompare(b.at));
  const next = options[0];
  if (!next) return null;
  return (
    <div className={`${card} relative flex flex-col gap-3 p-5`}>
      <p className="text-[0.8125rem] font-medium text-info">{t('dashboard.nextLive')}</p>
      <div className="flex gap-4">
        <div className="rounded-[10px] bg-muted-bg py-1.5">
          <DateTile iso={next.at} />
        </div>
        <div className="min-w-0">
          <Link href={next.href} className="font-medium text-fg after:absolute after:inset-0 hover:text-primary">
            {next.title}
          </Link>
          <p className="text-sm text-muted">
            {next.line} · <DayTime iso={next.at} />
          </p>
        </div>
      </div>
    </div>
  );
}

/** The learning path my enrolled courses belong to, as a stepper; otherwise a short list of paths to start. */
function Journey({ items, paths }: { items: CourseProgress[] | null; paths: DashboardPath[] }) {
  const { locale, t } = useI18n();
  if (!paths.length) return null;
  const enrolled = new Set((items ?? []).filter((p) => p.enrolled).map((p) => p.slug));
  const mine = paths.find((p) => p.steps.some((s) => s.kind === 'course' && enrolled.has(s.slug)));
  return (
    <section aria-labelledby="journey" className={`${card} flex flex-col gap-5 p-5 sm:p-7`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="journey" className="text-xl">
          {t('dashboard.journey')}
        </h2>
        {mine && (
          <Link href={`/${locale}/learning-paths/${mine.slug}`} className="inline-flex min-h-11 items-center gap-1.5 font-medium text-primary hover:underline">
            {mine.title} <Arrow />
          </Link>
        )}
      </div>
      {mine ? (
        <PathProgressFrom items={items} courseSlugs={mine.steps.filter((s) => s.kind === 'course').map((s) => s.slug)}>
          <Stepper steps={mine.steps} locale={locale} size="sm" linked={false} />
        </PathProgressFrom>
      ) : (
        <>
          <p className="text-muted">{t('dashboard.journeyEmpty')}</p>
          <ul className="grid gap-3 sm:grid-cols-2">
            {paths.map((p) => (
              <li key={p.slug}>
                <Link href={`/${locale}/learning-paths/${p.slug}`} className="flex min-h-11 flex-col rounded-[10px] border border-line px-4 py-3 hover:border-line-strong/50 hover:bg-hover-bg">
                  <span className="font-medium text-fg">{p.title}</span>
                  <span className="text-sm text-muted">{p.steps.map((s) => s.title).slice(0, 3).join(locale === 'ar' ? '، ' : ', ')}…</span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function Home({ user, courses, paths }: { user: MeResponse; courses: Record<string, CourseMeta>; paths: DashboardPath[] }) {
  const { locale, t } = useI18n();
  const { items, error } = useMyCourses();
  const stale = user.profile.updatedAt && Date.now() - new Date(user.profile.updatedAt).getTime() > PROFILE_REVIEW_DAYS * 86_400_000;
  const firstName = user.name?.split(' ')[0];
  const current = items?.find((p) => p.enrolled && !isCompleted(p));

  return (
    <div className="bg-muted-bg">
      <Container className="flex flex-col gap-7 py-8 sm:py-12 lg:flex-row lg:items-start">
        <aside className="flex flex-col gap-4 lg:w-80 lg:shrink-0">
          <div className={`${card} flex flex-col gap-1.5 p-6`}>
            <h1 className="text-[1.625rem]">{firstName ? t('dashboard.hello', { name: firstName }) : t('dashboard.helloAnon')}</h1>
            <p className="text-muted">
              {current ? t('dashboard.continueCourse', { course: pick(locale, current.course.titleEn, current.course.titleAr) }) : t('dashboard.welcomeBody')}
            </p>
          </div>

          <NextUp />

          <PointsCard className={card} />

          {!user.profile.coreComplete ? (
            <div className={`${card} flex flex-col gap-3 p-5`}>
              <h2 className="text-base">{t('dashboard.completeProfile')}</h2>
              <p className="text-sm text-muted">{t('dashboard.completeProfileBody')}</p>
              <Progress value={user.profile.completeness} label={t('profile.completeness', { percent: user.profile.completeness })} />
              <Link href={`/${locale}/onboarding`} className={buttonClass('primary', 'md')}>
                {t('dashboard.completeProfile')}
              </Link>
            </div>
          ) : (
            user.profile.completeness < 100 && (
              <div className={`${card} flex flex-col gap-3 p-5`}>
                <Progress value={user.profile.completeness} label={t('profile.completeness', { percent: user.profile.completeness })} />
                <Link href={`/${locale}/profile`} className="inline-flex min-h-11 items-center gap-1.5 self-start font-medium text-primary hover:underline">
                  {t('nav.profile')} <Arrow />
                </Link>
              </div>
            )
          )}

          {items && items.length > 0 && (
            <div className={`${card} flex flex-col gap-2 p-5`}>
              <h2 className="text-[0.8125rem] font-medium text-muted">{t('dashboard.myApplications')}</h2>
              <ul className="flex flex-col">
                {items.map((p) => (
                  <li key={p.applicationId}>
                    <Link
                      href={`/${locale}/dashboard/applications/${p.applicationId}`}
                      className="flex min-h-11 items-center justify-between gap-3 py-1.5 text-fg hover:text-primary"
                    >
                      <span className="min-w-0">{pick(locale, p.course.titleEn, p.course.titleAr)}</span>
                      <StatusBadge status={p.status} locale={locale} />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <nav aria-labelledby="dash-community" className={`${card} flex flex-col gap-1 p-5`}>
            <h2 id="dash-community" className="text-[0.8125rem] font-medium text-muted">
              {t('footer.community')}
            </h2>
            {(
              [
                ['Discord', community.discord],
                ['Telegram', community.telegram],
                [t('menu.blog'), blogUrl(locale)],
              ] as const
            ).map(([label, href]) => (
              <a key={href} href={href} target="_blank" rel="noopener noreferrer" className="flex min-h-11 items-center justify-between text-fg hover:text-primary">
                {label}
                <Arrow className="text-primary" />
              </a>
            ))}
          </nav>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col gap-7">
          {user.profile.coreComplete && user.profile.needsCommunityHandles && (
            <Alert tone="warning" title={t('profile.handlesBanner.title')}>
              {t('profile.handlesBanner.body')}{' '}
              <Link href={`/${locale}/profile?tab=community`} className="font-semibold underline">
                {t('profile.handlesBanner.cta')}
              </Link>
            </Alert>
          )}

          {stale && (
            <Alert tone="info" title={t('profile.reviewPrompt')}>
              <Link href={`/${locale}/profile`} className="font-semibold underline">
                {t('profile.review')}
              </Link>
            </Alert>
          )}

          <Journey items={items} paths={paths} />

          <MyCertificates />

          <MyCourses items={items} error={error} courses={courses} />

          <section aria-labelledby="my-sessions" className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-x-4">
              <h2 id="my-sessions" className="text-xl">
                {t('dashboard.mySessions')}
              </h2>
              <CalendarMenu align="end" />
            </div>
            <MySessionsList />
          </section>
        </div>
      </Container>
    </div>
  );
}

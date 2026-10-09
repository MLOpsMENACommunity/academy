'use client';

import Link from 'next/link';
import { createContext, useContext, type ReactNode } from 'react';
import { buttonClass } from '@/components/ui/Button';
import { IconCheck } from '@/components/ui/Icons';
import { useI18n } from '@/i18n/client';
import type { ResolvedStep } from '@/lib/paths';
import { isCompleted, useMyCourses, type CourseProgress } from '@/lib/use-progress';

/**
 * The signed-in student's progress on a learning path, added in the browser on top of
 * the cached page. Only course steps can be tracked (enrolment and sessions marked
 * done); recordings, course lessons and videos aren't, so a path shows no overall percentage and nothing personal
 * at all for visitors or students who haven't enrolled in any of its courses.
 */
const Ctx = createContext<Map<string, CourseProgress> | null>(null);

export function PathProgressProvider({ courseSlugs, children }: { courseSlugs: string[]; children: ReactNode }) {
  const { items } = useMyCourses();
  return (
    <PathProgressFrom items={items} courseSlugs={courseSlugs}>
      {children}
    </PathProgressFrom>
  );
}

/** Same, from progress the page already loaded (the dashboard). */
export function PathProgressFrom({ items, courseSlugs, children }: { items: CourseProgress[] | null; courseSlugs: string[]; children: ReactNode }) {
  const mine = items ? new Map(items.filter((p) => p.enrolled && courseSlugs.includes(p.slug)).map((p) => [p.slug, p])) : null;
  return <Ctx.Provider value={mine?.size ? mine : null}>{children}</Ctx.Provider>;
}

function useStep(kind: ResolvedStep['kind'], slug: string): CourseProgress | null {
  const mine = useContext(Ctx);
  return kind === 'course' ? (mine?.get(slug) ?? null) : null;
}

/** The stepper's circle: a green check when done, a cyan ring while in progress, otherwise the step number. */
export function StepMarker({ kind, slug, n, size = 'md' }: { kind: ResolvedStep['kind']; slug: string; n: number; size?: 'sm' | 'md' }) {
  const p = useStep(kind, slug);
  const dim = size === 'sm' ? 'size-7 text-[0.8125rem]' : 'size-9 text-[0.9375rem]';
  if (p && isCompleted(p)) {
    return (
      <span className={`grid ${dim} shrink-0 place-items-center rounded-full bg-logo-green text-white`}>
        <IconCheck size={size === 'sm' ? 14 : 16} strokeWidth={3} />
      </span>
    );
  }
  if (p) return <span className={`grid ${dim} shrink-0 place-items-center rounded-full border-[3px] border-logo-cyan bg-card font-semibold text-info`}>{n}</span>;
  return <span className={`grid ${dim} shrink-0 place-items-center rounded-full border-2 border-line-button bg-card text-muted`}>{n}</span>;
}

/** "Done" / "In progress · 3 of 6 sessions" for a course step the student is enrolled in; nothing otherwise. */
export function StepPersonal({ kind, slug, detailed }: { kind: ResolvedStep['kind']; slug: string; detailed?: boolean }) {
  const { locale, t } = useI18n();
  const p = useStep(kind, slug);
  if (!p) return null;
  if (!detailed) {
    return isCompleted(p) ? (
      <span className="rounded-md bg-success-soft px-2.5 py-0.5 text-[0.8125rem] font-medium text-success">{t('paths.done')}</span>
    ) : (
      <span className="rounded-md bg-info-soft px-2.5 py-0.5 text-[0.8125rem] font-medium text-info">{t('paths.inProgress')}</span>
    );
  }
  if (isCompleted(p) || !p.progress) return null;
  return (
    <div className="flex w-full flex-col gap-2.5 sm:ps-[4.75rem]">
      <div className="flex items-center gap-3">
        <div
          role="progressbar"
          aria-label={t('paths.courseProgress')}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={p.progress.percent}
          className="h-1.5 flex-1 overflow-hidden rounded-full bg-track"
        >
          <div className="h-full rounded-full bg-logo-cyan" style={{ width: `${p.progress.percent}%` }} />
        </div>
        <span className="text-sm text-body">{t('learn.progress', { completed: p.progress.completed, total: p.progress.total })}</span>
      </div>
      <Link href={`/${locale}/learn/${p.slug}${p.nextSession ? `#session-${p.nextSession.order}` : ''}`} className="inline-flex min-h-11 items-center self-start font-medium text-primary hover:underline">
        {p.nextSession
          ? t('paths.resume', { n: p.nextSession.order, title: locale === 'ar' ? p.nextSession.titleAr : p.nextSession.titleEn })
          : t('applications.goToCourse')}
      </Link>
    </div>
  );
}

/** Status text under a stepper circle: the student's own state when known, else the public one (server-rendered). */
export function StepStatusText({ kind, slug, children }: { kind: ResolvedStep['kind']; slug: string; children: ReactNode }) {
  const { t } = useI18n();
  const p = useStep(kind, slug);
  if (p && isCompleted(p)) return <span className="text-success">{t('paths.done')}</span>;
  if (p) return <span className="text-info">{t('paths.inProgress')}</span>;
  return <>{children}</>;
}

/** The band's side card: my courses on this path and a way back in. Hidden when there's nothing of mine. */
export function PathProgressCard({ courseSlugs, titles }: { courseSlugs: string[]; titles: Record<string, string> }) {
  const { locale, t } = useI18n();
  const mine = useContext(Ctx);
  if (!mine) return null;
  const list = courseSlugs.map((s) => mine.get(s)).filter((p): p is CourseProgress => Boolean(p));
  const done = list.filter(isCompleted).length;
  const current = list.find((p) => !isCompleted(p));
  return (
    <div className="flex w-full flex-col gap-3 rounded-card border border-line bg-card p-5 lg:w-80">
      <p className="text-sm font-medium text-info">{t('paths.yourProgress')}</p>
      <p className="text-body">{t('paths.coursesDone', { done, total: courseSlugs.length })}</p>
      {current?.progress && (
        <>
          <div
            role="progressbar"
            aria-label={titles[current.slug]}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={current.progress.percent}
            className="h-2 overflow-hidden rounded-full bg-track"
          >
            <div className="h-full rounded-full bg-logo-cyan" style={{ width: `${current.progress.percent}%` }} />
          </div>
          <p className="text-sm text-muted">
            {titles[current.slug]} · {t('learn.progress', { completed: current.progress.completed, total: current.progress.total })}
          </p>
        </>
      )}
      {current && (
        <Link href={`/${locale}/learn/${current.slug}`} className={buttonClass('primary', 'md', 'w-full')}>
          {t('paths.continue', { title: titles[current.slug] ?? '' })}
        </Link>
      )}
    </div>
  );
}

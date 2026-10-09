import type { CourseSummaryDto, Locale } from '@academy/shared';
import { createTranslator } from '@/i18n/translator';
import { formatDate } from '@/lib/format';

/**
 * Public data for the header menus, built on the server from the course list (the
 * same for every visitor, so cached pages stay shareable). Personal state (who is
 * signed in) is never in here: the header loads it in the browser.
 */
export interface FeaturedCourse {
  href: string;
  title: string;
  line: string;
  tone: 'success' | 'accent' | 'muted';
}

/** An open-source roadmap in the Learn menu (static: read from the Markdown at build time). */
export interface MenuRoadmap {
  href: string;
  title: string;
  tagline: string;
  /** "Beginner → Job-ready · 6–9 months" */
  line: string;
}

export interface MenuData {
  /** "4 courses · 1 taking applications"; null when the list couldn't be loaded. */
  coursesLine: string | null;
  featured: FeaturedCourse[];
  roadmaps: MenuRoadmap[];
}

/** `roadmaps`: already in the reader's language (lib/roadmaps localizeRoadmap). */
export function buildMenuData(
  courses: CourseSummaryDto[] | null,
  locale: Locale,
  roadmaps: { slug: string; title: string; tagline: string; level: string; duration: string }[] = [],
): MenuData {
  const menuRoadmaps = roadmaps.map((r) => ({ href: `/${locale}/roadmaps/${r.slug}`, title: r.title, tagline: r.tagline, line: `${r.level} · ${r.duration}` }));
  if (!courses?.length) return { coursesLine: null, featured: [], roadmaps: menuRoadmaps };
  const t = createTranslator(locale);
  const open = courses.filter((c) => !c.completed && c.availability === 'OPEN');
  const coursesLine = open.length
    ? `${t('menu.courseCount', { count: courses.length })} · ${t('menu.openCount', { count: open.length })}`
    : t('menu.courseCount', { count: courses.length });
  const rank = (c: CourseSummaryDto) => (c.completed ? 2 : c.availability === 'OPEN' ? 0 : c.availability === 'UPCOMING' ? 1 : 3);
  const featured = [...courses]
    .filter((c) => rank(c) < 3)
    .sort((a, b) => rank(a) - rank(b))
    .slice(0, 3)
    .map((c): FeaturedCourse => {
      const title = locale === 'ar' ? c.titleAr : c.titleEn;
      const href = `/${locale}/courses/${c.slug}`;
      if (c.completed) return { href, title, line: t('menu.featuredCompleted'), tone: 'muted' };
      if (c.availability === 'UPCOMING') return { href, title, line: t('menu.featuredUpcoming'), tone: 'accent' };
      return {
        href,
        title,
        line: c.applicationDeadline ? t('menu.featuredOpenUntil', { date: formatDate(c.applicationDeadline, locale) }) : t('menu.featuredOpen'),
        tone: 'success',
      };
    });
  return { coursesLine, featured, roadmaps: menuRoadmaps };
}

import type { Locale } from '@academy/shared';
import type { Translate } from '@/i18n/translator';
import { LEARNING_PATHS } from '@/lib/paths';
import { blogUrl, community } from '@/lib/site';
import type { MenuData } from './menu';

export type MenuIcon = 'courses' | 'path' | 'play' | 'calendar' | 'users' | 'chat' | 'article';
/** Soft logo tints, each with one meaning: cyan = learning, green = open/done, amber = recordings and "soon", orange = community. */
export type MenuTint = 'cyan' | 'green' | 'amber' | 'orange';

export interface MenuLink {
  href: string;
  label: string;
  desc?: string;
  descTone?: 'success' | 'accent' | 'muted';
  icon?: MenuIcon;
  tint?: MenuTint;
  external?: boolean;
}

export interface MenuColumn {
  heading: string;
  links: MenuLink[];
  /** A "see all" link under the column. */
  more?: MenuLink;
  /** Grey column (the featured list). */
  muted?: boolean;
}

export interface MenuSection {
  id: 'learn' | 'live' | 'community';
  label: string;
  columns: MenuColumn[];
}

/** The header's three menus, shared by the desktop mega-menus and the phone drawer. */
export function menuSections(t: Translate, locale: Locale, data: MenuData): MenuSection[] {
  const l = (path: string) => `/${locale}${path}`;
  return [
    {
      id: 'learn',
      label: t('menu.learn'),
      columns: [
        {
          heading: t('menu.browse'),
          links: [
            { href: l('/courses'), label: t('nav.courses'), desc: data.coursesLine ?? t('menu.coursesDesc'), icon: 'courses', tint: 'cyan' },
            { href: l('/learning-paths'), label: t('menu.paths'), desc: t('menu.pathsDesc'), icon: 'path', tint: 'green' },
            { href: l('/sessions/recordings'), label: t('menu.recordings'), desc: t('menu.recordingsDesc'), icon: 'play', tint: 'amber' },
          ],
        },
        {
          heading: t('menu.pathsByTopic'),
          links: LEARNING_PATHS.map((p) => ({ href: l(`/learning-paths/${p.slug}`), label: p.title[locale], desc: p.tagline[locale] })),
          more: { href: l('/learning-paths'), label: t('menu.allPaths') },
        },
        ...(data.featured.length
          ? [
              {
                heading: t('menu.featured'),
                muted: true,
                links: data.featured.map((f) => ({ href: f.href, label: f.title, desc: f.line, descTone: f.tone })),
                more: { href: l('/courses'), label: t('menu.fullCatalog') },
              },
            ]
          : []),
      ],
    },
    {
      id: 'live',
      label: t('menu.live'),
      columns: [
        {
          heading: t('menu.liveHeading'),
          links: [
            { href: l('/sessions'), label: t('menu.upcoming'), desc: t('menu.upcomingDesc'), icon: 'calendar', tint: 'cyan' },
            { href: l('/sessions/recordings'), label: t('menu.recordings'), desc: t('menu.liveRecordingsDesc'), icon: 'play', tint: 'amber' },
            { href: l('/speakers'), label: t('menu.speakers'), desc: t('menu.speakersDesc'), icon: 'users', tint: 'green' },
          ],
        },
      ],
    },
    {
      id: 'community',
      label: t('menu.community'),
      columns: [
        {
          heading: t('menu.communityHeading'),
          links: [
            { href: community.discord, label: 'Discord', desc: t('menu.discordDesc'), icon: 'chat', tint: 'cyan', external: true },
            { href: community.telegram, label: 'Telegram', desc: t('menu.telegramDesc'), icon: 'chat', tint: 'green', external: true },
            { href: community.linkedin, label: 'LinkedIn', desc: t('menu.linkedinDesc'), icon: 'users', tint: 'amber', external: true },
            { href: community.youtube, label: 'YouTube', desc: t('menu.youtubeDesc'), icon: 'play', tint: 'orange', external: true },
          ],
        },
        {
          heading: t('menu.readHeading'),
          links: [{ href: blogUrl(locale), label: t('menu.blog'), desc: t('menu.blogDesc'), icon: 'article', tint: 'cyan', external: true }],
        },
      ],
    },
  ];
}

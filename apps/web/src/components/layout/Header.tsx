import type { CourseSummaryDto, Locale } from '@academy/shared';
import Image from 'next/image';
import Link from 'next/link';
import { createTranslator } from '@/i18n/translator';
import { getRoadmaps, localizeRoadmap } from '@/lib/roadmaps';
import { serverGetOr } from '@/lib/server-api';
import { LanguageSwitcher } from './LanguageSwitcher';
import { MegaNav } from './MegaNav';
import { buildMenuData } from './menu';
import { MobileMenu } from './MobileMenu';
import { UserNav } from './UserNav';

/**
 * Site header. From lg up: logo, the Learn / Live / Community mega-menus and What's
 * new, language and account. Below lg everything folds into one drawer (MobileMenu).
 *
 * The menus' course counts and featured courses are public data fetched here (cached
 * like any ISR fetch; a menu without them if the API is unreachable). Who is signed in
 * is loaded in the browser (UserNav, MobileMenu), never here: no cookies() on public
 * pages, so their HTML stays the same for everyone and the edge can cache it.
 */
export async function Header({ locale }: { locale: Locale }) {
  const t = createTranslator(locale);
  const courses = await serverGetOr<CourseSummaryDto[] | null>('/courses', null, 300);
  const data = buildMenuData(
    courses,
    locale,
    getRoadmaps().map((r) => localizeRoadmap(r, locale)),
  );
  return (
    <header className="relative z-40 border-b border-line bg-card">
      <div className="mx-auto flex min-h-16 w-full max-w-[75rem] items-center gap-2 px-4 sm:px-6 lg:min-h-[4.25rem] lg:gap-8 lg:px-10">
        <Link href={`/${locale}`} className="flex min-h-11 min-w-0 items-center gap-2.5 text-fg">
          <Image src="/logo.svg" alt="" width={40} height={23} priority className="h-[23px] w-10 shrink-0" />
          <span className="truncate text-[0.9375rem] leading-tight font-semibold sm:text-base">{t('meta.siteName')}</span>
        </Link>
        <nav aria-label={t('nav.primary')} className="hidden lg:block">
          <MegaNav data={data} />
        </nav>
        <div className="ms-auto flex shrink-0 items-center gap-1 lg:gap-3">
          <LanguageSwitcher className="max-[379px]:hidden" />
          <UserNav />
          <MobileMenu data={data} />
        </div>
      </div>
    </header>
  );
}

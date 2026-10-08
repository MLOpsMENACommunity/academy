import type { Locale } from '@academy/shared';
import Image from 'next/image';
import Link from 'next/link';
import { createTranslator } from '@/i18n/translator';
import { LanguageSwitcher } from './LanguageSwitcher';
import { MobileMenu } from './MobileMenu';
import { NavLinks } from './NavLinks';
import { UserNav } from './UserNav';

/**
 * Site header. From md up: logo, primary nav, language and account. On phones
 * the nav and account links fold into one menu button (MobileMenu).
 */
export function Header({ locale }: { locale: Locale }) {
  const t = createTranslator(locale);
  return (
    <header className="relative z-40 border-b border-line bg-card">
      <div className="mx-auto flex min-h-16 w-full max-w-[70rem] items-center gap-2 px-5 py-2 sm:px-6 md:gap-6 md:py-3">
        <Link href={`/${locale}`} className="flex min-h-11 min-w-0 items-center gap-2.5 text-fg">
          <Image src="/logo.svg" alt="" width={40} height={23} priority className="h-[23px] w-10 shrink-0" />
          <span className="text-[0.9375rem] leading-tight font-semibold sm:text-[1.0625rem]">{t('meta.siteName')}</span>
        </Link>
        <nav aria-label={t('nav.primary')} className="hidden md:block">
          <NavLinks />
        </nav>
        <div className="ms-auto flex shrink-0 items-center gap-1 md:gap-2">
          <LanguageSwitcher className="max-[379px]:hidden" />
          <UserNav />
          <MobileMenu />
        </div>
      </div>
    </header>
  );
}

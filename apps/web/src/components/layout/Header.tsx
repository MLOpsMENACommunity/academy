import type { Locale } from '@academy/shared';
import Image from 'next/image';
import Link from 'next/link';
import { createTranslator } from '@/i18n/translator';
import { LanguageSwitcher } from './LanguageSwitcher';
import { UserNav } from './UserNav';

export function Header({ locale }: { locale: Locale }) {
  const t = createTranslator(locale);
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-3 px-4 sm:px-6">
        <Link href={`/${locale}`} className="flex items-center gap-2.5 font-bold text-fg">
          <Image src="/logo-mark.png" alt="" width={32} height={32} priority />
          <span className="hidden text-sm leading-tight min-[400px]:inline sm:text-base">{t('meta.siteName')}</span>
        </Link>
        <nav aria-label="Primary" className="ms-auto flex items-center gap-1">
          <Link
            href={`/${locale}/courses`}
            className="inline-flex min-h-9 items-center rounded-lg px-3 text-sm font-semibold text-fg hover:bg-muted-bg"
          >
            {t('nav.courses')}
          </Link>
          <LanguageSwitcher />
          <UserNav />
        </nav>
      </div>
    </header>
  );
}

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { MarkWhatsNewSeen } from '@/components/layout/WhatsNew';
import { Container } from '@/components/ui/Container';
import { Arrow } from '@/components/ui/Icons';
import { isLocale } from '@/i18n/config';
import { createTranslator } from '@/i18n/translator';
import { CHANGELOG } from '@/lib/changelog';
import { formatDate } from '@/lib/format';
import { alternates } from '@/lib/seo';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const t = createTranslator(locale);
  return { title: t('whatsNew.title'), description: t('whatsNew.intro'), alternates: alternates(locale, '/whats-new') };
}

/** A static changelog (lib/changelog.ts). Opening it clears the header's "unread" dot in this browser. */
export default async function WhatsNewPage({ params }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = createTranslator(locale);
  return (
    <>
      <MarkWhatsNewSeen />
      <section className="border-b border-line bg-muted-bg">
        <Container className="py-10 sm:py-14">
          <h1 className="text-[2rem] sm:text-[2.5rem]">{t('whatsNew.title')}</h1>
          <p className="mt-3 max-w-2xl text-lg leading-relaxed text-muted">{t('whatsNew.intro')}</p>
        </Container>
      </section>
      <Container className="py-10 sm:py-14">
        <ol className="flex max-w-3xl flex-col">
          {CHANGELOG.map((e) => (
            <li key={e.id} className="relative flex flex-col gap-2 border-s-2 border-line ps-6 pb-10 last:pb-0">
              <span aria-hidden className="absolute -start-[7px] top-1.5 size-3 rounded-full border-2 border-card bg-logo-cyan" />
              <time dateTime={e.date} className="text-sm text-muted">
                {formatDate(`${e.date}T12:00:00Z`, locale)}
              </time>
              <h2 className="text-xl">{e.title[locale]}</h2>
              <p className="leading-relaxed text-body">{e.body[locale]}</p>
              {e.path && (
                <Link href={`/${locale}${e.path}`} className="inline-flex min-h-11 items-center gap-1.5 self-start font-medium text-primary hover:underline">
                  {t('whatsNew.try')} <Arrow />
                </Link>
              )}
            </li>
          ))}
        </ol>
      </Container>
    </>
  );
}

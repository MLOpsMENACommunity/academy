import type { ConsultantCardDto } from '@academy/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ExpertAvatar, expertName, priceLines } from '@/components/consultations/shared';
import { ExpertPortalCard } from '@/components/consultations/ExpertPortal';
import { MyBookingsLink } from '@/components/consultations/MyBookingsLink';
import { Container } from '@/components/ui/Container';
import { isLocale } from '@/i18n/config';
import { createTranslator } from '@/i18n/translator';
import { alternates, openGraph } from '@/lib/seo';
import { pick } from '@/lib/sessions';
import { absoluteUrl } from '@/lib/site';
import { serverGet } from '@/lib/server-api';

type Props = { params: Promise<{ locale: string }> };

export const revalidate = 60;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const t = createTranslator(locale);
  return {
    title: t('consultations.title'),
    description: t('consultations.intro'),
    alternates: alternates(locale, '/consultations'),
    openGraph: openGraph(locale, { title: t('consultations.title'), description: t('consultations.intro'), url: absoluteUrl(`/${locale}/consultations`) }),
  };
}

/** Consultations: the listed experts, how booking works, and the way to one's own bookings. */
export default async function ConsultationsPage({ params }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = createTranslator(locale);
  // serverGet: an API failure fails the render instead of caching "no experts".
  const experts = (await serverGet<ConsultantCardDto[]>('/consultations/experts')) ?? [];

  return (
    <>
      <section className="border-b border-line bg-muted-bg">
        <Container className="py-10 sm:py-14">
          <h1 className="text-[2rem] sm:text-[2.5rem]">{t('consultations.title')}</h1>
          <p className="mt-3 max-w-2xl text-lg leading-relaxed text-muted">{t('consultations.intro')}</p>
          <ol className="mt-6 grid max-w-3xl gap-3 sm:grid-cols-3">
            {[1, 2, 3].map((n) => (
              <li key={n} className="flex gap-3 rounded-xl border border-line bg-card p-4">
                <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-full bg-primary-soft text-sm font-semibold text-primary">
                  {n}
                </span>
                <span className="text-[0.9375rem] leading-snug text-body">{t(`consultations.how${n}`)}</span>
              </li>
            ))}
          </ol>
          <MyBookingsLink className="mt-5 inline-flex" />
        </Container>
      </section>
      <Container className="py-10 sm:py-14">
        <div className="mb-8 empty:hidden">
          <ExpertPortalCard />
        </div>
        {experts.length === 0 ? (
          <p className="text-muted">{t('consultations.empty')}</p>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {experts.map((e, i) => {
              const name = expertName(e, locale);
              return (
                <li key={e.slug}>
                  <Link
                    href={`/${locale}/consultations/${e.slug}`}
                    className="group flex h-full flex-col gap-4 rounded-card border border-line bg-card p-5 transition-colors hover:border-primary"
                  >
                    <div className="flex items-center gap-4">
                      <ExpertAvatar name={name} photoUrl={e.photoUrl} index={i} />
                      <div className="min-w-0">
                        <p className="font-semibold text-fg group-hover:text-primary group-hover:underline">{name}</p>
                        <p className="line-clamp-2 text-[0.875rem] leading-snug text-muted">{pick(locale, e.titleEn, e.titleAr)}</p>
                      </div>
                    </div>
                    <ul className="mt-auto flex flex-col gap-1 text-[0.9375rem] text-body">
                      {priceLines(e, locale, t).map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                    <span className="font-medium text-primary">{t('consultations.bookCta')}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Container>
    </>
  );
}

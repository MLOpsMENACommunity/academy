import type { ConsultantDetailDto } from '@academy/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';
import { BookingPanel } from '@/components/consultations/BookingPanel';
import { ExpertAvatar, expertName, priceLines } from '@/components/consultations/shared';
import { Container } from '@/components/ui/Container';
import { isLocale } from '@/i18n/config';
import { createTranslator } from '@/i18n/translator';
import { alternates, notFoundMetadata } from '@/lib/seo';
import { pick } from '@/lib/sessions';
import { serverGet } from '@/lib/server-api';

type Props = { params: Promise<{ locale: string; slug: string }> };

export const revalidate = 60;
export const dynamicParams = true;

async function load(slug: string): Promise<ConsultantDetailDto | null> {
  if (!/^[a-z0-9-]{1,80}$/.test(slug)) return null;
  return serverGet<ConsultantDetailDto>(`/consultations/experts/${slug}`);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!isLocale(locale)) return {};
  const e = await load(slug);
  if (!e) return notFoundMetadata(locale);
  const t = createTranslator(locale);
  const name = expertName(e, locale);
  return { title: t('consultations.expert.metaTitle', { name }), description: pick(locale, e.titleEn, e.titleAr), alternates: alternates(locale, `/consultations/${e.slug}`) };
}

/** One expert: who they are, what a call costs, and the booking panel (open slots, reserve). */
export default async function ExpertPage({ params }: Props) {
  const { locale, slug } = await params;
  if (!isLocale(locale)) notFound();
  const e = await load(slug);
  if (!e) notFound();
  // A former address (the speaker's slug changed): go to the current one.
  if (e.slug !== slug) permanentRedirect(`/${locale}/consultations/${e.slug}`);
  const t = createTranslator(locale);
  const name = expertName(e, locale);
  const bio = pick(locale, e.bioEn, e.bioAr);

  return (
    <Container className="py-8 sm:py-12">
      <Link href={`/${locale}/consultations`} className="text-[0.9375rem] text-muted hover:text-fg">
        {t('consultations.expert.back')}
      </Link>
      <div className="mt-6 grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
        <div>
          <div className="flex items-center gap-5">
            <ExpertAvatar name={name} photoUrl={e.photoUrl} size="lg" />
            <div className="min-w-0">
              <h1 className="text-[1.75rem] sm:text-[2rem]">{name}</h1>
              <p className="mt-1 text-muted">{pick(locale, e.titleEn, e.titleAr)}</p>
              {e.linkedinUrl && (
                <a href={e.linkedinUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-[0.9375rem] text-primary hover:underline">
                  LinkedIn
                </a>
              )}
            </div>
          </div>
          <ul className="mt-6 flex flex-wrap gap-2">
            {priceLines(e, locale, t).map((line) => (
              <li key={line} className="rounded-full border border-line px-3 py-1 text-[0.9375rem] text-body">
                {line}
              </li>
            ))}
          </ul>
          {bio && (
            <section aria-labelledby="about" className="mt-8">
              <h2 id="about" className="text-[1.375rem]">
                {t('consultations.expert.about')}
              </h2>
              <p className="mt-3 leading-relaxed whitespace-pre-line text-body">{bio}</p>
            </section>
          )}
          <p className="mt-8 text-[0.9375rem] leading-relaxed text-muted">{t('consultations.expert.policy')}</p>
        </div>
        <BookingPanel expert={e} />
      </div>
    </Container>
  );
}

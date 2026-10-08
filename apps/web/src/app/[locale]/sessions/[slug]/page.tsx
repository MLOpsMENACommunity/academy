import { courseLanguageLabels, deliveryPlatformLabels, type PublicEventDto } from '@academy/shared';
import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { LocalTime, ViewerTimezone } from '@/components/course/LocalTime';
import { Markdown } from '@/components/course/Markdown';
import { RegisterPanel } from '@/components/sessions/RegisterPanel';
import { Container } from '@/components/ui/Container';
import { isLocale } from '@/i18n/config';
import { createTranslator } from '@/i18n/translator';
import { jsonLd } from '@/lib/jsonld';
import { alternates } from '@/lib/seo';
import { serverGet } from '@/lib/server-api';
import { excerpt, pick } from '@/lib/sessions';
import { absoluteUrl, community } from '@/lib/site';

type Props = { params: Promise<{ locale: string; slug: string }> };

export const revalidate = 60;

async function load(slug: string): Promise<PublicEventDto | null> {
  if (!/^[a-z0-9-]{1,80}$/.test(slug)) return null;
  return serverGet<PublicEventDto>(`/events/${slug}`);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!isLocale(locale)) return {};
  const e = await load(slug);
  if (!e) return {};
  const t = createTranslator(locale);
  const title = pick(locale, e.titleEn, e.titleAr);
  const description = excerpt(pick(locale, e.descriptionEn, e.descriptionAr), 160) || t('sessions.metaDescription');
  return {
    title,
    description,
    alternates: alternates(locale, `/sessions/${slug}`),
    openGraph: {
      title,
      description,
      type: 'website',
      url: absoluteUrl(`/${locale}/sessions/${slug}`),
      ...(e.coverImageUrl ? { images: [e.coverImageUrl] } : {}),
    },
    twitter: { card: 'summary_large_image', title, description },
  };
}

export default async function SessionPage({ params }: Props) {
  const { locale, slug } = await params;
  if (!isLocale(locale)) notFound();
  const e = await load(slug);
  if (!e) notFound();
  const t = createTranslator(locale);
  const title = pick(locale, e.titleEn, e.titleAr);
  const description = pick(locale, e.descriptionEn, e.descriptionAr).trim();
  const speaker = pick(locale, e.speakerName, e.speakerNameAr);
  const speakerTitle = pick(locale, e.speakerTitleEn, e.speakerTitleAr);
  const url = absoluteUrl(`/${locale}/sessions/${e.slug}`);
  const end = new Date(new Date(e.startsAt).getTime() + e.durationMin * 60_000).toISOString();
  const seatsLeft = e.capacity !== null && !e.past && e.status === 'PUBLISHED' ? Math.max(0, e.capacity - e.registered) : null;

  const facts: [string, ReactNode][] = [
    [t('sessions.facts.where'), deliveryPlatformLabels[e.platform][locale]],
    [t('sessions.facts.language'), courseLanguageLabels[e.language][locale]],
    ...(seatsLeft !== null ? ([[t('sessions.facts.seats'), String(seatsLeft)]] as [string, ReactNode][]) : []),
  ];

  const structured = [
    {
      '@context': 'https://schema.org',
      '@type': 'Event',
      name: title,
      description: excerpt(description, 300) || undefined,
      url,
      startDate: e.startsAt,
      endDate: end,
      eventStatus: e.status === 'CANCELLED' ? 'https://schema.org/EventCancelled' : 'https://schema.org/EventScheduled',
      eventAttendanceMode: 'https://schema.org/OnlineEventAttendanceMode',
      location: { '@type': 'VirtualLocation', url },
      inLanguage: e.language === 'AR' ? 'ar' : e.language === 'EN' ? 'en' : ['ar', 'en'],
      isAccessibleForFree: true,
      ...(e.coverImageUrl ? { image: [e.coverImageUrl] } : {}),
      organizer: { '@type': 'Organization', name: 'MLOps MENA Community', url: community.mainSite },
      ...(e.speakerName ? { performer: { '@type': 'Person', name: e.speakerName, ...(e.speakerTitleEn ? { jobTitle: e.speakerTitleEn } : {}) } } : {}),
      offers: {
        '@type': 'Offer',
        price: 0,
        priceCurrency: 'USD',
        availability: e.full ? 'https://schema.org/SoldOut' : 'https://schema.org/InStock',
        url,
      },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: t('sessions.title'), item: absoluteUrl(`/${locale}/sessions`) },
        { '@type': 'ListItem', position: 2, name: title, item: url },
      ],
    },
  ];

  const [tzBefore, tzAfter] = t('sessions.timezoneNote', { tz: '\u0000' }).split('\u0000');

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={jsonLd(structured)} />

      <section className="border-b border-line bg-card">
        <Container className="flex flex-col gap-4 py-8 sm:gap-5 sm:py-14 lg:py-16">
          <nav aria-label={t('course.breadcrumbLabel')} className="-ms-1 text-[0.9375rem] text-muted">
            <Link href={`/${locale}/sessions`} className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-1 hover:text-fg">
              <span aria-hidden className="inline-block rtl:rotate-180">
                ←
              </span>
              {t('sessions.title')}
            </Link>
          </nav>
          <p className="flex flex-wrap items-center gap-x-2 text-[0.9375rem] font-medium text-primary">
            <span aria-hidden className={`size-2 rounded-full ${e.status === 'CANCELLED' ? 'bg-line-strong' : 'bg-logo-green'}`} />
            {t('sessions.free')}
          </p>
          <h1 className="max-w-4xl text-[2rem] leading-tight sm:text-[2.75rem] sm:leading-[1.15]">{title}</h1>
          <div>
            <p className="text-lg text-fg sm:text-[1.1875rem]">
              <LocalTime iso={e.startsAt} style="weekday-datetime" />
              <span className="text-muted"> · {t('sessions.minutes', { count: e.durationMin })}</span>
            </p>
            <p className="mt-1 text-sm text-muted">
              {tzBefore}
              <ViewerTimezone />
              {tzAfter}
            </p>
          </div>
          {speaker && (
            <p className="text-[0.9375rem] text-muted">
              {speakerTitle ? t('sessions.withTitle', { name: speaker, title: speakerTitle }) : t('sessions.with', { name: speaker })}
            </p>
          )}
          <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-5 text-[0.9375rem] sm:flex sm:flex-wrap sm:gap-x-10">
            {facts.map(([k, v]) => (
              <div key={k} className="min-w-0">
                <dt className="text-muted">{k}</dt>
                <dd className="mt-1 font-medium text-fg">{v}</dd>
              </div>
            ))}
          </dl>
        </Container>
      </section>

      <Container className="grid gap-12 py-12 sm:py-16 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-16">
        {/* First in the DOM so phones reach it right after the title; the side column on desktop. */}
        <aside className="lg:col-start-2 lg:row-start-1">
          <div className="rounded-card border border-line bg-card p-5 sm:p-7 lg:sticky lg:top-8">
            <RegisterPanel initial={e} title={title} pageUrl={url} />
          </div>
        </aside>

        <div className="min-w-0 space-y-14 sm:space-y-16 lg:col-start-1 lg:row-start-1">
          {description && (
            <section aria-labelledby="about">
              <h2 id="about" className="text-[1.5rem] sm:text-[1.625rem]">
                {t('sessions.about')}
              </h2>
              <div className="mt-5">
                <Markdown>{description}</Markdown>
              </div>
            </section>
          )}

          {speaker && (
            <section aria-labelledby="speaker">
              <h2 id="speaker" className="text-[1.5rem] sm:text-[1.625rem]">
                {t('sessions.speaker')}
              </h2>
              <div className="mt-5 flex items-center gap-4">
                {e.speakerPhotoUrl ? (
                  // unoptimized: admins may paste photos from any host (e.g. LinkedIn's CDN).
                  <Image src={e.speakerPhotoUrl} alt="" width={64} height={64} unoptimized className="size-16 shrink-0 rounded-full object-cover" />
                ) : (
                  <span aria-hidden className="grid size-16 shrink-0 place-items-center rounded-full bg-logo-cyan-soft text-xl font-semibold text-primary">
                    {speaker.charAt(0)}
                  </span>
                )}
                <div className="min-w-0">
                  <p className="text-lg font-medium text-fg">{speaker}</p>
                  {speakerTitle && <p className="text-[0.9375rem] text-muted">{speakerTitle}</p>}
                  {e.speakerLinkedinUrl && (
                    <a href={e.speakerLinkedinUrl} rel="noopener noreferrer" target="_blank" className="inline-flex min-h-11 items-center text-[0.9375rem] text-primary underline">
                      LinkedIn
                    </a>
                  )}
                </div>
              </div>
            </section>
          )}
        </div>
      </Container>
    </>
  );
}

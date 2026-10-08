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
    [t('sessions.facts.language'), courseLanguageLabels[e.language][locale]],
    [t('sessions.facts.where'), deliveryPlatformLabels[e.platform][locale]],
    [t('sessions.facts.price'), t('sessions.free')],
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
        <Container className="py-10 sm:py-14">
          <nav aria-label={t('course.breadcrumbLabel')} className="text-sm text-muted">
            <Link href={`/${locale}/sessions`} className="inline-flex min-h-11 items-center hover:text-primary hover:underline">
              {t('sessions.title')}
            </Link>
          </nav>
          <p className="mt-2 text-sm text-muted">
            {deliveryPlatformLabels[e.platform][locale]} · {courseLanguageLabels[e.language][locale]} · {t('sessions.free')}
          </p>
          <h1 className="mt-3 max-w-3xl text-3xl font-semibold sm:text-5xl">{title}</h1>
          <p className="mt-4 text-lg text-body">
            <LocalTime iso={e.startsAt} style="weekday-datetime" />
            <span className="text-muted"> · {t('sessions.minutes', { count: e.durationMin })}</span>
          </p>
          <p className="mt-1 text-xs text-muted">
            {tzBefore}
            <ViewerTimezone />
            {tzAfter}
          </p>
          {speaker && (
            <p className="mt-3 text-muted">{speakerTitle ? t('sessions.withTitle', { name: speaker, title: speakerTitle }) : t('sessions.with', { name: speaker })}</p>
          )}
        </Container>
      </section>

      <Container className="grid gap-10 py-10 sm:py-14 lg:grid-cols-[minmax(0,1fr)_20rem]">
        {/* First in the DOM so phones reach it right after the title; the side column on desktop. */}
        <aside className="lg:col-start-2 lg:row-start-1">
          <div className="rounded-card border border-line bg-card p-5 lg:sticky lg:top-24">
            <RegisterPanel initial={e} title={title} pageUrl={url} />
          </div>
        </aside>

        <div className="min-w-0 space-y-10 lg:col-start-1 lg:row-start-1">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-4">
            {facts.map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs text-muted">{k}</dt>
                <dd className="mt-0.5 font-semibold text-fg">{v}</dd>
              </div>
            ))}
          </dl>

          {description && (
            <section aria-labelledby="about" className="border-t border-line pt-8">
              <h2 id="about" className="text-2xl font-semibold">
                {t('sessions.about')}
              </h2>
              <div className="mt-4">
                <Markdown>{description}</Markdown>
              </div>
            </section>
          )}

          {speaker && (
            <section aria-labelledby="speaker" className="border-t border-line pt-8">
              <h2 id="speaker" className="text-2xl font-semibold">
                {t('sessions.speaker')}
              </h2>
              <div className="mt-4 flex items-center gap-4">
                {e.speakerPhotoUrl ? (
                  // unoptimized: admins may paste photos from any host (e.g. LinkedIn's CDN).
                  <Image src={e.speakerPhotoUrl} alt="" width={64} height={64} unoptimized className="size-16 shrink-0 rounded-full object-cover" />
                ) : (
                  <span aria-hidden className="grid size-16 shrink-0 place-items-center rounded-full bg-primary-soft text-xl font-semibold text-primary">
                    {speaker.charAt(0)}
                  </span>
                )}
                <div className="min-w-0">
                  <p className="text-lg font-semibold text-fg">{speaker}</p>
                  {speakerTitle && <p className="text-sm text-muted">{speakerTitle}</p>}
                  {e.speakerLinkedinUrl && (
                    <a href={e.speakerLinkedinUrl} rel="noopener noreferrer" target="_blank" className="inline-flex min-h-11 items-center text-sm text-primary underline">
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

import {
  courseLanguageLabels,
  deliveryPlatformLabels,
  eventEnded,
  eventSpeakerRoleLabels,
  youtubeId,
  type EventSpeakerRole,
  type PublicEventDto,
} from '@academy/shared';
import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { RecordingPlayer } from '@/components/archive/RecordingPlayer';
import { TopicList } from '@/components/archive/TopicList';
import { LocalTime, ViewerTimezone } from '@/components/course/LocalTime';
import { Markdown } from '@/components/course/Markdown';
import { RegisterPanel } from '@/components/sessions/RegisterPanel';
import { ButtonLink } from '@/components/ui/Button';
import { Container } from '@/components/ui/Container';
import { isLocale } from '@/i18n/config';
import { createTranslator } from '@/i18n/translator';
import { durationLabel, isoDuration, speakerPath, youtubeThumbnail } from '@/lib/archive';
import { jsonLd } from '@/lib/jsonld';
import { alternates, DEFAULT_OG_IMAGE } from '@/lib/seo';
import { serverGet, staticSlugs } from '@/lib/server-api';
import { excerpt, pick } from '@/lib/sessions';
import { absoluteUrl, community } from '@/lib/site';

type Props = { params: Promise<{ locale: string; slug: string }> };

export const revalidate = 60;

/** Static (ISR): see the course page. Known sessions are prerendered when the API is reachable at build time. */
export const dynamicParams = true;
export async function generateStaticParams() {
  return staticSlugs<{ upcoming: { slug: string }[]; past: { slug: string }[] }>('/events', (e) => [...e.upcoming, ...e.past].map((x) => x.slug));
}

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
      images: e.coverImageUrl ? [e.coverImageUrl] : [DEFAULT_OG_IMAGE],
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
  // The page is cached for a minute: a session that just ended is shown as ended.
  const past = e.status !== 'CANCELLED' && (e.past || eventEnded(new Date(e.startsAt), e.durationMin));
  const video = e.recordingUrl ? youtubeId(e.recordingUrl) : null;
  const speakerSlug = e.speaker?.slug ?? null;
  // The main speaker, then hosts and guests. Unknown fields (a title, a photo) are left out, never made up.
  const people: {
    key: string;
    name: string;
    title: string;
    photoUrl: string | null;
    slug: string | null;
    linkedinUrl: string | null;
    role: EventSpeakerRole | null;
  }[] = [
    ...(speaker
      ? [
          {
            key: 'main',
            name: speaker,
            title: speakerTitle,
            photoUrl: e.speakerPhotoUrl,
            slug: speakerSlug,
            linkedinUrl: e.speakerLinkedinUrl,
            role: null,
          },
        ]
      : []),
    ...(e.coSpeakers ?? []).map((c, i) => ({
      key: `co-${i}`,
      name: pick(locale, c.name, c.nameAr),
      title: pick(locale, c.titleEn ?? '', c.titleAr),
      photoUrl: c.photoUrl,
      slug: c.slug,
      linkedinUrl: null,
      role: c.role,
    })),
  ];

  const facts: [string, ReactNode][] = [
    // Where it streamed only matters before it happens.
    ...(!past ? ([[t('sessions.facts.where'), deliveryPlatformLabels[e.platform][locale]]] as [string, ReactNode][]) : []),
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
      ...(people.length
        ? {
            performer: people.map((p) => ({
              '@type': 'Person',
              name: p.name,
              ...(p.title ? { jobTitle: p.title } : {}),
              ...(p.slug ? { url: absoluteUrl(speakerPath(locale, p.slug)) } : {}),
            })),
          }
        : {}),
      offers: {
        '@type': 'Offer',
        price: 0,
        priceCurrency: 'USD',
        availability: e.full ? 'https://schema.org/SoldOut' : 'https://schema.org/InStock',
        url,
      },
    },
    ...(past && video
      ? [
          {
            '@context': 'https://schema.org',
            '@type': 'VideoObject',
            name: title,
            description: excerpt(description, 300) || title,
            thumbnailUrl: youtubeThumbnail(video),
            uploadDate: e.startsAt,
            duration: isoDuration(e.durationMin),
            embedUrl: `https://www.youtube-nocookie.com/embed/${video}`,
            url,
            inLanguage: e.language === 'AR' ? 'ar' : e.language === 'EN' ? 'en' : ['ar', 'en'],
            isAccessibleForFree: true,
          },
        ]
      : []),
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

      <section className="border-b border-line bg-muted-bg">
        <Container className="flex flex-col gap-4 py-8 sm:gap-5 sm:py-14 lg:py-16">
          <nav aria-label={t('course.breadcrumbLabel')} className="-ms-1 text-[0.9375rem] text-muted">
            <Link href={`/${locale}/sessions`} className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-1 hover:text-fg">
              <span aria-hidden className="inline-block rtl:rotate-180">
                ←
              </span>
              {t('sessions.title')}
            </Link>
          </nav>
          <p className={`flex flex-wrap items-center gap-x-2 text-[0.9375rem] font-medium ${past ? 'text-muted' : 'text-primary'}`}>
            <span aria-hidden className={`size-2 rounded-full ${e.status === 'CANCELLED' || past ? 'bg-line-strong' : 'bg-logo-green'}`} />
            {past ? t('sessions.recorded') : t('sessions.free')}
          </p>
          <h1 className="max-w-4xl text-[2rem] leading-tight sm:text-[2.75rem] sm:leading-[1.15]">{title}</h1>
          <div>
            <p className="text-lg text-fg sm:text-[1.1875rem]">
              <LocalTime iso={e.startsAt} style={past ? 'date' : 'weekday-datetime'} />
              <span className="text-muted"> · {past ? durationLabel(e.durationMin, locale) : t('sessions.minutes', { count: e.durationMin })}</span>
            </p>
            {!past && (
              <p className="mt-1 text-sm text-muted">
                {tzBefore}
                <ViewerTimezone />
                {tzAfter}
              </p>
            )}
          </div>
          {speaker && (
            <p className="text-[0.9375rem] text-muted">
              {speakerSlug ? (
                <>
                  {t('sessions.with', { name: '\u0000' }).split('\u0000')[0]}
                  <Link href={speakerPath(locale, speakerSlug)} className="text-fg underline decoration-line-strong/60 underline-offset-4 hover:text-primary">
                    {speaker}
                  </Link>
                  {speakerTitle ? `${locale === 'ar' ? '، ' : ', '}${speakerTitle}` : ''}
                  {t('sessions.with', { name: '\u0000' }).split('\u0000')[1]}
                </>
              ) : speakerTitle ? (
                t('sessions.withTitle', { name: speaker, title: speakerTitle })
              ) : (
                t('sessions.with', { name: speaker })
              )}
            </p>
          )}
          <TopicList topics={e.topics} locale={locale} label={t('sessions.topics')} />
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
        <aside className={`lg:col-start-2 lg:row-start-1 ${past ? 'order-last lg:order-none' : ''}`}>
          <div className="rounded-card border border-line bg-card p-5 sm:p-7 lg:sticky lg:top-8">
            {past ? (
              // Over: nothing to register for. Point to the rest of the archive instead.
              <div className="space-y-4">
                <p className="font-semibold text-fg">{t('sessions.ended')}</p>
                <p className="text-[0.9375rem] leading-relaxed text-muted">{t('sessions.endedRecordingBody')}</p>
                <ButtonLink href={`/${locale}/sessions/recordings`} variant="secondary" className="w-full">
                  {t('sessions.browseRecordings')}
                </ButtonLink>
                <ButtonLink href={`/${locale}/sessions`} variant="ghost" className="w-full">
                  {t('sessions.allSessions')}
                </ButtonLink>
              </div>
            ) : (
              <RegisterPanel initial={e} title={title} pageUrl={url} />
            )}
          </div>
        </aside>

        <div className="min-w-0 space-y-14 sm:space-y-16 lg:col-start-1 lg:row-start-1">
          {past && (
            <section aria-labelledby="recording">
              <h2 id="recording" className="sr-only">
                {t('sessions.recordingHeading')}
              </h2>
              {e.recordingUrl ? (
                <RecordingPlayer
                  url={e.recordingUrl}
                  youtubeId={video}
                  title={title}
                  locale={locale}
                  sizes="(min-width: 1024px) 688px, calc(100vw - 40px)"
                />
              ) : (
                <p className="rounded-card border border-dashed border-line-strong/50 p-6 text-center text-muted">{t('sessions.recordingSoon')}</p>
              )}
            </section>
          )}
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

          {people.length > 0 && (
            <section aria-labelledby="speaker">
              <h2 id="speaker" className="text-[1.5rem] sm:text-[1.625rem]">
                {people.length > 1 ? t('sessions.speakers') : t('sessions.speaker')}
              </h2>
              <ul className="mt-5 space-y-5">
                {people.map((p) => (
                  <li key={p.key} className="flex items-center gap-4">
                    {p.photoUrl ? (
                      // unoptimized: admins may paste photos from any host (e.g. LinkedIn's CDN).
                      <Image
                        src={p.photoUrl}
                        alt=""
                        width={64}
                        height={64}
                        unoptimized
                        className="size-16 shrink-0 rounded-full object-cover"
                      />
                    ) : (
                      <span
                        aria-hidden
                        className="grid size-16 shrink-0 place-items-center rounded-full bg-logo-cyan-soft text-xl font-semibold text-primary"
                      >
                        {p.name.charAt(0)}
                      </span>
                    )}
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-baseline gap-x-2 text-lg font-medium text-fg">
                        {p.slug ? (
                          <Link
                            href={speakerPath(locale, p.slug)}
                            className="underline decoration-line-strong/60 underline-offset-4 hover:text-primary"
                          >
                            {p.name}
                          </Link>
                        ) : (
                          p.name
                        )}
                        {p.role && (
                          <span className="text-sm font-normal text-muted">
                            {eventSpeakerRoleLabels[p.role][locale]}
                          </span>
                        )}
                      </p>
                      {p.title && <p className="text-[0.9375rem] text-muted">{p.title}</p>}
                      {p.linkedinUrl && (
                        <a
                          href={p.linkedinUrl}
                          rel="noopener noreferrer"
                          target="_blank"
                          className="inline-flex min-h-11 items-center text-[0.9375rem] text-primary underline"
                        >
                          LinkedIn
                        </a>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </Container>
    </>
  );
}

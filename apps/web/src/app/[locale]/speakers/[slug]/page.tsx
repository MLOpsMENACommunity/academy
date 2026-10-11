import {
  courseAvailabilityLabels,
  eventSpeakerRoleLabels,
  type PublicSpeakerDto,
} from '@academy/shared';
import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { TopicList } from '@/components/archive/TopicList';
import { DateTile } from '@/components/sessions/SessionDate';
import { buttonClass } from '@/components/ui/Button';
import { Container } from '@/components/ui/Container';
import { isLocale } from '@/i18n/config';
import { createTranslator } from '@/i18n/translator';
import { durationLabel, speakerPath } from '@/lib/archive';
import { formatDate } from '@/lib/format';
import { jsonLd } from '@/lib/jsonld';
import { alternates, DEFAULT_OG_IMAGE } from '@/lib/seo';
import { serverGet, staticSlugs } from '@/lib/server-api';
import { excerpt, pick } from '@/lib/sessions';
import { absoluteUrl, community } from '@/lib/site';

type Props = { params: Promise<{ locale: string; slug: string }> };

export const revalidate = 60;

/** Static (ISR): see the course page. Known speakers are prerendered when the API is reachable at build time. */
export const dynamicParams = true;
export async function generateStaticParams() {
  return staticSlugs<{ slug: string }[]>('/speakers', (list) => list.map((s) => s.slug));
}

async function load(slug: string): Promise<PublicSpeakerDto | null> {
  if (!/^[a-z0-9-]{1,80}$/.test(slug)) return null;
  return serverGet<PublicSpeakerDto>(`/speakers/${slug}`);
}

/** Site paths (/speakers/x.webp) become absolute for crawlers and link previews. */
const absolutePhoto = (url: string) => (url.startsWith('/') ? absoluteUrl(url) : url);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!isLocale(locale)) return {};
  const s = await load(slug);
  if (!s) return {};
  const t = createTranslator(locale);
  const name = pick(locale, s.name, s.nameAr);
  const bio = pick(locale, s.bioEn, s.bioAr);
  const description = excerpt(bio, 160) || t('speakers.metaDescription', { name });
  return {
    title: name,
    description,
    alternates: alternates(locale, `/speakers/${s.slug}`),
    openGraph: { title: name, description, type: 'profile', url: absoluteUrl(speakerPath(locale, s.slug)), images: s.photoUrl ? [absolutePhoto(s.photoUrl)] : [DEFAULT_OG_IMAGE] },
  };
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className="text-[1.5rem] sm:text-[1.625rem]">
        {title}
      </h2>
      <div className="mt-5">{children}</div>
    </section>
  );
}

export default async function SpeakerPage({ params }: Props) {
  const { locale, slug } = await params;
  if (!isLocale(locale)) notFound();
  const s = await load(slug);
  if (!s) notFound();
  // A former address (the team changed the slug): send people and crawlers to the current one.
  if (s.slug !== slug) permanentRedirect(speakerPath(locale, s.slug));
  const t = createTranslator(locale);
  const name = pick(locale, s.name, s.nameAr);
  const title = pick(locale, s.titleEn, s.titleAr);
  const bio = pick(locale, s.bioEn, s.bioAr).trim();
  const url = absoluteUrl(speakerPath(locale, s.slug));
  const links = [
    ...(s.linkedinUrl ? [{ label: 'LinkedIn', href: s.linkedinUrl }] : []),
    ...(s.githubUrl ? [{ label: 'GitHub', href: s.githubUrl }] : []),
  ];

  const structured = [
    {
      '@context': 'https://schema.org',
      '@type': 'Person',
      name: s.name,
      ...(s.nameAr ? { alternateName: s.nameAr } : {}),
      ...(s.titleEn ? { jobTitle: s.titleEn } : {}),
      ...(s.bioEn ? { description: excerpt(s.bioEn, 300) } : {}),
      ...(s.photoUrl ? { image: absolutePhoto(s.photoUrl) } : {}),
      url,
      ...(links.length ? { sameAs: links.map((l) => l.href) } : {}),
      affiliation: { '@type': 'Organization', name: 'MLOps MENA Community', url: community.mainSite },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: t('speakers.title'), item: absoluteUrl(`/${locale}/speakers`) },
        { '@type': 'ListItem', position: 2, name, item: url },
      ],
    },
  ];

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={jsonLd(structured)} />

      <section className="border-b border-line bg-muted-bg">
        <Container className="flex flex-col gap-5 py-8 sm:py-14 lg:py-16">
          <nav aria-label={t('course.breadcrumbLabel')} className="-ms-1 text-[0.9375rem] text-muted">
            <Link href={`/${locale}/speakers`} className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-1 hover:text-fg">
              <span aria-hidden className="inline-block rtl:rotate-180">
                ←
              </span>
              {t('speakers.title')}
            </Link>
          </nav>
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:gap-8">
            {s.photoUrl ? (
              // unoptimized: photos are small already, and admins may paste them from any host.
              <Image src={s.photoUrl} alt="" width={128} height={128} unoptimized priority className="size-24 shrink-0 rounded-full bg-muted-bg object-cover ring-1 ring-line sm:size-32" />
            ) : (
              <span aria-hidden className="grid size-24 shrink-0 place-items-center rounded-full bg-logo-cyan-soft text-4xl font-semibold text-primary sm:size-32">
                {name.charAt(0)}
              </span>
            )}
            <div className="flex min-w-0 flex-col gap-2">
              <h1 className="text-[2rem] leading-tight sm:text-[2.5rem]">{name}</h1>
              {title && <p className="text-lg text-muted">{title}</p>}
              {links.length > 0 && (
                <ul className="mt-1 flex flex-wrap gap-2">
                  {links.map((l) => (
                    <li key={l.label}>
                      <a href={l.href} target="_blank" rel="noopener noreferrer" className={buttonClass('secondary', 'sm')}>
                        {l.label} <span aria-hidden>↗</span>
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </Container>
      </section>

      <Container className="py-12 sm:py-16">
        <div className="max-w-3xl space-y-14 sm:space-y-16">
          {bio && <p className="text-lg leading-relaxed whitespace-pre-line text-body">{bio}</p>}

          {s.events.length > 0 && (
            <Section id="sessions" title={t('speakers.sessions')}>
              <ul>
                {s.events.map((e) => (
                  <li
                    key={e.slug}
                    className="relative flex items-start gap-5 border-t border-line py-5 last:border-b"
                  >
                    <DateTile iso={e.startsAt} />
                    <div className="min-w-0 flex-1">
                      <h3 className="text-base font-medium sm:text-lg">
                        <Link
                          href={`/${locale}/sessions/${e.slug}`}
                          className="after:absolute after:inset-0 hover:text-primary"
                        >
                          {pick(locale, e.titleEn, e.titleAr)}
                        </Link>
                      </h3>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm text-muted">
                        <time dateTime={e.startsAt}>{formatDate(e.startsAt, locale)}</time>
                        <span aria-hidden>·</span>
                        {durationLabel(e.durationMin, locale)}
                        {e.role && (
                          <>
                            <span aria-hidden>·</span>
                            {eventSpeakerRoleLabels[e.role][locale]}
                          </>
                        )}
                        {e.status === 'CANCELLED' ? (
                          <span className="font-medium text-warning">
                            · {t('speakers.cancelled')}
                          </span>
                        ) : !e.past ? (
                          <span className="font-medium text-primary">
                            · {t('speakers.upcoming')}
                          </span>
                        ) : e.recordingUrl ? (
                          <span className="font-medium text-success">
                            · {t('speakers.hasRecording')}
                          </span>
                        ) : null}
                      </p>
                      <TopicList
                        topics={e.topics}
                        locale={locale}
                        label={t('sessions.topics')}
                        className="mt-2"
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </Section>
          )}

        {s.courses.length > 0 && (
          <Section id="courses" title={t('speakers.courses')}>
            <ul>
              {s.courses.map((c) => (
                <li key={c.slug} className="relative border-t border-line py-5 last:border-b">
                  <h3 className="text-base font-medium sm:text-lg">
                    <Link href={`/${locale}/courses/${c.slug}`} className="after:absolute after:inset-0 hover:text-primary">
                      {pick(locale, c.titleEn, c.titleAr)}
                    </Link>
                  </h3>
                  <p className="mt-0.5 text-sm text-muted">
                    {c.completed
                      ? c.cohortNumber
                        ? t('course.completedBadge', { n: c.cohortNumber })
                        : t('course.completed')
                      : courseAvailabilityLabels[c.availability][locale]}
                    {c.startDate && (
                      <>
                        {' · '}
                        {c.endDate
                          ? t('course.range', { start: formatDate(c.startDate, locale), end: formatDate(c.endDate, locale) })
                          : formatDate(c.startDate, locale)}
                      </>
                    )}
                  </p>
                </li>
              ))}
            </ul>
          </Section>
        )}
        </div>
      </Container>
    </>
  );
}

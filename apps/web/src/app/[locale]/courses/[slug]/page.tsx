import {
  courseAvailabilityLabels,
  courseLanguageLabels,
  courseLevelsText,
  deliveryPlatformLabels,
  recordingsPlatformLabels,
  type CourseDetailDto,
  type Locale,
  youtubeId,
} from '@academy/shared';
import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { RecordingPlayer } from '@/components/archive/RecordingPlayer';
import { ApplyCta } from '@/components/course/ApplyCta';
import { availabilityStyle, priceLabel } from '@/components/course/CourseCard';
import { CourseViewTracker } from '@/components/course/CourseViewTracker';
import { LocalTime, ViewerTimezone } from '@/components/course/LocalTime';
import { Markdown } from '@/components/course/Markdown';
import { Alert } from '@/components/ui/Alert';
import { Container } from '@/components/ui/Container';
import { isLocale } from '@/i18n/config';
import { createTranslator } from '@/i18n/translator';
import { jsonLd } from '@/lib/jsonld';
import { alternates } from '@/lib/seo';
import { serverGet, staticSlugs } from '@/lib/server-api';
import { absoluteUrl, community } from '@/lib/site';
import { durationLabel, isoDuration, speakerPath, youtubeThumbnail } from '@/lib/archive';
import { formatDate, formatDateTime } from '@/lib/format';

type Props = { params: Promise<{ locale: string; slug: string }> };

export const revalidate = 60;

async function load(slug: string): Promise<CourseDetailDto | null> {
  if (!/^[a-z0-9-]{1,80}$/.test(slug)) return null;
  return serverGet<CourseDetailDto>(`/courses/${slug}`);
}

const pick = (locale: Locale, en: string, ar: string | null | undefined) => (locale === 'ar' && ar ? ar : en);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!isLocale(locale)) return {};
  const c = await load(slug);
  if (!c) return {};
  const title = pick(locale, c.titleEn, c.titleAr);
  const description = pick(locale, c.shortDescriptionEn, c.shortDescriptionAr);
  return {
    title,
    description,
    alternates: alternates(locale, `/courses/${slug}`),
    openGraph: { title, description, type: 'website', url: absoluteUrl(`/${locale}/courses/${slug}`) },
    twitter: { card: 'summary_large_image', title, description },
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

/**
 * Static (ISR) for every course: the public course page is the same for everyone, so it
 * is rendered once per revalidate window and served from the cache (and Cloudflare's edge).
 * Personal bits (application status, Notify me) are client components that load after.
 * Known slugs are prerendered when the API is reachable at build time; others render on
 * first request (dynamicParams) and are cached from then on.
 */
export const dynamicParams = true;
export async function generateStaticParams() {
  return staticSlugs<{ slug: string }[]>('/courses/slugs', (list) => list.map((c) => c.slug));
}

/** Rows of a list separated by hairlines instead of boxes. */
const rowClass = 'border-t border-line last:border-b';

export default async function CoursePage({ params }: Props) {
  const { locale, slug } = await params;
  if (!isLocale(locale)) notFound();
  const c = await load(slug);
  if (!c) notFound();
  const t = createTranslator(locale);
  const title = pick(locale, c.titleEn, c.titleAr);
  const price = priceLabel(c, locale);
  const full = c.seatsRemaining === 0;
  const outcomes = c.learningOutcomes[locale] ?? [];
  const prereqs = c.prerequisites[locale] ?? [];
  const audience = pick(locale, c.targetAudience.en, c.targetAudience.ar).trim();
  const notFor = pick(locale, c.notFor.en, c.notFor.ar).trim();
  const preparation = pick(locale, c.preparation?.en ?? '', c.preparation?.ar).trim();
  const lastSession = c.sessions.at(-1);
  const completed = c.completed;
  const recordings = c.sessions.filter((s) => s.recordingUrl);
  const showRecordings = completed || recordings.length > 0;

  const included = (
    [
      ['liveSessions', t('course.inc.liveSessions', { platform: deliveryPlatformLabels[c.deliveryPlatform][locale] })],
      ['recordings', t('course.inc.recordings', { platform: recordingsPlatformLabels[c.recordingsPlatform][locale] })],
      ['assignments', t('course.inc.assignments')],
      ['finalProject', t('course.inc.finalProject')],
      ['certificate', t('course.inc.certificate')],
    ] as const
  ).filter(([k]) => c.included[k]);
  const includedNote = locale === 'ar' ? c.included.notesAr : c.included.notesEn;

  const ran =
    completed && c.startDate
      ? c.endDate
        ? t('course.range', { start: formatDate(c.startDate, locale), end: formatDate(c.endDate, locale) })
        : formatDate(c.startDate, locale)
      : null;
  // Coming soon: dates, format, language and certificate aren't decided. They're listed under
  // "Course details" as "Will be announced soon" instead of being guessed in the facts row.
  const comingSoon = c.comingSoon;
  const tba = t('course.tba');
  const details: [string, ReactNode][] = comingSoon
    ? [
        [
          t('course.facts.duration'),
          c.durationWeeks ? t('catalog.weeks', { count: c.durationWeeks }) : tba,
        ],
        [t('course.facts.format'), tba],
        [t('course.facts.language'), tba],
        [
          t('course.facts.schedule'),
          c.startDate ? <LocalTime key="s" iso={c.startDate} style="date" /> : tba,
        ],
        [t('course.facts.price'), price],
        [t('course.facts.certificate'), c.included.certificate ? t('course.inc.certificate') : tba],
      ]
    : [];
  const facts: [string, ReactNode][] = [
    ...(ran ? ([[t('course.ran'), ran]] as [string, ReactNode][]) : []),
    ...(c.startDate && !completed ? ([[t('course.facts.start'), <LocalTime key="s" iso={c.startDate} style="date" />]] as [string, ReactNode][]) : []),
    ...(c.durationWeeks ? ([[t('course.facts.duration'), t('catalog.weeks', { count: c.durationWeeks })]] as [string, ReactNode][]) : []),
    ...(c.hoursPerWeek ? ([[t('course.facts.commitment'), t('course.facts.perWeek', { count: c.hoursPerWeek })]] as [string, ReactNode][]) : []),
    [t('course.facts.level'), courseLevelsText(c, locale)],
    ...(comingSoon
      ? []
      : ([[t('course.facts.language'), courseLanguageLabels[c.language][locale]]] as [
          string,
          ReactNode,
        ][])),
    [t('course.facts.price'), price],
    ...(c.applicationDeadline && !completed
      ? // In the academy's time zone (with its name), so the closing date reads the same for every visitor.
        ([[t('course.facts.deadline'), formatDateTime(c.applicationDeadline, locale)]] as [string, ReactNode][])
      : []),
    ...(c.seatsRemaining !== null && !completed
      ? ([[t('course.facts.seats'), full ? t('catalog.full') : t('catalog.seatsLeft', { count: c.seatsRemaining })]] as [string, ReactNode][])
      : []),
  ];

  // Open courses: apply. Anything else (coming soon, closed, a past cohort): the waiting list.
  const cta = (compact: boolean) => (
    <ApplyCta
      slug={c.slug}
      availability={c.availability}
      isFree={c.type === 'FREE'}
      requiresApproval={c.requiresApproval}
      full={full}
      priceText={price}
      completed={completed}
      compact={compact}
    />
  );

  const url = absoluteUrl(`/${locale}/courses/${c.slug}`);
  const structured = [
    {
      '@context': 'https://schema.org',
      '@type': 'Course',
      name: title,
      description: pick(locale, c.shortDescriptionEn, c.shortDescriptionAr),
      url,
      ...(comingSoon
        ? {}
        : { inLanguage: c.language === 'AR' ? 'ar' : c.language === 'EN' ? 'en' : ['ar', 'en'] }),
      educationalLevel: courseLevelsText(c, 'en'),
      teaches: outcomes,
      coursePrerequisites: prereqs,
      provider: { '@type': 'Organization', name: 'MLOps MENA Community', sameAs: community.mainSite },
      offers: {
        '@type': 'Offer',
        category: c.type === 'FREE' ? 'Free' : 'Paid',
        // No price yet (e.g. a paid course still "coming soon"): leave it out rather than claim 0.
        ...(c.type === 'FREE' || c.price > 0 ? { price: c.price, priceCurrency: c.currency } : {}),
        availability: {
          OPEN: full ? 'https://schema.org/SoldOut' : 'https://schema.org/InStock',
          UPCOMING: 'https://schema.org/PreOrder',
          CLOSED: 'https://schema.org/SoldOut',
        }[c.availability],
        url,
      },
      hasCourseInstance: {
        '@type': 'CourseInstance',
        courseMode: 'online',
        location: deliveryPlatformLabels[c.deliveryPlatform].en,
        ...(c.startDate ? { startDate: c.startDate } : {}),
        ...(c.endDate ? { endDate: c.endDate } : lastSession ? { endDate: lastSession.startsAt } : {}),
        // Total effort for the whole course.
        ...(c.hoursPerWeek && c.durationWeeks ? { courseWorkload: `PT${c.hoursPerWeek * c.durationWeeks}H` } : {}),
        courseSchedule: {
          '@type': 'Schedule',
          repeatFrequency: 'Weekly',
          ...(c.sessions[0] ? { duration: `PT${c.sessions[0].durationMin}M` } : {}),
          ...(c.durationWeeks ? { repeatCount: c.durationWeeks } : {}),
          ...(c.startDate ? { startDate: c.startDate } : {}),
        },
        instructor: c.instructors.map((i) => ({
          '@type': 'Person',
          name: i.name,
          jobTitle: i.titleEn,
          ...(i.slug ? { url: absoluteUrl(speakerPath(locale, i.slug)) } : {}),
        })),
      },
    },
    ...recordings
      .filter((s) => youtubeId(s.recordingUrl!))
      .map((s) => ({
        '@context': 'https://schema.org',
        '@type': 'VideoObject',
        name: `${title}: ${pick(locale, s.titleEn, s.titleAr)}`,
        description: pick(locale, s.descriptionEn ?? '', s.descriptionAr).replace(/\s+/g, ' ').trim() || pick(locale, s.titleEn, s.titleAr),
        thumbnailUrl: youtubeThumbnail(youtubeId(s.recordingUrl!)!),
        uploadDate: s.startsAt,
        duration: isoDuration(s.durationMin),
        embedUrl: `https://www.youtube-nocookie.com/embed/${youtubeId(s.recordingUrl!)}`,
        url: `${url}#lesson-${s.order}`,
        isAccessibleForFree: true,
      })),
    ...(c.faq.length
      ? [
          {
            '@context': 'https://schema.org',
            '@type': 'FAQPage',
            mainEntity: c.faq.map((f) => ({
              '@type': 'Question',
              name: pick(locale, f.questionEn, f.questionAr),
              acceptedAnswer: { '@type': 'Answer', text: pick(locale, f.answerEn, f.answerAr) },
            })),
          },
        ]
      : []),
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: t('course.breadcrumb'), item: absoluteUrl(`/${locale}/courses`) },
        { '@type': 'ListItem', position: 2, name: title, item: url },
      ],
    },
  ];

  return (
    <>
      <CourseViewTracker slug={c.slug} />
      <script type="application/ld+json" dangerouslySetInnerHTML={jsonLd(structured)} />

      <section className="border-b border-line bg-muted-bg">
        <Container className="flex flex-col gap-4 py-8 sm:gap-5 sm:py-14 lg:py-16">
          <nav aria-label={t('course.breadcrumbLabel')} className="-ms-1 text-[0.9375rem] text-muted">
            <Link href={`/${locale}/courses`} className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-1 hover:text-fg">
              <span aria-hidden className="inline-block rtl:rotate-180">
                ←
              </span>
              {t('course.breadcrumb')}
            </Link>
          </nav>
          {completed ? (
            <p className="flex flex-wrap items-center gap-x-2 text-[0.9375rem] font-medium text-success">
              <span aria-hidden className="size-2 rounded-full bg-logo-green" />
              {c.cohortNumber ? t('course.completedBadge', { n: c.cohortNumber }) : t('course.completed')}
              <span aria-hidden>·</span>
              {price}
            </p>
          ) : (
            <p className={`flex flex-wrap items-center gap-x-2 text-[0.9375rem] font-medium ${availabilityStyle[c.availability].text}`}>
              <span aria-hidden className={`size-2 rounded-full ${availabilityStyle[c.availability].dot}`} />
              {courseAvailabilityLabels[c.availability][locale]}
              <span aria-hidden>·</span>
              {price}
            </p>
          )}
          <h1 className="max-w-4xl text-[2rem] leading-tight sm:text-[2.75rem] sm:leading-[1.15]">{title}</h1>
          <p className="max-w-2xl text-lg leading-relaxed text-muted sm:text-[1.1875rem]">
            {pick(locale, c.shortDescriptionEn, c.shortDescriptionAr)}
          </p>
          {c.instructors.length > 0 && (
            <p className="text-[0.9375rem] text-muted">
              {c.instructors.length > 1 ? t('course.instructors') : t('course.instructor')}:{' '}
              {c.instructors.map((i, n) => (
                <span key={i.id}>
                  {n > 0 && (locale === 'ar' ? '، ' : ', ')}
                  {i.slug ? (
                    <Link href={speakerPath(locale, i.slug)} className="text-fg underline decoration-line-strong/60 underline-offset-4 hover:text-primary">
                      {pick(locale, i.name, i.nameAr)}
                    </Link>
                  ) : (
                    <span className="text-fg">{pick(locale, i.name, i.nameAr)}</span>
                  )}
                </span>
              ))}
            </p>
          )}
          {completed && c.externalPlatform && (
            <p className="text-[0.9375rem] text-muted">
              {t('course.externalNote', { platform: '\u0000' }).split('\u0000')[0]}
              {c.externalUrl ? (
                <a href={c.externalUrl} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-4">
                  {c.externalPlatform}
                </a>
              ) : (
                c.externalPlatform
              )}
              {t('course.externalNote', { platform: '\u0000' }).split('\u0000')[1]}
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

      <Container className="grid gap-14 py-12 sm:py-16 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-16">
        <div className="min-w-0 space-y-14 sm:space-y-16">
          {showRecordings && (
            <Section id="recordings" title={t('course.recordings')}>
              {completed && <p className="-mt-1 mb-5 text-[0.9375rem] text-muted">{t('course.recordingsNote')}</p>}
              <ol className="grid gap-6 sm:grid-cols-2">
                {(completed ? c.sessions : recordings).map((s) => {
                  const lessonTitle = pick(locale, s.titleEn, s.titleAr);
                  return (
                    <li key={s.id} id={`lesson-${s.order}`} className="flex min-w-0 scroll-mt-6 flex-col gap-3">
                      {s.recordingUrl ? (
                        <RecordingPlayer
                          url={s.recordingUrl}
                          youtubeId={youtubeId(s.recordingUrl)}
                          title={lessonTitle}
                          locale={locale}
                          sizes="(min-width: 1024px) 332px, (min-width: 640px) calc(50vw - 36px), calc(100vw - 40px)"
                        />
                      ) : (
                        <div className="grid aspect-video place-items-center rounded-xl border border-dashed border-line-strong/50 bg-muted-bg p-4 text-center text-sm text-muted">
                          {t('course.noRecording')}
                        </div>
                      )}
                      <div>
                        <p className="text-sm font-medium text-primary">{t('course.lesson', { n: s.order })}</p>
                        <h3 className="mt-0.5 text-[1.0625rem] leading-snug">{lessonTitle}</h3>
                        <p className="mt-1 text-sm text-muted">
                          <time dateTime={s.startsAt}>{formatDate(s.startsAt, locale)}</time>
                          <span aria-hidden> · </span>
                          {durationLabel(s.durationMin, locale)}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </Section>
          )}

          {outcomes.length > 0 && (
            <Section id="outcomes" title={t('course.outcomes')}>
              <ul className="space-y-3">
                {outcomes.map((o) => (
                  <li key={o} className="flex gap-3 leading-relaxed">
                    <span aria-hidden className="mt-[0.15em] grid size-6 shrink-0 place-items-center rounded-full bg-primary-soft text-xs text-primary">
                      ✓
                    </span>
                    <span className="min-w-0">{o}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <Section id="about" title={t('course.about')}>
            <Markdown>{pick(locale, c.longDescriptionEn, c.longDescriptionAr)}</Markdown>
          </Section>

          {(audience || notFor || prereqs.length > 0) && (
            <Section id="audience" title={t('course.fit')}>
              {(audience || notFor) && (
                <div className={`grid gap-4 ${audience && notFor ? 'md:grid-cols-2' : ''}`}>
                  {audience && (
                    <div className="rounded-card bg-logo-green-soft p-5 sm:p-6">
                      <h3 className="text-base text-success">{t('course.audience')}</h3>
                      <div className="mt-2 leading-relaxed">
                        <Markdown>{audience}</Markdown>
                      </div>
                    </div>
                  )}
                  {notFor && (
                    <div className="rounded-card bg-muted-bg p-5 sm:p-6">
                      <h3 className="text-base">{t('course.notFor')}</h3>
                      <div className="mt-2 leading-relaxed">
                        <Markdown>{notFor}</Markdown>
                      </div>
                    </div>
                  )}
                </div>
              )}
              {prereqs.length > 0 && (
                <>
                  <h3 className="mt-8 text-lg">{t('course.prerequisites')}</h3>
                  <ul className="mt-3 list-disc space-y-2 ps-5 leading-relaxed marker:text-logo-cyan">
                    {prereqs.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                </>
              )}
            </Section>
          )}

          {preparation && (
            <section aria-labelledby="preparation" className="rounded-card border border-line bg-card p-5 sm:p-8">
              <h2 id="preparation" className="text-[1.375rem]">
                {t('course.preparation')}
              </h2>
              <div className="mt-3">
                <Markdown>{preparation}</Markdown>
              </div>
            </section>
          )}

          {c.outline.length > 0 && (
            <Section id="syllabus" title={t('course.syllabus')}>
              <ol>
                {c.outline.map((m, i) => (
                  <li key={i} className={`${rowClass} py-5`}>
                    <p className="text-sm font-medium text-primary">{t('course.module', { n: i + 1 })}</p>
                    <h3 className="mt-1 text-[1.0625rem]">{pick(locale, m.titleEn, m.titleAr)}</h3>
                    {(m.descriptionEn || m.descriptionAr) && (
                      <p className="mt-1.5 leading-relaxed text-muted">{pick(locale, m.descriptionEn ?? '', m.descriptionAr)}</p>
                    )}
                  </li>
                ))}
              </ol>
            </Section>
          )}

          {c.sessions.length > 0 && !completed && (
            <Section id="schedule" title={t('course.schedule')}>
              <p className="-mt-1 mb-5 text-[0.9375rem] text-muted">
                {t('course.scheduleNote', { tz: '\u0000' }).split('\u0000')[0]}
                <ViewerTimezone />
                {t('course.scheduleNote', { tz: '\u0000' }).split('\u0000')[1]}
              </p>
              <ol>
                {c.sessions.map((s) => (
                  <li key={s.id} className={`${rowClass} flex flex-col gap-1 py-4 sm:flex-row sm:gap-6`}>
                    <span className="shrink-0 text-[0.9375rem] text-muted sm:w-64">
                      <LocalTime iso={s.startsAt} style="weekday-datetime" /> · {t('course.minutes', { count: s.durationMin })}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-fg">
                        <span className="me-2 text-muted">{s.order}.</span>
                        {pick(locale, s.titleEn, s.titleAr)}
                      </p>
                      {pick(locale, s.descriptionEn ?? '', s.descriptionAr) && (
                        <details className="mt-1 text-[0.9375rem]">
                          <summary className="inline-flex min-h-11 cursor-pointer items-center text-primary">{t('course.sessionTopics')}</summary>
                          <p className="mt-1 leading-relaxed whitespace-pre-line text-body">{pick(locale, s.descriptionEn ?? '', s.descriptionAr)}</p>
                        </details>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            </Section>
          )}

          {c.instructors.length > 0 && (
            <Section id="instructors" title={c.instructors.length > 1 ? t('course.instructors') : t('course.instructor')}>
              <ul className="space-y-10">
                {c.instructors.map((i) => (
                  <li key={i.id} className="flex flex-col gap-4 sm:flex-row sm:gap-6">
                    {i.photoUrl ? (
                      // unoptimized: admins may paste photos from any host (e.g. LinkedIn's CDN).
                      <Image src={i.photoUrl} alt="" width={72} height={72} unoptimized className="size-18 shrink-0 rounded-full object-cover" />
                    ) : (
                      <span aria-hidden className="grid size-18 shrink-0 place-items-center rounded-full bg-logo-cyan-soft text-2xl font-semibold text-primary">
                        {i.name.replace(/\[.*?\]\s*/, '').charAt(0)}
                      </span>
                    )}
                    <div className="min-w-0">
                      <h3 className="text-xl">
                        {i.slug ? (
                          <Link href={speakerPath(locale, i.slug)} className="hover:text-primary">
                            {pick(locale, i.name, i.nameAr)}
                          </Link>
                        ) : (
                          pick(locale, i.name, i.nameAr)
                        )}
                      </h3>
                      {pick(locale, i.titleEn, i.titleAr) && (
                        <p className="mt-1 text-muted">{pick(locale, i.titleEn, i.titleAr)}</p>
                      )}
                      {pick(locale, i.bioEn, i.bioAr).trim() && (
                        <p className="mt-3 leading-relaxed whitespace-pre-line">
                          {pick(locale, i.bioEn, i.bioAr)}
                        </p>
                      )}
                      {i.linkedinUrl && (
                        <a href={i.linkedinUrl} rel="noopener" className="mt-2 inline-flex min-h-11 items-center font-medium text-primary underline underline-offset-4">
                          LinkedIn
                        </a>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {details.length > 0 && (
            <Section id="details" title={t('course.details')}>
              <dl className="grid gap-x-8 sm:grid-cols-2">
                {details.map(([k, v]) => (
                  <div
                    key={k}
                    className={`${rowClass} flex items-baseline justify-between gap-4 py-3 sm:[&:nth-last-child(2)]:border-b`}
                  >
                    <dt className="text-muted">{k}</dt>
                    <dd className="text-end font-medium text-fg">{v}</dd>
                  </div>
                ))}
              </dl>
            </Section>
          )}

          {/* Coming soon with nothing decided: "Course details" already says so. */}
          {!(comingSoon && included.length === 0) && (
            <Section id="included" title={t('course.included')}>
              <ul className="grid gap-3 sm:grid-cols-2">
                {included.map(([k, label]) => (
                  <li key={k} className="flex items-start gap-3 leading-relaxed">
                    <span
                      aria-hidden
                      className="mt-[0.15em] grid size-6 shrink-0 place-items-center rounded-full bg-primary-soft text-xs text-primary"
                    >
                      ✓
                    </span>
                    {label}
                  </li>
                ))}
              </ul>
              {includedNote && (
                <Alert tone="info" className="mt-5">
                  {includedNote}
                </Alert>
              )}
            </Section>
          )}

          {c.faq.length > 0 && (
            <Section id="faq" title={t('course.faq')}>
              <div>
                {c.faq.map((f, i) => (
                  <details key={i} className={`group ${rowClass}`}>
                    <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 py-3 font-medium text-fg marker:hidden [&::-webkit-details-marker]:hidden">
                      {pick(locale, f.questionEn, f.questionAr)}
                      <span aria-hidden className="text-xl leading-none text-muted transition-transform group-open:rotate-45">
                        +
                      </span>
                    </summary>
                    <p className="pb-5 leading-relaxed text-muted">{pick(locale, f.answerEn, f.answerAr)}</p>
                  </details>
                ))}
              </div>
            </Section>
          )}

          {/* Payment terms are part of the price, which a coming-soon course hasn't set. */}
          {c.type === 'PAID' && !comingSoon && (
            <p className="text-[0.9375rem] text-muted">
              {t('course.paidNote', { refund: '\u0000' }).split('\u0000')[0]}
              <Link href={`/${locale}/refund-policy`} className="text-primary underline underline-offset-4">
                {t('footer.refund')}
              </Link>
              {t('course.paidNote', { refund: '\u0000' }).split('\u0000')[1]}
            </p>
          )}
        </div>

        {/* Desktop: sticky side card. Phones: a bar pinned to the bottom (one primary CTA, always reachable). */}
        <aside className="hidden lg:block">
          <div className="sticky top-8 flex flex-col gap-4 rounded-card border border-line bg-card p-7">
            <p className="text-[1.75rem] font-semibold text-fg">{price}</p>
            {c.applicationDeadline && c.availability === 'OPEN' && !completed && (
              <p className="leading-relaxed text-muted">
                {t('course.facts.deadline')}: <span className="font-medium text-fg">{formatDateTime(c.applicationDeadline, locale)}</span>
              </p>
            )}
            {cta(false)}
          </div>
        </aside>
      </Container>
      {/* Sticky (not fixed) inside <main>: it follows the visitor down the page and stops above the footer. */}
      <div className="sticky bottom-0 z-30 border-t border-line bg-card/95 px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur lg:hidden">
        {cta(true)}
      </div>
    </>
  );
}

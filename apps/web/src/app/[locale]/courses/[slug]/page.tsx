import {
  courseLanguageLabels,
  courseLevelLabels,
  deliveryPlatformLabels,
  recordingsPlatformLabels,
  type CourseDetailDto,
  type Locale,
} from '@academy/shared';
import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { ApplyCta } from '@/components/course/ApplyCta';
import { priceLabel } from '@/components/course/CourseCard';
import { CourseViewTracker } from '@/components/course/CourseViewTracker';
import { LocalTime, ViewerTimezone } from '@/components/course/LocalTime';
import { Markdown } from '@/components/course/Markdown';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Container } from '@/components/ui/Container';
import { isLocale } from '@/i18n/config';
import { createTranslator } from '@/i18n/translator';
import { jsonLd } from '@/lib/jsonld';
import { alternates } from '@/lib/seo';
import { serverGet } from '@/lib/server-api';
import { absoluteUrl, community } from '@/lib/site';

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
    <section aria-labelledby={id} className="border-t border-line pt-8">
      <h2 id={id} className="text-2xl">
        {title}
      </h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

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
  const lastSession = c.sessions.at(-1);

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

  const facts: [string, ReactNode][] = [
    ...(c.startDate ? ([[t('course.facts.start'), <LocalTime key="s" iso={c.startDate} style="date" />]] as [string, ReactNode][]) : []),
    ...(c.durationWeeks ? ([[t('course.facts.duration'), t('catalog.weeks', { count: c.durationWeeks })]] as [string, ReactNode][]) : []),
    ...(c.hoursPerWeek ? ([[t('course.facts.commitment'), t('course.facts.perWeek', { count: c.hoursPerWeek })]] as [string, ReactNode][]) : []),
    [t('course.facts.level'), courseLevelLabels[c.level][locale]],
    [t('course.facts.language'), courseLanguageLabels[c.language][locale]],
    [t('course.facts.price'), price],
    ...(c.applicationDeadline
      ? ([[t('course.facts.deadline'), <LocalTime key="d" iso={c.applicationDeadline} style="date" />]] as [string, ReactNode][])
      : []),
    ...(c.seatsRemaining !== null
      ? ([[t('course.facts.seats'), full ? t('catalog.full') : t('catalog.seatsLeft', { count: c.seatsRemaining })]] as [string, ReactNode][])
      : []),
  ];

  const cta = (
    <ApplyCta
      slug={c.slug}
      availability={c.availability}
      isFree={c.type === 'FREE'}
      requiresApproval={c.requiresApproval}
      full={full}
      priceText={price}
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
      inLanguage: c.language === 'AR' ? 'ar' : c.language === 'EN' ? 'en' : ['ar', 'en'],
      educationalLevel: courseLevelLabels[c.level].en,
      teaches: outcomes,
      coursePrerequisites: prereqs,
      provider: { '@type': 'Organization', name: 'MLOps MENA Community', sameAs: community.mainSite },
      offers: {
        '@type': 'Offer',
        category: c.type === 'FREE' ? 'Free' : 'Paid',
        price: c.price,
        priceCurrency: c.currency,
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
        ...(lastSession ? { endDate: lastSession.startsAt } : {}),
        // Total effort for the whole course.
        ...(c.hoursPerWeek && c.durationWeeks ? { courseWorkload: `PT${c.hoursPerWeek * c.durationWeeks}H` } : {}),
        courseSchedule: {
          '@type': 'Schedule',
          repeatFrequency: 'Weekly',
          ...(c.sessions[0] ? { duration: `PT${c.sessions[0].durationMin}M` } : {}),
          ...(c.durationWeeks ? { repeatCount: c.durationWeeks } : {}),
          ...(c.startDate ? { startDate: c.startDate } : {}),
        },
        instructor: c.instructors.map((i) => ({ '@type': 'Person', name: i.name, jobTitle: i.titleEn })),
      },
    },
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

      <section className="bg-ink text-white">
        <Container className="py-10 sm:py-14">
          <nav aria-label={t('course.breadcrumbLabel')} className="text-sm text-white/70">
            <Link href={`/${locale}/courses`} className="hover:text-white hover:underline">
              {t('course.breadcrumb')}
            </Link>
            <span aria-hidden className="mx-2">
              /
            </span>
            <span aria-current="page">{title}</span>
          </nav>
          <div className="mt-4 flex flex-wrap gap-2">
            <Badge tone={c.type === 'FREE' ? 'primary' : 'accent'}>{price}</Badge>
            <Badge>{courseLevelLabels[c.level][locale]}</Badge>
            <Badge>{courseLanguageLabels[c.language][locale]}</Badge>
          </div>
          <h1 className="mt-4 max-w-3xl text-3xl text-white sm:text-5xl">{title}</h1>
          <p className="mt-4 max-w-2xl text-lg text-white/80">{pick(locale, c.shortDescriptionEn, c.shortDescriptionAr)}</p>
          {c.instructors.length > 0 && (
            <p className="mt-4 text-sm text-white/70">
              {c.instructors.length > 1 ? t('course.instructors') : t('course.instructor')}:{' '}
              {c.instructors.map((i) => pick(locale, i.name, i.nameAr)).join('، ')}
            </p>
          )}
        </Container>
        <div aria-hidden className="h-1 w-full" style={{ background: 'var(--brand-gradient)' }} />
      </section>

      <Container className="grid gap-10 py-10 lg:grid-cols-[1fr_20rem]">
        <div className="min-w-0 space-y-10">
          <dl className="grid grid-cols-2 gap-4 rounded-card border border-line bg-card p-5 sm:grid-cols-4">
            {facts.map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs text-muted">{k}</dt>
                <dd className="mt-0.5 font-semibold text-fg">{v}</dd>
              </div>
            ))}
          </dl>

          {outcomes.length > 0 && (
            <Section id="outcomes" title={t('course.outcomes')}>
              <ul className="grid gap-3 sm:grid-cols-2">
                {outcomes.map((o) => (
                  <li key={o} className="flex gap-3 rounded-lg bg-primary-soft/50 p-3 text-sm">
                    <span aria-hidden className="text-primary">
                      ✓
                    </span>
                    {o}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <Section id="about" title={t('course.about')}>
            <Markdown>{pick(locale, c.longDescriptionEn, c.longDescriptionAr)}</Markdown>
          </Section>

          <Section id="audience" title={t('course.fit')}>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-card border border-success/30 bg-success-soft/40 p-4">
                <h3 className="text-base text-success">{t('course.audience')}</h3>
                <p className="mt-2 text-sm">{c.targetAudience[locale]}</p>
              </div>
              <div className="rounded-card border border-line bg-muted-bg/50 p-4">
                <h3 className="text-base">{t('course.notFor')}</h3>
                <p className="mt-2 text-sm">{c.notFor[locale]}</p>
              </div>
            </div>
            {prereqs.length > 0 && (
              <>
                <h3 className="mt-6 text-lg">{t('course.prerequisites')}</h3>
                <ul className="mt-2 list-disc space-y-1 ps-5 text-sm">
                  {prereqs.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </>
            )}
          </Section>

          {c.outline.length > 0 && (
            <Section id="syllabus" title={t('course.syllabus')}>
              <ol className="space-y-3">
                {c.outline.map((m, i) => (
                  <li key={i} className="rounded-card border border-line bg-card p-4">
                    <p className="text-xs font-semibold text-primary">{t('course.module', { n: i + 1 })}</p>
                    <h3 className="mt-1 text-base">{pick(locale, m.titleEn, m.titleAr)}</h3>
                    {(m.descriptionEn || m.descriptionAr) && (
                      <p className="mt-1 text-sm text-muted">{pick(locale, m.descriptionEn ?? '', m.descriptionAr)}</p>
                    )}
                  </li>
                ))}
              </ol>
            </Section>
          )}

          {c.sessions.length > 0 && (
            <Section id="schedule" title={t('course.schedule')}>
              <p className="-mt-2 mb-4 text-sm text-muted">
                {t('course.scheduleNote', { tz: '\u0000' }).split('\u0000')[0]}
                <ViewerTimezone />
                {t('course.scheduleNote', { tz: '\u0000' }).split('\u0000')[1]}
              </p>
              <ol className="divide-y divide-line rounded-card border border-line bg-card">
                {c.sessions.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-baseline justify-between gap-2 p-4">
                    <span className="font-semibold text-fg">
                      <span className="me-2 text-muted">{s.order}.</span>
                      {pick(locale, s.titleEn, s.titleAr)}
                    </span>
                    <span className="text-sm text-body">
                      <LocalTime iso={s.startsAt} style="weekday-datetime" /> · {t('course.minutes', { count: s.durationMin })}
                    </span>
                  </li>
                ))}
              </ol>
            </Section>
          )}

          {c.instructors.length > 0 && (
            <Section id="instructors" title={c.instructors.length > 1 ? t('course.instructors') : t('course.instructor')}>
              <ul className="space-y-4">
                {c.instructors.map((i) => (
                  <li key={i.id} className="flex gap-4 rounded-card border border-line bg-card p-5">
                    {i.photoUrl ? (
                      // unoptimized: admins may paste photos from any host (e.g. LinkedIn's CDN).
                      <Image src={i.photoUrl} alt="" width={72} height={72} unoptimized className="size-18 shrink-0 rounded-full object-cover" />
                    ) : (
                      <span aria-hidden className="grid size-16 shrink-0 place-items-center rounded-full bg-ink text-xl font-bold text-white">
                        {i.name.replace(/\[.*?\]\s*/, '').charAt(0)}
                      </span>
                    )}
                    <div>
                      <h3 className="text-lg">{pick(locale, i.name, i.nameAr)}</h3>
                      <p className="text-sm font-semibold text-primary">{pick(locale, i.titleEn, i.titleAr)}</p>
                      <p className="mt-2 text-sm">{pick(locale, i.bioEn, i.bioAr)}</p>
                      {i.linkedinUrl && (
                        <a href={i.linkedinUrl} rel="noopener" className="mt-2 inline-block text-sm text-primary underline">
                          LinkedIn
                        </a>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <Section id="included" title={t('course.included')}>
            <ul className="grid gap-2 sm:grid-cols-2">
              {included.map(([k, label]) => (
                <li key={k} className="flex items-center gap-2 text-sm">
                  <span aria-hidden className="grid size-6 place-items-center rounded-full bg-primary-soft text-xs text-primary">
                    ✓
                  </span>
                  {label}
                </li>
              ))}
            </ul>
            {includedNote && (
              <Alert tone="info" className="mt-4">
                {includedNote}
              </Alert>
            )}
          </Section>

          {c.faq.length > 0 && (
            <Section id="faq" title={t('course.faq')}>
              <div className="space-y-2">
                {c.faq.map((f, i) => (
                  <details key={i} className="group rounded-card border border-line bg-card p-4 open:shadow-sm">
                    <summary className="cursor-pointer list-none font-semibold text-fg marker:hidden">
                      <span className="flex items-center justify-between gap-3">
                        {pick(locale, f.questionEn, f.questionAr)}
                        <span aria-hidden className="transition-transform group-open:rotate-45">
                          +
                        </span>
                      </span>
                    </summary>
                    <p className="mt-3 text-sm">{pick(locale, f.answerEn, f.answerAr)}</p>
                  </details>
                ))}
              </div>
            </Section>
          )}

          {c.type === 'PAID' && (
            <p className="text-sm text-muted">
              {t('course.paidNote', { refund: '\u0000' }).split('\u0000')[0]}
              <Link href={`/${locale}/refund-policy`} className="text-primary underline">
                {t('footer.refund')}
              </Link>
              {t('course.paidNote', { refund: '\u0000' }).split('\u0000')[1]}
            </p>
          )}
        </div>

        {/* Desktop: sticky side card. Mobile: fixed bottom bar (one primary CTA, always reachable). */}
        <aside className="hidden lg:block">
          <div className="sticky top-24 rounded-card border border-line bg-card p-5 shadow-sm">
            <p className="text-2xl font-bold text-fg">{price}</p>
            <div className="mt-4">{cta}</div>
          </div>
        </aside>
      </Container>
      {/* Sticky (not fixed) inside <main>: it follows the visitor down the page and stops above the footer. */}
      <div className="sticky bottom-0 z-30 border-t border-line bg-white/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur lg:hidden">
        {cta}
      </div>
    </>
  );
}

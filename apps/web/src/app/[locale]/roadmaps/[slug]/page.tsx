import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { accentStyle } from '@/components/roadmaps/accent';
import { RoadmapCard } from '@/components/roadmaps/RoadmapCard';
import { Container } from '@/components/ui/Container';
import { Arrow } from '@/components/ui/Icons';
import { isLocale } from '@/i18n/config';
import { createTranslator } from '@/i18n/translator';
import { formatDate } from '@/lib/format';
import { jsonLd } from '@/lib/jsonld';
import { getRoadmap, getRoadmaps, localizeRoadmap, phaseLabel, websiteRoadmapUrl } from '@/lib/roadmaps';
import { DEFAULT_OG_IMAGE, notFoundMetadata } from '@/lib/seo';
import { absoluteUrl, community } from '@/lib/site';

type Props = { params: Promise<{ locale: string; slug: string }> };

/*
 * Static: every roadmap is known at build time (src/content/roadmaps/*.md) and the page
 * calls no API. dynamicParams stays true, like every ISR page here: the shared header's
 * course fetch makes this an ISR page, so scripts/drop-isr-prerenders.mjs drops the
 * build-time HTML and each roadmap renders on its first request; with false, those
 * requests would 404. Unknown slugs still get notFound() below.
 */
export const dynamicParams = true;
export function generateStaticParams() {
  return getRoadmaps().map((r) => ({ slug: r.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  const raw = getRoadmap(slug);
  if (!isLocale(locale)) return {};
  if (!raw) return notFoundMetadata(locale);
  const t = createTranslator(locale);
  const r = localizeRoadmap(raw, locale);
  const description = `${r.tagline}. ${r.audience} ${t('roadmaps.resources', { count: r.resourceCount })}.`;
  /*
   * The canonical is the original on mlopsmena.com, not this page. The body is the
   * website's text, unchanged, and the website published it first: pointing both copies
   * at the website keeps them from competing as duplicate content. The hreflang pair
   * points at the website's two editions for the same reason.
   */
  const canonical = websiteRoadmapUrl(slug, locale);
  return {
    title: r.title,
    description,
    alternates: {
      canonical,
      languages: { en: websiteRoadmapUrl(slug, 'en'), ar: websiteRoadmapUrl(slug, 'ar'), 'x-default': websiteRoadmapUrl(slug, 'en') },
    },
    openGraph: {
      title: r.title,
      description,
      url: canonical,
      images: [DEFAULT_OG_IMAGE],
    },
  };
}

export default async function RoadmapPage({ params }: Props) {
  const { locale, slug } = await params;
  const raw = getRoadmap(slug);
  if (!isLocale(locale) || !raw) notFound();
  const t = createTranslator(locale);
  const r = localizeRoadmap(raw, locale);
  const a = accentStyle[r.accent];
  const others = getRoadmaps()
    .filter((o) => o.slug !== slug)
    .map((o) => localizeRoadmap(o, locale));

  const structured = {
    '@context': 'https://schema.org',
    '@type': 'LearningResource',
    learningResourceType: 'Reading list',
    headline: r.title,
    description: r.tagline,
    inLanguage: 'en',
    datePublished: r.published || undefined,
    url: absoluteUrl(`/${locale}/roadmaps/${slug}`),
    mainEntityOfPage: websiteRoadmapUrl(slug, locale),
    author: { '@type': 'Organization', name: 'MLOps MENA Community', url: community.mainSite },
    publisher: { '@type': 'Organization', name: 'MLOps MENA Community', url: community.mainSite },
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={jsonLd(structured)} />
      <section className="border-b border-line bg-muted-bg">
        <Container className="flex flex-col gap-4 pt-8 pb-10 sm:pt-12 sm:pb-12">
          <nav aria-label={t('course.breadcrumbLabel')} className="text-sm text-muted">
            <Link href={`/${locale}/roadmaps`} className="inline-flex min-h-11 items-center text-primary hover:underline">
              {t('roadmaps.title')}
            </Link>
            <span aria-hidden className="mx-2">
              /
            </span>
            <span aria-current="page">{r.title}</span>
          </nav>
          <h1 className="max-w-3xl text-[2rem] leading-tight sm:text-[2.75rem] sm:leading-[1.15]">{r.title}</h1>
          <p className={`text-lg font-medium ${a.text}`}>{r.tagline}</p>
          <ul className="flex flex-wrap gap-2 text-[0.8125rem] font-medium">
            <li className={`rounded-md px-2.5 py-0.5 ${a.soft} ${a.text}`}>{r.level}</li>
            <li className="rounded-md bg-card px-2.5 py-0.5 text-body">{r.duration}</li>
            <li className="rounded-md bg-card px-2.5 py-0.5 text-body">{r.commitment}</li>
            <li className="rounded-md bg-card px-2.5 py-0.5 text-body">{t('roadmaps.resources', { count: r.resourceCount })}</li>
          </ul>
          <p className="max-w-2xl leading-relaxed text-body">
            <span className="font-medium text-fg">{t('roadmaps.whoFor')}: </span>
            {r.audience}
          </p>
          {r.published && <p className="text-sm text-muted">{t('roadmaps.published', { date: formatDate(r.published, locale) })}</p>}

          {r.phases.length > 0 && (
            <nav aria-label={t('roadmaps.timeline')} className="-mx-5 mt-4 overflow-x-auto px-5 pb-2 sm:mx-0 sm:px-0">
              <ol className="flex min-w-max items-start">
                {r.phases.map((p, i) => (
                  <li key={p.id} className="flex items-start">
                    <a href={`#${p.id}`} className="group block w-32 shrink-0 rounded-lg px-1 py-1 text-center sm:w-36">
                      <span aria-hidden className={`mx-auto block size-3 rounded-full ${a.dot} ring-4 ring-card transition-transform group-hover:scale-125`} />
                      <span className="mt-2.5 block text-xs font-semibold tracking-[0.06em] text-fg uppercase group-hover:text-primary">{phaseLabel(t, p.label)}</span>
                      <span className="mt-0.5 block text-xs leading-snug text-muted">{p.title}</span>
                      {p.when && (
                        <span dir="ltr" className="mt-0.5 block text-xs text-muted">
                          {p.when}
                        </span>
                      )}
                    </a>
                    {i < r.phases.length - 1 && <span aria-hidden className="mt-[0.6875rem] h-px w-5 shrink-0 bg-line-strong/60 sm:w-8" />}
                  </li>
                ))}
              </ol>
            </nav>
          )}
        </Container>
      </section>

      <Container className="py-10 sm:py-14">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_16rem] lg:gap-14">
          <div className="min-w-0">
            {locale === 'ar' && <p className="mb-8 max-w-[70ch] rounded-card bg-info-soft p-4 text-[0.9375rem] leading-relaxed text-body">{t('roadmaps.englishNotice')}</p>}
            {/* The body is English on both editions (as on mlopsmena.com): laid out left to right, read as English. */}
            <article dir="ltr" lang="en" className={`prose-academy prose-roadmap ${a.rule}`} dangerouslySetInnerHTML={{ __html: raw.html }} />
          </div>

          <aside className="hidden lg:block">
            <div className="sticky top-6 flex flex-col gap-6">
              {r.phases.length > 0 && (
                <nav aria-labelledby="roadmap-toc">
                  <h2 id="roadmap-toc" className="text-xs font-medium tracking-[0.08em] text-muted uppercase">
                    {t('roadmaps.onThisPage')}
                  </h2>
                  <ol className="mt-3 flex flex-col gap-1 border-s border-line ps-4">
                    {r.phases.map((p) => (
                      <li key={p.id}>
                        <a href={`#${p.id}`} className="block py-1 text-sm leading-snug text-body hover:text-primary">
                          <span className="block text-[0.6875rem] font-medium tracking-[0.06em] text-muted uppercase">{phaseLabel(t, p.label)}</span>
                          {p.title}
                        </a>
                      </li>
                    ))}
                  </ol>
                </nav>
              )}
            </div>
          </aside>
        </div>
      </Container>

      {others.length > 0 && (
        <section aria-labelledby="other-roadmaps" className="border-t border-line bg-muted-bg">
          <Container className="py-12 sm:py-14">
            <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
              <h2 id="other-roadmaps" className="text-[1.375rem]">
                {t('roadmaps.otherRoadmaps')}
              </h2>
              <Link href={`/${locale}/learning-paths`} className="inline-flex min-h-11 items-center gap-1.5 font-medium text-primary hover:underline">
                {t('roadmaps.pathsCta')} <Arrow />
              </Link>
            </div>
            <ul className="mt-6 grid gap-5 sm:grid-cols-2">
              {others.map((o) => (
                <li key={o.slug} className="flex">
                  <RoadmapCard roadmap={o} locale={locale} />
                </li>
              ))}
            </ul>
          </Container>
        </section>
      )}
    </>
  );
}

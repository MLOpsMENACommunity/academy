import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { accentStyle } from '@/components/roadmaps/accent';
import { Container } from '@/components/ui/Container';
import { Arrow } from '@/components/ui/Icons';
import { isLocale } from '@/i18n/config';
import { createTranslator } from '@/i18n/translator';
import { getRoadmaps, localizeRoadmap } from '@/lib/roadmaps';
import { alternates, DEFAULT_OG_IMAGE } from '@/lib/seo';

/*
 * Static: built from src/content/roadmaps/*.md, no API call. (The shared header still
 * fetches the course list for its menu, which is what gives this page an ISR lifetime.)
 */
type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const t = createTranslator(locale);
  return {
    title: t('roadmaps.title'),
    description: t('roadmaps.intro'),
    // This index is the academy's own page (the roadmaps themselves canonicalize to mlopsmena.com).
    alternates: alternates(locale, '/roadmaps'),
    openGraph: { title: t('roadmaps.title'), description: t('roadmaps.intro'), images: [DEFAULT_OG_IMAGE] },
  };
}

export default async function RoadmapsPage({ params }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = createTranslator(locale);
  const roadmaps = getRoadmaps().map((r) => localizeRoadmap(r, locale));
  const total = roadmaps.reduce((n, r) => n + r.resourceCount, 0);

  return (
    <>
      <section className="border-b border-line bg-muted-bg">
        <Container className="py-10 sm:py-14">
          <h1 className="text-[2rem] sm:text-[2.5rem]">{t('roadmaps.title')}</h1>
          <p className="mt-3 max-w-2xl text-lg leading-relaxed text-muted">{t('roadmaps.intro')}</p>
          <p className="mt-2 text-body">{t('roadmaps.totalLinks', { count: total })}</p>
        </Container>
      </section>

      <Container className="flex flex-col gap-10 py-10 sm:py-14">
        <ul className="flex flex-col gap-6">
          {roadmaps.map((r) => {
            const a = accentStyle[r.accent];
            const href = `/${locale}/roadmaps/${r.slug}`;
            return (
              <li key={r.slug}>
                <article className="relative overflow-hidden rounded-card border border-line bg-card transition-colors hover:border-line-strong/50">
                  <div aria-hidden className={`h-1.5 ${a.dot}`} />
                  <div className="grid gap-6 px-5 pt-5 pb-6 sm:px-7 sm:pb-7 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:gap-10">
                    <div className="flex min-w-0 flex-col gap-3">
                      <div className="flex flex-wrap gap-2 text-[0.8125rem] font-medium">
                        <span className={`rounded-md px-2.5 py-0.5 ${a.soft} ${a.text}`}>{r.level}</span>
                        <span className="rounded-md bg-muted-bg px-2.5 py-0.5 text-body">{r.duration}</span>
                        <span className="rounded-md bg-muted-bg px-2.5 py-0.5 text-body">{r.commitment}</span>
                      </div>
                      <h2 className="text-[1.375rem] sm:text-[1.5rem]">
                        <Link
                          href={href}
                          className="after:absolute after:inset-0 after:rounded-card hover:text-primary focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-primary"
                        >
                          {r.title}
                        </Link>
                      </h2>
                      <p className={`font-medium ${a.text}`}>{r.tagline}</p>
                      <p className="max-w-xl leading-relaxed text-muted">{r.audience}</p>
                      <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
                        <span aria-hidden className="inline-flex items-center gap-1.5 font-medium text-primary">
                          {t('roadmaps.open')} <Arrow />
                        </span>
                        <span className="text-sm text-muted">{t('roadmaps.resources', { count: r.resourceCount })}</span>
                      </p>
                    </div>
                    {/* The phases at a glance; the full timeline is on the roadmap page. */}
                    <ol className="flex flex-col gap-2.5 self-center border-t border-line-soft pt-5 lg:border-t-0 lg:border-s lg:ps-8 lg:pt-0">
                      {r.phases.slice(0, 5).map((p) => (
                        <li key={p.label} className="flex items-start gap-3">
                          <span aria-hidden className={`mt-2 size-2 shrink-0 rounded-full ${a.dot}`} />
                          <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-[0.9375rem] text-body">
                            {p.title}
                            {p.when && (
                              <span dir="ltr" className="text-sm text-muted">
                                {p.when}
                              </span>
                            )}
                          </span>
                        </li>
                      ))}
                      {r.phases.length > 5 && <li className="ps-5 text-sm text-muted">+ {t('roadmaps.phases', { count: r.phases.length - 5 })}</li>}
                    </ol>
                  </div>
                </article>
              </li>
            );
          })}
        </ul>

        <aside aria-labelledby="roadmaps-paths" className="flex flex-col gap-3 rounded-card bg-muted-bg p-6 sm:flex-row sm:items-center sm:justify-between sm:gap-8 sm:px-7">
          <div>
            <h2 id="roadmaps-paths" className="text-lg">
              {t('roadmaps.pathsTitle')}
            </h2>
            <p className="mt-1 text-muted">{t('roadmaps.pathsBody')}</p>
          </div>
          <Link href={`/${locale}/learning-paths`} className="inline-flex min-h-11 shrink-0 items-center gap-1.5 font-medium text-primary hover:underline">
            {t('roadmaps.pathsCta')} <Arrow />
          </Link>
        </aside>
      </Container>
    </>
  );
}

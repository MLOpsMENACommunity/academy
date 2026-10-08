import { courseLanguageLabels, deliveryPlatformLabels, type Locale, type PublicEventDto } from '@academy/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SessionAction } from '@/components/sessions/MySessions';
import { DateBlock, DateTile, DayTime } from '@/components/sessions/SessionDate';
import { buttonClass } from '@/components/ui/Button';
import { Container } from '@/components/ui/Container';
import { isLocale } from '@/i18n/config';
import { createTranslator } from '@/i18n/translator';
import { alternates } from '@/lib/seo';
import { serverGetOr } from '@/lib/server-api';
import { excerpt, pick } from '@/lib/sessions';

type Props = { params: Promise<{ locale: string }> };

export const revalidate = 60;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const t = createTranslator(locale);
  return {
    title: t('sessions.title'),
    description: t('sessions.metaDescription'),
    alternates: alternates(locale, '/sessions'),
    openGraph: { title: t('sessions.title'), description: t('sessions.metaDescription') },
  };
}

function speakerLine(e: PublicEventDto, locale: Locale): string {
  const t = createTranslator(locale);
  const name = pick(locale, e.speakerName, e.speakerNameAr);
  const title = pick(locale, e.speakerTitleEn, e.speakerTitleAr);
  if (!name) return '';
  return title ? t('sessions.withTitle', { name, title }) : t('sessions.with', { name });
}

export default async function SessionsPage({ params }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = createTranslator(locale);
  const { upcoming } = await serverGetOr<{ upcoming: PublicEventDto[] }>('/events', { upcoming: [] });
  const [next, ...rest] = upcoming;

  return (
    <>
      <section className="border-b border-line bg-card">
        <Container className="py-12 sm:py-16">
          <h1 className="text-3xl font-semibold sm:text-5xl">{t('sessions.title')}</h1>
          <p className="mt-4 max-w-2xl text-lg text-muted">{t('sessions.intro')}</p>
        </Container>
      </section>

      <Container className="py-10 sm:py-14">
        {!next ? (
          <div className="rounded-card border border-dashed border-line-strong px-6 py-12 text-center">
            <h2 className="text-xl font-semibold">{t('sessions.empty')}</h2>
            <p className="mx-auto mt-2 max-w-md text-muted">{t('sessions.emptyBody')}</p>
            <Link href={`/${locale}/courses`} className={buttonClass('secondary', 'md', 'mt-6')}>
              {t('sessions.browseCourses')}
            </Link>
          </div>
        ) : (
          <>
            <article
              aria-labelledby="next-up"
              className="flex flex-col gap-6 rounded-card border border-line bg-card p-6 sm:p-9 md:flex-row md:items-center md:gap-10"
            >
              <div className="md:w-32 md:shrink-0 md:text-center">
                <DateBlock iso={next.startsAt} className="md:items-center" />
              </div>
              <div className="min-w-0 flex-1 space-y-2.5">
                <p className="text-sm text-muted">
                  {t('sessions.nextUp')} · {deliveryPlatformLabels[next.platform][locale]} · {courseLanguageLabels[next.language][locale]}
                </p>
                <h2 id="next-up" className="text-2xl font-semibold sm:text-3xl">
                  <Link href={`/${locale}/sessions/${next.slug}`} className="hover:text-primary">
                    {pick(locale, next.titleEn, next.titleAr)}
                  </Link>
                </h2>
                <p className="text-muted">
                  {excerpt(pick(locale, next.descriptionEn, next.descriptionAr))} {speakerLine(next, locale)}
                </p>
              </div>
              <div className="md:shrink-0">
                <SessionAction slug={next.slug} variant="button" />
              </div>
            </article>

            {rest.length > 0 && (
              <section aria-labelledby="coming-up" className="mt-12">
                <h2 id="coming-up" className="text-xl font-semibold sm:text-2xl">
                  {t('sessions.comingUp')}
                </h2>
                <ul className="mt-4 border-b border-line">
                  {rest.map((e) => (
                    <li key={e.slug} className="relative flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-line py-5">
                      <DateTile iso={e.startsAt} />
                      <div className="min-w-0 flex-1 basis-56">
                        <h3 className="text-base font-semibold">
                          {/* The whole row is the tap target. */}
                          <Link href={`/${locale}/sessions/${e.slug}`} className="after:absolute after:inset-0 hover:text-primary">
                            {pick(locale, e.titleEn, e.titleAr)}
                          </Link>
                        </h3>
                        <p className="text-sm text-muted">
                          <DayTime iso={e.startsAt} />
                          {pick(locale, e.speakerName, e.speakerNameAr) && <> · {pick(locale, e.speakerName, e.speakerNameAr)}</>}
                        </p>
                      </div>
                      <div className="relative ms-20 sm:ms-0">
                        <SessionAction slug={e.slug} variant="link" />
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </Container>
    </>
  );
}

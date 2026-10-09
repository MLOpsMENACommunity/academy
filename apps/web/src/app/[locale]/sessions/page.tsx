import { courseLanguageLabels, deliveryPlatformLabels, type Locale, type PublicEventDto } from '@academy/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SessionAction } from '@/components/sessions/MySessions';
import { DateBlock, DateTile, DayTime } from '@/components/sessions/SessionDate';
import { SessionsHeader } from '@/components/sessions/SessionsHeader';
import { ButtonLink } from '@/components/ui/Button';
import { Container } from '@/components/ui/Container';
import { isLocale } from '@/i18n/config';
import { createTranslator } from '@/i18n/translator';
import { alternates, DEFAULT_OG_IMAGE } from '@/lib/seo';
import { serverGet } from '@/lib/server-api';
import { community } from '@/lib/site';
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
    openGraph: { title: t('sessions.title'), description: t('sessions.metaDescription'), images: [DEFAULT_OG_IMAGE] },
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
  // serverGet: an API failure fails the render instead of caching "no upcoming sessions".
  const { upcoming } = (await serverGet<{ upcoming: PublicEventDto[] }>('/events')) ?? { upcoming: [] };
  const [next, ...rest] = upcoming;

  return (
    <>
      <SessionsHeader locale={locale} view="upcoming" />

      <Container className="py-12 sm:py-16 lg:py-20">
        {!next ? (
          <div className="rounded-card border border-dashed border-line-strong/50 px-6 py-12 text-center sm:py-16">
            <h2 className="text-xl sm:text-2xl">{t('sessions.empty')}</h2>
            <p className="mx-auto mt-3 max-w-md leading-relaxed text-muted">{t('sessions.emptyBody')}</p>
            <p className="mt-2 flex flex-wrap justify-center gap-x-4 text-[0.9375rem]">
              {(
                [
                  ['Telegram', community.telegram],
                  ['Discord', community.discord],
                  ['LinkedIn', community.linkedin],
                ] as const
              ).map(([name, href]) => (
                <a key={name} href={href} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center font-medium text-primary underline underline-offset-4">
                  {name}
                </a>
              ))}
            </p>
            <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <ButtonLink href={`/${locale}/sessions/recordings`} variant="secondary">
                {t('sessions.watchPast')}
              </ButtonLink>
              <ButtonLink href={`/${locale}/courses`} variant="ghost">
                {t('sessions.browseCourses')}
              </ButtonLink>
            </div>
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
              <div className="flex min-w-0 flex-1 flex-col gap-2.5">
                <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted">
                  <span className="flex items-center gap-2 font-medium text-primary">
                    <span aria-hidden className="size-2 rounded-full bg-logo-green" />
                    {t('sessions.nextUp')}
                  </span>
                  <span aria-hidden>·</span>
                  {deliveryPlatformLabels[next.platform][locale]}
                  <span aria-hidden>·</span>
                  {courseLanguageLabels[next.language][locale]}
                </p>
                <h2 id="next-up" className="text-2xl sm:text-[1.75rem]">
                  <Link href={`/${locale}/sessions/${next.slug}`} className="hover:text-primary">
                    {pick(locale, next.titleEn, next.titleAr)}
                  </Link>
                </h2>
                <p className="leading-relaxed text-muted">
                  {excerpt(pick(locale, next.descriptionEn, next.descriptionAr))} {speakerLine(next, locale)}
                </p>
              </div>
              <div className="md:shrink-0">
                <SessionAction slug={next.slug} variant="button" />
              </div>
            </article>

            {rest.length > 0 && (
              <section aria-labelledby="coming-up" className="mt-14 sm:mt-16">
                <h2 id="coming-up" className="text-2xl sm:text-[1.75rem]">
                  {t('sessions.comingUp')}
                </h2>
                <ul className="mt-6">
                  {rest.map((e) => (
                    <li key={e.slug} className="relative flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-line py-5 last:border-b sm:py-6">
                      <DateTile iso={e.startsAt} />
                      <div className="min-w-0 flex-1 basis-56">
                        <h3 className="text-base font-medium sm:text-lg">
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

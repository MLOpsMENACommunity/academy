import type { CourseSummaryDto } from '@academy/shared';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CatalogCount, CatalogForm, CatalogItem, CatalogProvider } from '@/components/course/CatalogFilters';
import { CourseCard } from '@/components/course/CourseCard';
import { Container } from '@/components/ui/Container';
import { isLocale } from '@/i18n/config';
import { createTranslator } from '@/i18n/translator';
import { alternates } from '@/lib/seo';
import { serverGet } from '@/lib/server-api';

type Props = { params: Promise<{ locale: string }> };

// Static (ISR): the same HTML for every visitor, so the edge can cache it. Filters are
// applied in the browser (CatalogFilters), never through searchParams on the server.
export const revalidate = 60;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const t = createTranslator(locale);
  return {
    title: t('catalog.title'),
    description: t('catalog.metaDescription'),
    alternates: alternates(locale, '/courses'),
    openGraph: { title: t('catalog.title'), description: t('catalog.metaDescription') },
  };
}

export default async function CatalogPage({ params }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = createTranslator(locale);
  // serverGet, not serverGetOr: if the API is down this render fails, so Next keeps the last
  // good copy (or answers an uncached 500) instead of caching an empty catalog.
  const courses = (await serverGet<CourseSummaryDto[]>('/courses')) ?? [];
  // Only the filterable fields go to the browser; the cards stay server-rendered.
  const facets = courses.map(({ id, level, type, price, language, availability }) => ({
    id,
    level,
    type,
    price,
    language,
    availability,
  }));

  return (
    <CatalogProvider courses={facets}>
      <section className="border-b border-line bg-muted-bg">
        <Container className="py-10 sm:py-14">
          <h1 className="text-[2rem] sm:text-[2.5rem]">{t('catalog.title')}</h1>
          <p className="mt-3 max-w-2xl text-lg leading-relaxed text-muted">{t('catalog.subtitle')}</p>
          <CatalogForm />
        </Container>
      </section>

      <Container className="py-10 sm:py-14">
        <CatalogCount />
        {courses.length > 0 && (
          <ul className="mt-5 grid gap-5 sm:gap-7 md:grid-cols-2">
            {courses.map((c, i) => (
              <CatalogItem key={c.id} course={facets[i]!}>
                <CourseCard course={c} locale={locale} />
              </CatalogItem>
            ))}
          </ul>
        )}
      </Container>
    </CatalogProvider>
  );
}

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { CourseSummaryDto } from '@academy/shared';
import { CourseCard } from '@/components/course/CourseCard';
import { ButtonLink } from '@/components/ui/Button';
import { Container } from '@/components/ui/Container';
import { isLocale } from '@/i18n/config';
import { createTranslator } from '@/i18n/translator';
import { alternates } from '@/lib/seo';
import { serverGetOr } from '@/lib/server-api';

export const revalidate = 300;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  return { alternates: alternates(locale, '') };
}

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = createTranslator(locale);
  const steps = [1, 2, 3] as const;
  const open = (await serverGetOr<CourseSummaryDto[]>('/courses?availability=OPEN', [], 300)).slice(0, 3);

  return (
    <>
      <section className="bg-ink text-white">
        <Container className="py-16 sm:py-24">
          <p className="text-sm font-semibold tracking-wide text-[#33cec0] uppercase">
            {t('home.eyebrow')}
          </p>
          <h1 className="mt-3 max-w-3xl text-3xl font-bold text-white sm:text-5xl">
            {t('home.title')}
          </h1>
          <p className="mt-5 max-w-2xl text-lg text-white/80">{t('home.subtitle')}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <ButtonLink href={`/${locale}/courses`} variant="accent" size="lg">
              {t('home.browse')}
            </ButtonLink>
          </div>
        </Container>
        <div aria-hidden className="h-1 w-full" style={{ background: 'var(--brand-gradient)' }} />
      </section>

      {open.length > 0 && (
        <Container className="pt-14">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="text-2xl">{t('home.featured')}</h2>
            <ButtonLink href={`/${locale}/courses`} variant="ghost" size="sm">
              {t('home.browse')} →
            </ButtonLink>
          </div>
          <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {open.map((c) => (
              <li key={c.id} className="flex">
                <CourseCard course={c} locale={locale} headingLevel="h3" />
              </li>
            ))}
          </ul>
        </Container>
      )}

      <Container className="py-14">
        <h2 className="text-2xl">{t('home.howTitle')}</h2>
        <ol className="mt-6 grid gap-4 sm:grid-cols-3">
          {steps.map((n) => (
            <li key={n} className="rounded-card border border-line bg-card p-5">
              <span className="grid size-9 place-items-center rounded-full bg-primary-soft font-bold text-primary">
                {n}
              </span>
              <h3 className="mt-3 text-lg">{t(`home.step${n}Title`)}</h3>
              <p className="mt-1 text-sm text-muted">{t(`home.step${n}Body`)}</p>
            </li>
          ))}
        </ol>
      </Container>
    </>
  );
}

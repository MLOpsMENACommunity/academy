import {
  courseAvailabilityLabels,
  courseLanguageLabels,
  courseLevelLabels,
  type CourseSummaryDto,
  type Locale,
} from '@academy/shared';
import Link from 'next/link';
import { createTranslator } from '@/i18n/translator';
import { formatDate, formatMoney } from '@/lib/format';

/** Status line colour (AA text) and its small logo-colour marker. */
export const availabilityStyle: Record<CourseSummaryDto['availability'], { text: string; dot: string }> = {
  OPEN: { text: 'text-primary', dot: 'bg-logo-green' },
  UPCOMING: { text: 'text-accent', dot: 'bg-logo-amber' },
  CLOSED: { text: 'text-muted', dot: 'bg-line-strong/50' },
};

export function priceLabel(c: Pick<CourseSummaryDto, 'type' | 'price' | 'currency'>, locale: Locale): string {
  const t = createTranslator(locale);
  if (c.type === 'FREE') return t('course.free');
  // A paid course announced before its price is set (e.g. "coming soon").
  return c.price > 0 ? formatMoney(c.price, c.currency, locale) : t('course.priceTba');
}

export function CourseCard({ course: c, locale, headingLevel = 'h2' }: { course: CourseSummaryDto; locale: Locale; headingLevel?: 'h2' | 'h3' }) {
  const t = createTranslator(locale);
  const H = headingLevel;
  const title = locale === 'ar' ? c.titleAr : c.titleEn;
  const status = availabilityStyle[c.availability];
  return (
    <article className="group relative flex w-full flex-col gap-3 rounded-card border border-line bg-card p-6 transition-colors hover:border-line-strong/40 sm:p-8">
      <p className={`flex flex-wrap items-center gap-x-2 text-sm font-medium ${c.completed ? 'text-success' : status.text}`}>
        <span aria-hidden className={`size-2 rounded-full ${c.completed ? 'bg-logo-green' : status.dot}`} />
        {c.completed
          ? c.cohortNumber
            ? t('course.completedBadge', { n: c.cohortNumber })
            : t('course.completed')
          : courseAvailabilityLabels[c.availability][locale]}
        <span aria-hidden>·</span>
        {priceLabel(c, locale)}
      </p>
      <H className="text-xl">
        <Link href={`/${locale}/courses/${c.slug}`} className="after:absolute after:inset-0 after:rounded-card focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-primary">
          {title}
        </Link>
      </H>
      <p className="line-clamp-3 leading-relaxed text-muted">{locale === 'ar' ? c.shortDescriptionAr : c.shortDescriptionEn}</p>
      <dl className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
        {c.startDate && !c.completed && (
          <div>
            <dt className="sr-only">{t('course.facts.start')}</dt>
            <dd>{t('catalog.starts', { date: formatDate(c.startDate, locale) })}</dd>
          </div>
        )}
        {c.startDate && c.completed && (
          <div>
            <dt className="sr-only">{t('course.ran')}</dt>
            <dd>{c.endDate ? t('course.range', { start: formatDate(c.startDate, locale), end: formatDate(c.endDate, locale) }) : formatDate(c.startDate, locale)}</dd>
          </div>
        )}
        {c.durationWeeks ? (
          <div>
            <dt className="sr-only">{t('course.facts.duration')}</dt>
            <dd>{t('catalog.weeks', { count: c.durationWeeks })}</dd>
          </div>
        ) : null}
        <div>
          <dt className="sr-only">{t('course.facts.level')}</dt>
          <dd>{courseLevelLabels[c.level][locale]}</dd>
        </div>
        {/* Not decided while the course is coming soon. */}
        {!c.comingSoon && (
          <div>
            <dt className="sr-only">{t('course.facts.language')}</dt>
            <dd>{courseLanguageLabels[c.language][locale]}</dd>
          </div>
        )}
        {c.seatsRemaining !== null && c.availability === 'OPEN' && (
          <div>
            <dt className="sr-only">{t('course.facts.seats')}</dt>
            <dd className={c.seatsRemaining === 0 ? 'font-medium text-danger' : ''}>
              {c.seatsRemaining === 0 ? t('catalog.full') : t('catalog.seatsLeft', { count: c.seatsRemaining })}
            </dd>
          </div>
        )}
      </dl>
      {/* Visual cue only: the title link above already covers the whole card. */}
      <span
        aria-hidden
        className="mt-auto inline-flex items-center gap-1.5 pt-2 font-medium text-fg group-hover:text-primary"
      >
        {/* "How to apply" only while applications are open. */}
        {c.availability === 'OPEN' && !c.completed
          ? t('catalog.details')
          : t('catalog.detailsOnly')}
        <span className="inline-block rtl:rotate-180">→</span>
      </span>
    </article>
  );
}

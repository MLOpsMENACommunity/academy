import {
  courseAvailabilityLabels,
  courseLanguageLabels,
  courseLevelLabels,
  type CourseSummaryDto,
  type Locale,
} from '@academy/shared';
import { createTranslator } from '@/i18n/translator';
import { formatDate, formatMoney } from '@/lib/format';
import { CatalogCard, type CardBar, type CardTone } from '../catalog/CatalogCard';

/** Status line colour (AA text) and its small logo-colour marker. */
export const availabilityStyle: Record<CourseSummaryDto['availability'], { text: string; dot: string }> = {
  OPEN: { text: 'text-success', dot: 'bg-logo-green' },
  UPCOMING: { text: 'text-accent', dot: 'bg-logo-amber' },
  CLOSED: { text: 'text-muted', dot: 'bg-line-strong/50' },
};

export function priceLabel(c: Pick<CourseSummaryDto, 'type' | 'price' | 'currency'>, locale: Locale): string {
  const t = createTranslator(locale);
  if (c.type === 'FREE') return t('course.free');
  // A paid course announced before its price is set (e.g. "coming soon").
  return c.price > 0 ? formatMoney(c.price, c.currency, locale) : t('course.priceTba');
}

/** Bar colour, chip and call to action for a course's state: green = open, amber = soon, cyan = recordings of a finished cohort. */
function courseLook(c: CourseSummaryDto, locale: Locale): { bar: CardBar; tone: CardTone; badge: string; cta: string } {
  const t = createTranslator(locale);
  if (c.completed) {
    return { bar: 'cyan', tone: 'neutral', badge: c.cohortNumber ? t('course.completedBadge', { n: c.cohortNumber }) : t('course.completed'), cta: t('catalog.detailsOnly') };
  }
  if (c.availability === 'OPEN') {
    return {
      bar: 'green',
      tone: 'success',
      badge: courseAvailabilityLabels.OPEN[locale],
      cta: c.applicationDeadline ? t('catalog.applyBy', { date: formatDate(c.applicationDeadline, locale) }) : t('catalog.details'),
    };
  }
  if (c.availability === 'UPCOMING') return { bar: 'amber', tone: 'accent', badge: courseAvailabilityLabels.UPCOMING[locale], cta: t('catalog.notifyCta') };
  return { bar: 'none', tone: 'neutral', badge: courseAvailabilityLabels.CLOSED[locale], cta: t('catalog.detailsOnly') };
}

export function CourseCard({ course: c, locale, headingLevel = 'h2' }: { course: CourseSummaryDto; locale: Locale; headingLevel?: 'h2' | 'h3' }) {
  const t = createTranslator(locale);
  const look = courseLook(c, locale);
  const when = c.startDate
    ? c.completed
      ? c.endDate
        ? t('course.range', { start: formatDate(c.startDate, locale), end: formatDate(c.endDate, locale) })
        : formatDate(c.startDate, locale)
      : t('catalog.starts', { date: formatDate(c.startDate, locale) })
    : null;
  const seats =
    c.seatsRemaining !== null && c.availability === 'OPEN' && !c.completed
      ? c.seatsRemaining === 0
        ? t('catalog.full')
        : t('catalog.seatsLeft', { count: c.seatsRemaining })
      : null;
  const meta = [
    [courseLevelLabels[c.level][locale], c.durationWeeks ? t('catalog.weeks', { count: c.durationWeeks }) : null].filter(Boolean).join(' · '),
    // The language isn't decided while the course is coming soon.
    [c.comingSoon ? null : courseLanguageLabels[c.language][locale], priceLabel(c, locale)].filter(Boolean).join(' · '),
    [when, seats].filter(Boolean).join(' · '),
  ].filter(Boolean);

  return (
    <CatalogCard
      href={`/${locale}/courses/${c.slug}`}
      title={locale === 'ar' ? c.titleAr : c.titleEn}
      headingLevel={headingLevel}
      bar={look.bar}
      badge={{ tone: look.tone, label: look.badge }}
      description={locale === 'ar' ? c.shortDescriptionAr : c.shortDescriptionEn}
      meta={meta}
      cta={look.cta}
    />
  );
}

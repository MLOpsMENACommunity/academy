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
import { Badge, type Tone } from '../ui/Badge';

const availabilityTone: Record<CourseSummaryDto['availability'], Tone> = {
  OPEN: 'success',
  UPCOMING: 'info',
  CLOSED: 'neutral',
};

export function priceLabel(c: Pick<CourseSummaryDto, 'type' | 'price' | 'currency'>, locale: Locale): string {
  return c.type === 'FREE' ? createTranslator(locale)('course.free') : formatMoney(c.price, c.currency, locale);
}

export function CourseCard({ course: c, locale, headingLevel = 'h2' }: { course: CourseSummaryDto; locale: Locale; headingLevel?: 'h2' | 'h3' }) {
  const t = createTranslator(locale);
  const H = headingLevel;
  const title = locale === 'ar' ? c.titleAr : c.titleEn;
  return (
    <article className="group relative flex w-full flex-col rounded-card border border-line bg-card p-5 transition-shadow hover:shadow-md">
      <div className="flex flex-wrap gap-2">
        <Badge tone={availabilityTone[c.availability]}>{courseAvailabilityLabels[c.availability][locale]}</Badge>
        <Badge tone={c.type === 'FREE' ? 'primary' : 'accent'}>{priceLabel(c, locale)}</Badge>
        <Badge>{courseLevelLabels[c.level][locale]}</Badge>
      </div>
      <H className="mt-3 text-lg">
        <Link href={`/${locale}/courses/${c.slug}`} className="after:absolute after:inset-0 focus-visible:outline-none">
          {title}
        </Link>
      </H>
      <p className="mt-2 line-clamp-3 text-sm text-muted">{locale === 'ar' ? c.shortDescriptionAr : c.shortDescriptionEn}</p>
      <dl className="mt-auto grid grid-cols-2 gap-x-3 gap-y-1 pt-4 text-xs text-body">
        {c.startDate && (
          <div>
            <dt className="sr-only">{t('course.facts.start')}</dt>
            <dd>{t('catalog.starts', { date: formatDate(c.startDate, locale) })}</dd>
          </div>
        )}
        {c.durationWeeks && (
          <div>
            <dt className="sr-only">{t('course.facts.duration')}</dt>
            <dd>{t('catalog.weeks', { count: c.durationWeeks })}</dd>
          </div>
        )}
        <div>
          <dt className="sr-only">{t('course.facts.language')}</dt>
          <dd>{courseLanguageLabels[c.language][locale]}</dd>
        </div>
        {c.seatsRemaining !== null && c.availability === 'OPEN' && (
          <div>
            <dt className="sr-only">{t('course.facts.seats')}</dt>
            <dd className={c.seatsRemaining === 0 ? 'font-semibold text-danger' : ''}>
              {c.seatsRemaining === 0 ? t('catalog.full') : t('catalog.seatsLeft', { count: c.seatsRemaining })}
            </dd>
          </div>
        )}
      </dl>
    </article>
  );
}

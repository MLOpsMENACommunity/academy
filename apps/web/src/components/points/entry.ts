import type { Locale, PointsEntryDto } from '@academy/shared';
import type { Translate } from '@/i18n/translator';

/** What a ledger line says: the source (assessment or session title), the course, or the admin's note. */
export function entryText(e: PointsEntryDto, locale: Locale, t: Translate): string {
  const title = e.label ? (locale === 'ar' ? e.label.ar : e.label.en) : null;
  const course = e.course ? (locale === 'ar' ? e.course.titleAr : e.course.titleEn) : null;
  let text: string;
  switch (e.reason) {
    case 'ASSESSMENT':
      text = t(e.adjustment ? 'points.reason.assessmentUpdated' : 'points.reason.assessment', { title: title ?? course ?? '' });
      break;
    case 'SESSION_COMPLETED':
      text = t(e.points < 0 ? 'points.reason.sessionUndone' : 'points.reason.session', { title: title ?? '' });
      break;
    case 'ATTENDANCE':
      text = t(e.adjustment ? 'points.reason.attendanceUpdated' : 'points.reason.attendance', { title: title ?? '' });
      break;
    case 'CERTIFICATE':
      text = t('points.reason.certificate', { course: course ?? '' });
      break;
    default:
      text = e.note || t(`points.reasons.${e.reason}`);
  }
  return text;
}

export function signed(n: number, locale: Locale): string {
  const s = new Intl.NumberFormat(locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en', { signDisplay: 'exceptZero' }).format(n);
  return s;
}

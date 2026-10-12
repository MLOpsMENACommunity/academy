import { trueFalseKey, type Locale, type QuizQuestionKind } from '@academy/shared';

/**
 * Assessment wording is written in English (Arabic only when it was added before the
 * editor became English-only). On the Arabic site: Arabic when there is some, else the
 * English, marked left-to-right so it reads properly inside the Arabic page.
 */
export function assessmentText(locale: Locale, en: string, ar: string | null | undefined): { text: string; dir?: 'ltr' } {
  if (locale === 'ar' && ar) return { text: ar };
  return locale === 'ar' ? { text: en, dir: 'ltr' } : { text: en };
}

/** An option's label; true/false options show "True"/"False" in the page's language. */
export function optionText(
  locale: Locale,
  t: (key: string) => string,
  kind: QuizQuestionKind,
  o: { labelEn: string; labelAr: string },
  index: number,
): { text: string; dir?: 'ltr' } {
  const tf = trueFalseKey(kind, o.labelEn, index);
  return tf ? { text: t(`assessments.${tf}`) } : assessmentText(locale, o.labelEn, o.labelAr);
}

import { topicLabel, type Locale, type SpeakerRefDto } from '@academy/shared';
import { createTranslator } from '@/i18n/translator';
import { pick } from './sessions';

/** "45 min", "3 h", "3 h 5 min" in the reader's language. */
export function durationLabel(minutes: number, locale: Locale): string {
  const t = createTranslator(locale);
  if (minutes < 60) return t('sessions.minutes', { count: minutes });
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? t('sessions.durationHM', { h, m }) : t('sessions.durationH', { h });
}

export const speakerPath = (locale: Locale, slug: string) => `/${locale}/speakers/${slug}`;

export const speakerName = (locale: Locale, s: Pick<SpeakerRefDto, 'name' | 'nameAr'>) => pick(locale, s.name, s.nameAr);

/** The tag's label, for chips and filters. */
export const topicText = (locale: Locale, tag: string) => topicLabel(tag, locale);

export const youtubeThumbnail = (id: string) => `https://i.ytimg.com/vi/${encodeURIComponent(id)}/hqdefault.jpg`;

/** ISO 8601 duration for schema.org ("PT1H45M"). */
export function isoDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `PT${h ? `${h}H` : ''}${m || !h ? `${m}M` : ''}`;
}

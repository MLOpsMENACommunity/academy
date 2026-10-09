import type { Locale } from '@academy/shared';
import { YouTubeFacade } from '@/components/learn/YouTubeFacade';
import { buttonClass } from '@/components/ui/Button';
import { createTranslator } from '@/i18n/translator';

/** YouTube recordings play in place (click to load); any other link opens in a new tab. */
export function RecordingPlayer({
  url,
  youtubeId,
  title,
  locale,
  sizes,
}: {
  url: string;
  youtubeId: string | null;
  title: string;
  locale: Locale;
  /** The player's displayed width (the `sizes` of its thumbnail). */
  sizes?: string;
}) {
  if (youtubeId) return <YouTubeFacade id={youtubeId} title={title} sizes={sizes} />;
  const t = createTranslator(locale);
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className={buttonClass('secondary', 'md')}>
      {t('sessions.openRecording')} <span aria-hidden>↗</span>
    </a>
  );
}

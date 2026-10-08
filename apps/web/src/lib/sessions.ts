import { eventEnded, type Locale, type PublicEventDto } from '@academy/shared';
import { intlLocale } from '@/i18n/config';

/** What the register area of a live session shows. */
export type RegisterState = 'cancelled' | 'ended' | 'live' | 'registered' | 'full' | 'open';

/**
 * Cancelled and ended sessions take no registrations. A registered person sees
 * the join link once the API reveals it ("live"), otherwise their registration.
 * `now` matters because public pages are cached: a session can end after the
 * page was rendered.
 */
export function registerState(
  e: Pick<PublicEventDto, 'status' | 'past' | 'full' | 'startsAt' | 'durationMin' | 'me'>,
  now = new Date(),
): RegisterState {
  if (e.status === 'CANCELLED') return 'cancelled';
  if (e.past || eventEnded(new Date(e.startsAt), e.durationMin, now)) return 'ended';
  if (e.me?.registered) return e.me.liveUrl ? 'live' : 'registered';
  if (e.full) return 'full';
  return 'open';
}

/** Milliseconds until the live link is due, when that's soon enough to wait for on an open page. */
export function msUntilLink(e: Pick<PublicEventDto, 'me'>, now = new Date(), maxWaitMs = 6 * 3_600_000): number | null {
  if (!e.me?.registered || e.me.liveUrl) return null;
  const ms = new Date(e.me.liveUrlFrom).getTime() - now.getTime();
  return ms > 0 && ms <= maxWaitMs ? ms : null;
}

/** Arabic text when there is one, English otherwise. */
export function pick(locale: Locale, en: string, ar: string | null | undefined): string {
  return locale === 'ar' && ar ? ar : en;
}

/** A plain one-paragraph teaser from a markdown description. */
export function excerpt(markdown: string, max = 180): string {
  const para =
    markdown
      .replace(/\r/g, '')
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .find((p) => p && !/^(#|```|>|---|\|)/.test(p)) ?? '';
  const plain = para
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s*(?:[-*+]|\d+\.)\s+/gm, '')
    .replace(/[*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (plain.length <= max) return plain;
  const cut = plain.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:،؛-]+$/, '')}…`;
}

export interface DateParts {
  weekday: string;
  day: string;
  month: string;
  time: string;
}

/** The pieces of the big date block, in the reader's language and time zone. */
export function dateParts(iso: string, locale: Locale, timeZone: string): DateParts {
  const d = new Date(iso);
  const f = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(intlLocale(locale), { ...o, timeZone }).format(d);
  return {
    weekday: f({ weekday: 'long' }),
    day: f({ day: 'numeric' }),
    month: f({ month: 'short' }),
    time: f({ hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }),
  };
}

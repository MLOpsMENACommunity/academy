import type { ConsultantCardDto, ConsultationStatus, Locale } from '@academy/shared';
import Image from 'next/image';
import { Badge, type Tone } from '@/components/ui/Badge';
import { intlLocale } from '@/i18n/config';
import type { Translate } from '@/i18n/translator';
import { formatMoney } from '@/lib/format';
import { pick } from '@/lib/sessions';

export const STATUS_TONE: Record<ConsultationStatus, Tone> = {
  PAYMENT_REVIEW: 'warning',
  REJECTED: 'danger',
  PAID: 'info',
  CONFIRMED: 'success',
  CANCELLED: 'neutral',
};

export function StatusBadge({ status, t }: { status: ConsultationStatus; t: Translate }) {
  return <Badge tone={STATUS_TONE[status]}>{t(`consultations.status.${status}`)}</Badge>;
}

export const egp = (amount: number, locale: Locale) => formatMoney(amount, 'EGP', locale);

/** "Sun 26 Oct" in the given zone. */
export function dayLabel(iso: string, locale: Locale, timeZone: string): string {
  return new Intl.DateTimeFormat(intlLocale(locale), { weekday: 'short', day: 'numeric', month: 'short', timeZone }).format(new Date(iso));
}

/** "18:30" in the given zone. */
export function timeLabel(iso: string, locale: Locale, timeZone: string): string {
  return new Intl.DateTimeFormat(intlLocale(locale), { hour: 'numeric', minute: '2-digit', timeZone }).format(new Date(iso));
}

/** "Sun 26 Oct, 18:30 EET" in the given zone. */
export function whenLabel(iso: string, locale: Locale, timeZone: string): string {
  return new Intl.DateTimeFormat(intlLocale(locale), { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZoneName: 'short', timeZone }).format(
    new Date(iso),
  );
}

/** The calendar date (YYYY-MM-DD) an instant falls on in a zone, for grouping slots by day. */
export function dateKey(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone }).format(new Date(iso));
}

const tints = ['bg-logo-cyan-soft text-info', 'bg-logo-green-soft text-success', 'bg-logo-amber-soft text-accent', 'bg-logo-orange-soft text-accent'] as const;

export function ExpertAvatar({ name, photoUrl, index = 0, size = 'md' }: { name: string; photoUrl: string | null; index?: number; size?: 'md' | 'lg' }) {
  const dim = size === 'lg' ? 'size-24' : 'size-16';
  if (photoUrl) {
    // unoptimized: photos are small already, and admins may paste them from any host.
    return <Image src={photoUrl} alt="" width={96} height={96} unoptimized className={`${dim} shrink-0 rounded-full bg-muted-bg object-cover ring-1 ring-line`} />;
  }
  const letters = name
    .replace(/^(eng|dr|prof)\.?\s+/i, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
  return (
    <span aria-hidden className={`grid ${dim} shrink-0 place-items-center rounded-full text-lg font-semibold ${tints[index % tints.length]}`}>
      {letters}
    </span>
  );
}

/** "30 min · EGP 400" lines for the call lengths an expert offers. */
export function priceLines(e: Pick<ConsultantCardDto, 'price30Egp' | 'price60Egp'>, locale: Locale, t: Translate): string[] {
  return (
    [
      [30, e.price30Egp],
      [60, e.price60Egp],
    ] as const
  )
    .filter(([, p]) => p !== null)
    .map(([min, p]) => t('consultations.priceLine', { min, price: egp(p!, locale) }));
}

export const expertName = (e: { name: string; nameAr: string | null }, locale: Locale) => pick(locale, e.name, e.nameAr);

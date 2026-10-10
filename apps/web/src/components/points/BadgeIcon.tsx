import type { Locale } from '@academy/shared';

/** A badge as its emoji in a round tile, named for screen readers and on hover. */
export function BadgeIcon({
  icon,
  name,
  size = 'md',
}: {
  icon: string;
  name: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  const box = size === 'sm' ? 'size-7 text-base' : size === 'lg' ? 'size-12 text-2xl' : 'size-9 text-lg';
  return (
    <span role="img" aria-label={name} title={name} className={`inline-grid ${box} shrink-0 place-items-center rounded-full border border-line bg-muted-bg leading-none`}>
      {icon}
    </span>
  );
}

export function badgeName(b: { nameEn: string; nameAr: string }, locale: Locale, period?: number | null, weekLabel?: (n: number) => string): string {
  const name = locale === 'ar' ? b.nameAr || b.nameEn : b.nameEn;
  return period && weekLabel ? `${name} · ${weekLabel(period)}` : name;
}

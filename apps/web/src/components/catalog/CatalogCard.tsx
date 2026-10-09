import Link from 'next/link';
import type { ReactNode } from 'react';
import { Arrow } from '../ui/Icons';

/** Colour bar on top of a card: one meaning per colour (see globals.css). */
export type CardBar = 'cyan' | 'green' | 'amber' | 'orange' | 'none';
export type CardTone = 'success' | 'accent' | 'info' | 'neutral';

const bars: Record<CardBar, string> = {
  cyan: 'bg-logo-cyan',
  green: 'bg-logo-green',
  amber: 'bg-logo-amber',
  orange: 'bg-logo-orange',
  none: 'bg-transparent',
};
export const toneClass: Record<CardTone, string> = {
  success: 'bg-success-soft text-success',
  accent: 'bg-accent-soft text-accent',
  info: 'bg-info-soft text-info',
  neutral: 'bg-muted-bg text-body',
};

/**
 * The one card used across catalogs (courses, paths, live sessions, recordings), so
 * every list reads the same way: status chip, title, one-line description, a fixed
 * metadata block, then the call to action. The title link covers the whole card.
 */
export function CatalogCard({
  href,
  title,
  bar = 'none',
  badge,
  description,
  meta = [],
  cta,
  headingLevel = 'h3',
  media,
  external,
}: {
  href: string;
  title: string;
  bar?: CardBar;
  badge?: { tone: CardTone; label: string };
  description?: string | null;
  meta?: (string | ReactNode)[];
  cta?: string;
  headingLevel?: 'h2' | 'h3';
  /** Optional block above the text (e.g. a date tile). */
  media?: ReactNode;
  external?: boolean;
}) {
  const H = headingLevel;
  const linkClass =
    'after:absolute after:inset-0 after:rounded-card hover:text-primary focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-primary';
  return (
    <article className="group relative flex w-full min-w-0 flex-col overflow-hidden rounded-card border border-line bg-card transition-colors hover:border-line-strong/50">
      <div aria-hidden className={`h-1.5 ${bars[bar]}`} />
      <div className="flex flex-1 flex-col gap-3 px-5 pt-5 pb-6 sm:px-6">
        {media}
        {badge && <span className={`self-start rounded-md px-2.5 py-0.5 text-[0.8125rem] font-medium ${toneClass[badge.tone]}`}>{badge.label}</span>}
        <H className="text-[1.1875rem] leading-snug">
          {external ? (
            <a href={href} target="_blank" rel="noopener noreferrer" className={linkClass}>
              {title}
            </a>
          ) : (
            <Link href={href} className={linkClass}>
              {title}
            </Link>
          )}
        </H>
        {description && <p className="line-clamp-3 flex-1 text-[0.9375rem] leading-relaxed text-muted">{description}</p>}
        {meta.length > 0 && (
          <div className={`flex flex-col gap-1 border-t border-line-soft pt-3 text-[0.8125rem] text-muted ${description ? '' : 'mt-auto'}`}>
            {meta.map((m, i) => (
              <span key={i}>{m}</span>
            ))}
          </div>
        )}
        {cta && (
          <span aria-hidden className="inline-flex items-center gap-1.5 pt-1 font-medium text-primary group-hover:text-primary-hover group-hover:underline">
            {cta} <Arrow />
          </span>
        )}
      </div>
    </article>
  );
}

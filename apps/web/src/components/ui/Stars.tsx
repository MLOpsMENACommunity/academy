import { RATING_MAX } from '@academy/shared';

const STAR = 'M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8z';

/**
 * A read-only star rating ("Rated 4 out of 5" for screen readers). Server- and client-safe: the
 * caller passes the translated label. In Arabic the stars fill from the right, like the text.
 */
export function Stars({ value, label, className = '' }: { value: number; label: string; className?: string }) {
  return (
    <span role="img" aria-label={label} className={`inline-flex items-center gap-0.5 ${className}`}>
      {Array.from({ length: RATING_MAX }, (_, i) => (
        <svg
          key={i}
          viewBox="0 0 24 24"
          aria-hidden
          className={`size-4 ${i < value ? 'fill-accent text-accent' : 'fill-transparent text-line-strong'}`}
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <path d={STAR} />
        </svg>
      ))}
    </span>
  );
}

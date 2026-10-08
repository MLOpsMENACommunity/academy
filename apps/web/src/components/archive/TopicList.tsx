import type { Locale } from '@academy/shared';
import { topicText } from '@/lib/archive';

/** A session's tags as small neutral chips. */
export function TopicList({ topics, locale, label, className = '' }: { topics: string[]; locale: Locale; label: string; className?: string }) {
  if (!topics.length) return null;
  return (
    <ul aria-label={label} className={`flex flex-wrap gap-1.5 ${className}`}>
      {topics.map((tag) => (
        <li key={tag} className="rounded-full bg-muted-bg px-2.5 py-0.5 text-xs font-medium text-body">
          {topicText(locale, tag)}
        </li>
      ))}
    </ul>
  );
}

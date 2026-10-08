'use client';

import { useId } from 'react';
import { useI18n } from '@/i18n/client';

/** 1–5 rating as a radio group (keyboard: arrow keys; screen readers: "4 out of 5"). */
export function StarRating({ legend, value, onChange }: { legend: string; value: number; onChange: (n: number) => void }) {
  const { t } = useI18n();
  const name = useId();
  return (
    <fieldset>
      <legend className="mb-1 text-sm font-semibold text-fg">{legend}</legend>
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <label key={n} className="cursor-pointer has-[:focus-visible]:rounded has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-cyan">
            <input type="radio" name={name} className="sr-only" checked={value === n} onChange={() => onChange(n)} aria-label={t('learn.stars', { n })} />
            <svg viewBox="0 0 24 24" aria-hidden className={`size-8 ${n <= value ? 'fill-accent text-accent' : 'fill-transparent text-line-strong'}`} stroke="currentColor" strokeWidth="1.5">
              <path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8z" />
            </svg>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

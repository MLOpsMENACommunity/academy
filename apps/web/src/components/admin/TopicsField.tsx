'use client';

import { parseTopics, topicLabel } from '@academy/shared';
import { useState } from 'react';
import { TextField } from '@/components/forms/fields';
import { useI18n } from '@/i18n/client';

/**
 * Tags typed as a comma-separated list ("docker, ci-cd"). The text stays as typed while
 * editing; the parsed tags (lowercase, dashes) are shown underneath and saved.
 */
export function TopicsField({ label, hint, value, onChange, error }: { label: string; hint: string; value: string[]; onChange: (tags: string[]) => void; error?: string }) {
  const { locale } = useI18n();
  const [text, setText] = useState(value.join(', '));
  return (
    <div>
      <TextField
        label={label}
        hint={hint}
        dir="ltr"
        value={text}
        error={error}
        onChange={(x) => {
          setText(x);
          onChange(parseTopics(x));
        }}
      />
      {value.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5" aria-hidden>
          {value.map((tag) => (
            <li key={tag} className="rounded-full bg-muted-bg px-2.5 py-0.5 text-xs font-medium text-body">
              {topicLabel(tag, locale)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

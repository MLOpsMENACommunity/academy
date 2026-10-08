'use client';

import { useId } from 'react';
import { useI18n } from '@/i18n/client';

export interface Opt {
  value: string;
  label: string;
}

/** Compact multi-select: a disclosure with a checkbox list (works with keyboard and screen readers). */
export function MultiSelect({ label, options, value, onChange }: { label: string; options: Opt[]; value: string[]; onChange: (v: string[]) => void }) {
  const { t } = useI18n();
  const id = useId();
  const summary = value.length === 0 ? t('admin.common.any') : value.length <= 2 ? options.filter((o) => value.includes(o.value)).map((o) => o.label).join(', ') : t('admin.common.selected', { count: value.length });
  return (
    <div>
      <span id={`${id}-label`} className="mb-1 block text-xs font-semibold text-fg">
        {label}
      </span>
      <details className="group relative">
        <summary
          aria-labelledby={`${id}-label ${id}-value`}
          className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-2 rounded-lg border border-line-strong bg-card px-3 text-sm marker:hidden"
        >
          <span id={`${id}-value`} className="truncate">
            {summary}
          </span>
          <span aria-hidden className="text-muted group-open:rotate-180">▾</span>
        </summary>
        <div className="absolute z-30 mt-1 max-h-64 w-full min-w-56 overflow-y-auto rounded-lg border border-line bg-card p-2 shadow-lg">
          {value.length > 0 && (
            <button type="button" className="mb-1 text-xs text-primary underline" onClick={() => onChange([])}>
              {t('admin.common.reset')}
            </button>
          )}
          {options.map((o) => (
            <label key={o.value} className="flex min-h-9 cursor-pointer items-center gap-2 rounded px-1 text-sm hover:bg-muted-bg">
              <input
                type="checkbox"
                checked={value.includes(o.value)}
                onChange={(e) => onChange(e.target.checked ? [...value, o.value] : value.filter((v) => v !== o.value))}
                className="size-4 accent-[var(--brand-primary)]"
              />
              {o.label}
            </label>
          ))}
        </div>
      </details>
    </div>
  );
}

'use client';

import { useId, useRef } from 'react';
import { inputClass } from '@/components/ui/input';
import { Button } from '@/components/ui/Button';
import { useI18n } from '@/i18n/client';

/**
 * A list of email addresses, one row each: add, edit and remove rows. Errors come keyed
 * like the form's zod issues: `${name}.${index}` per row, `${name}` for the whole list.
 */
export function EmailListEditor({
  name,
  legend,
  hint,
  value,
  onChange,
  errors,
  max,
}: {
  name: string;
  legend: string;
  hint?: string;
  value: string[];
  onChange: (v: string[]) => void;
  errors: Record<string, string>;
  max: number;
}) {
  const { t } = useI18n();
  const id = useId();
  const list = useRef<HTMLUListElement>(null);
  const listError = errors[name];

  function add() {
    onChange([...value, '']);
    // Focus the new row once it's rendered.
    requestAnimationFrame(() => list.current?.querySelector<HTMLInputElement>('li:last-child input')?.focus());
  }

  return (
    <fieldset aria-describedby={[hint ? `${id}-hint` : '', listError ? `${id}-err` : ''].filter(Boolean).join(' ') || undefined}>
      <legend className="text-lg font-semibold text-fg">{legend}</legend>
      {hint && (
        <p id={`${id}-hint`} className="mt-1 text-sm text-muted">
          {hint}
        </p>
      )}
      <ul ref={list} className="mt-3 space-y-2">
        {value.map((email, i) => {
          const err = errors[`${name}.${i}`];
          return (
            <li key={i}>
              <div className="flex items-start gap-2">
                <label className="sr-only" htmlFor={`${id}-${i}`}>
                  {t('admin.settings.teamEmailRow', { n: i + 1 })}
                </label>
                <input
                  id={`${id}-${i}`}
                  type="email"
                  dir="ltr"
                  autoComplete="off"
                  className={`${inputClass} flex-1`}
                  value={email}
                  aria-invalid={err ? true : undefined}
                  aria-describedby={err ? `${id}-${i}-err` : undefined}
                  onChange={(e) => onChange(value.map((v, j) => (j === i ? e.target.value : v)))}
                />
                <Button type="button" variant="ghost" onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label={t('admin.settings.teamEmailRemove', { email: email || String(i + 1) })}>
                  {t('forms.remove')}
                </Button>
              </div>
              {err && (
                <p id={`${id}-${i}-err`} className="mt-1 text-sm font-medium text-danger">
                  {err}
                </p>
              )}
            </li>
          );
        })}
      </ul>
      {value.length === 0 && <p className="mt-2 text-sm text-warning">{t('admin.settings.teamEmailsEmpty')}</p>}
      {listError && (
        <p id={`${id}-err`} className="mt-2 text-sm font-medium text-danger">
          {listError}
        </p>
      )}
      <Button type="button" variant="secondary" size="sm" className="mt-3" onClick={add} disabled={value.length >= max}>
        + {t('admin.settings.teamEmailAdd')}
      </Button>
      <p className="mt-1 text-xs text-muted">{t('admin.settings.teamEmailsCount', { n: value.length, max })}</p>
    </fieldset>
  );
}

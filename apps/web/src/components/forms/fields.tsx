'use client';

import { useId, useState, type ComponentProps, type KeyboardEvent, type ReactNode } from 'react';
import { useI18n } from '@/i18n/client';
import { inputClass } from '../ui/input';
import { addTag } from './tags';

/** Controls that can be focused and carry aria-invalid (radios and checkboxes included). */
const INVALID_CONTROL = 'input[aria-invalid="true"], select[aria-invalid="true"], textarea[aria-invalid="true"]';

/**
 * Moves keyboard and screen-reader focus to the first invalid control inside
 * `root` (the form), in document order. For a radio or chip group that is its
 * first option. Runs after React has rendered the new errors.
 */
export function focusFirstInvalid(root?: HTMLElement | null): void {
  requestAnimationFrame(() => {
    (root ?? document).querySelector<HTMLElement>(INVALID_CONTROL)?.focus();
  });
}

export interface Option {
  value: string;
  label: string;
}

interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  required?: boolean;
  children: (ids: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode;
  className?: string;
}

/** Label + control + hint + error, wired together for screen readers. */
export function Field({ label, hint, error, required, children, className = '' }: FieldProps) {
  const id = useId();
  const { t } = useI18n();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block text-sm font-semibold text-fg">
        {label}
        {required ? (
          <span className="text-danger" aria-hidden>
            {' '}
            *
          </span>
        ) : (
          <span className="ms-1 text-xs font-normal text-muted">({t('common.optional')})</span>
        )}
      </label>
      {children({ id, describedBy, invalid: Boolean(error) })}
      {hint && (
        <p id={hintId} className="mt-1 text-xs text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="mt-1 text-sm font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

type TextProps = Omit<ComponentProps<'input'>, 'onChange' | 'value'> & {
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  value: string | null | undefined;
  onChange: (v: string) => void;
};

export function TextField({ label, hint, error, required, value, onChange, className, ...rest }: TextProps) {
  return (
    <Field label={label} hint={hint} error={error} required={required} className={className}>
      {({ id, describedBy, invalid }) => (
        <input
          id={id}
          className={inputClass}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          required={required}
          {...rest}
        />
      )}
    </Field>
  );
}

export function TextAreaField({
  label,
  hint,
  error,
  required,
  value,
  onChange,
  rows = 4,
  maxLength,
  dir,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  required?: boolean;
  value: string | null | undefined;
  onChange: (v: string) => void;
  rows?: number;
  maxLength?: number;
  dir?: 'rtl' | 'ltr' | 'auto';
}) {
  return (
    <Field label={label} hint={hint} error={error} required={required}>
      {({ id, describedBy, invalid }) => (
        <textarea
          id={id}
          dir={dir}
          rows={rows}
          maxLength={maxLength}
          className={`${inputClass} min-h-24`}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          required={required}
        />
      )}
    </Field>
  );
}

export function SelectField({
  label,
  hint,
  error,
  required,
  value,
  onChange,
  options,
  placeholder,
  groups,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  required?: boolean;
  value: string | null | undefined;
  onChange: (v: string | null) => void;
  options: Option[];
  placeholder?: string;
  /** Optional leading group (e.g. MENA countries) rendered above the rest. */
  groups?: { label: string; options: Option[] }[];
}) {
  const { t } = useI18n();
  return (
    <Field label={label} hint={hint} error={error} required={required}>
      {({ id, describedBy, invalid }) => (
        <select
          id={id}
          className={inputClass}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value || null)}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          required={required}
        >
          <option value="">{placeholder ?? t('forms.choose')}</option>
          {groups?.map((g) => (
            <optgroup key={g.label} label={g.label}>
              {g.options.map((o) => (
                <option key={`${g.label}-${o.value}`} value={o.value}>
                  {o.label}
                </option>
              ))}
            </optgroup>
          ))}
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

/** Multi-select as a group of toggleable chips (checkboxes under the hood). */
export function ChipGroup({
  legend,
  hint,
  error,
  options,
  value,
  onChange,
  required,
}: {
  legend: ReactNode;
  hint?: ReactNode;
  error?: string;
  options: Option[];
  value: string[];
  onChange: (v: string[]) => void;
  required?: boolean;
}) {
  const { t } = useI18n();
  const id = useId();
  const toggle = (v: string) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  const describedBy = [hint ? `${id}-hint` : '', error ? `${id}-err` : ''].filter(Boolean).join(' ') || undefined;
  return (
    <fieldset aria-describedby={describedBy} data-invalid={error ? 'true' : undefined}>
      <legend className="mb-1.5 text-sm font-semibold text-fg">
        {legend}
        {required ? (
          <span className="text-danger" aria-hidden>
            {' '}
            *
          </span>
        ) : (
          <span className="ms-1 text-xs font-normal text-muted">({t('common.optional')})</span>
        )}
      </legend>
      {hint && (
        <p id={`${id}-hint`} className="mb-2 text-xs text-muted">
          {hint}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {options.map((o) => {
          const checked = value.includes(o.value);
          return (
            <label
              key={o.value}
              className={`inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-cyan ${
                checked ? 'border-primary bg-primary-soft font-semibold text-primary' : 'border-line-strong bg-card text-body hover:bg-muted-bg'
              }`}
            >
              <input
                type="checkbox"
                className="sr-only"
                checked={checked}
                onChange={() => toggle(o.value)}
                aria-invalid={error ? true : undefined}
              />
              <span aria-hidden>{checked ? '✓' : '+'}</span>
              {o.label}
            </label>
          );
        })}
      </div>
      {error && (
        <p id={`${id}-err`} className="mt-1 text-sm font-medium text-danger">
          {error}
        </p>
      )}
    </fieldset>
  );
}

/** Single choice as radio buttons (better than a select for 2–6 options on mobile). */
export function RadioGroup({
  legend,
  hint,
  error,
  options,
  value,
  onChange,
  required,
  name,
}: {
  legend: ReactNode;
  hint?: ReactNode;
  error?: string;
  /** An option may carry a line under its label explaining what it means. */
  options: (Option & { description?: string })[];
  value: string | null | undefined;
  onChange: (v: string) => void;
  required?: boolean;
  name?: string;
}) {
  const { t } = useI18n();
  const id = useId();
  return (
    <fieldset
      role="radiogroup"
      aria-describedby={[hint ? `${id}-hint` : '', error ? `${id}-err` : ''].filter(Boolean).join(' ') || undefined}
      aria-required={required || undefined}
      aria-invalid={error ? true : undefined}
      data-invalid={error ? 'true' : undefined}
    >
      <legend className="mb-1.5 text-sm font-semibold text-fg">
        {legend}
        {required ? (
          <span className="text-danger" aria-hidden>
            {' '}
            *
          </span>
        ) : (
          <span className="ms-1 text-xs font-normal text-muted">({t('common.optional')})</span>
        )}
      </legend>
      {hint && (
        <p id={`${id}-hint`} className="mb-2 text-xs text-muted">
          {hint}
        </p>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((o) => (
          <label
            key={o.value}
            className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-cyan ${
              value === o.value ? 'border-primary bg-primary-soft text-fg' : 'border-line-strong bg-card'
            }`}
          >
            <input
              type="radio"
              name={name ?? id}
              value={o.value}
              checked={value === o.value}
              onChange={() => onChange(o.value)}
              className="size-4 shrink-0 accent-[var(--brand-primary)]"
              required={required}
              aria-invalid={error ? true : undefined}
            />
            {o.description ? (
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="font-semibold text-fg">{o.label}</span>
                <span className="text-xs text-muted">{o.description}</span>
              </span>
            ) : (
              o.label
            )}
          </label>
        ))}
      </div>
      {error && (
        <p id={`${id}-err`} className="mt-1 text-sm font-medium text-danger">
          {error}
        </p>
      )}
    </fieldset>
  );
}

export function CheckboxField({
  label,
  hint,
  checked,
  onChange,
  error,
}: {
  /** Plain text: it is the checkbox's accessible name. Put links in `hint`. */
  label: ReactNode;
  hint?: ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
  error?: string;
}) {
  const id = useId();
  const describedBy = [hint ? `${id}-h` : '', error ? `${id}-e` : ''].filter(Boolean).join(' ') || undefined;
  return (
    <div>
      <div className="flex items-start gap-3">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-1 size-5 shrink-0 accent-[var(--brand-primary)]"
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
        />
        <label htmlFor={id} className="text-sm text-fg">
          {label}
        </label>
      </div>
      {hint && (
        <p id={`${id}-h`} className="ms-8 mt-1 text-xs text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-e`} className="ms-8 mt-1 text-xs font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

/** 1–5 self-assessment for one skill, with the meaning of the selected level. */
export function SkillScale({
  label,
  value,
  onChange,
  levelLabels,
}: {
  label: string;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  levelLabels: Record<number, string>;
}) {
  const { t } = useI18n();
  const id = useId();
  return (
    <fieldset className="rounded-lg border border-line p-3">
      <legend className="px-1 text-sm font-semibold text-fg">{label}</legend>
      <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-describedby={`${id}-d`}>
        {[1, 2, 3, 4, 5].map((n) => (
          <label
            key={n}
            className={`grid size-10 cursor-pointer place-items-center rounded-lg border text-sm font-semibold has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-cyan ${
              value === n ? 'border-primary bg-primary text-white' : 'border-line-strong bg-card text-fg hover:bg-muted-bg'
            }`}
            title={levelLabels[n]}
          >
            <input
              type="radio"
              className="sr-only"
              name={id}
              checked={value === n}
              onChange={() => onChange(n)}
              aria-label={`${n}: ${levelLabels[n]}`}
            />
            {n}
          </label>
        ))}
        {value !== undefined && (
          <button
            type="button"
            onClick={() => onChange(undefined)}
            className="ms-1 min-h-10 rounded-lg px-2 text-xs text-muted underline hover:text-fg"
          >
            {t('forms.clear')}
          </button>
        )}
      </div>
      <p id={`${id}-d`} className="mt-1.5 min-h-5 text-xs text-muted">
        {value ? levelLabels[value] : t('forms.notRated')}
      </p>
    </fieldset>
  );
}

/**
 * Free-form tags (e.g. production tools). Enter or comma adds a tag. The input
 * is cleared after every attempt; a duplicate is announced ("already added")
 * rather than left in the box, and the length limit is shown, never applied
 * silently.
 */
export function TagInput({
  label,
  hint,
  value,
  onChange,
  suggestions = [],
  max = 30,
  maxLength = 40,
}: {
  label: ReactNode;
  hint?: ReactNode;
  value: string[];
  onChange: (v: string[]) => void;
  suggestions?: string[];
  max?: number;
  /** Longest tag accepted; the input stops there and shows a counter. */
  maxLength?: number;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState('');
  const [notice, setNotice] = useState('');
  const add = (raw: string) => {
    const r = addTag(value, raw, { max, maxLength });
    if (!r.tag) return;
    if (r.rejected === 'duplicate') setNotice(t('forms.alreadyAdded', { tag: r.tag }));
    else if (r.rejected === 'tooLong') setNotice(t('forms.errors.tooLong', { max: maxLength }));
    else if (r.rejected === 'full') setNotice(t('forms.tagLimit', { max }));
    else {
      setNotice('');
      onChange(r.next);
    }
    // Never leave a duplicate in the box (the next word would be typed onto it); keep the
    // text when the list is full so nothing typed is lost.
    if (r.rejected !== 'full') setDraft('');
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      add(draft);
    } else if (e.key === 'Backspace' && !draft && value.length) {
      onChange(value.slice(0, -1));
    }
  };
  const unused = suggestions.filter((s) => !value.some((v) => v.toLowerCase() === s.toLowerCase()));
  return (
    <Field label={label} hint={hint}>
      {({ id, describedBy }) => (
        <div>
          {value.length > 0 && (
            <ul className="mb-2 flex flex-wrap gap-2" aria-label={t('forms.selected')}>
              {value.map((tag) => (
                <li key={tag} className="inline-flex items-center gap-1 rounded-full bg-primary-soft py-1 ps-3 pe-1 text-sm text-primary">
                  <span className="ltr-embed">{tag}</span>
                  <button
                    type="button"
                    onClick={() => onChange(value.filter((v) => v !== tag))}
                    className="grid size-7 place-items-center rounded-full hover:bg-primary/15"
                    aria-label={`${t('forms.remove')} ${tag}`}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="relative">
            <input
              id={id}
              className={`${inputClass} pe-16`}
              value={draft}
              maxLength={maxLength}
              onChange={(e) => {
                setDraft(e.target.value);
                if (notice) setNotice('');
              }}
              onKeyDown={onKey}
              onBlur={() => add(draft)}
              aria-describedby={describedBy}
              list={`${id}-list`}
              dir="ltr"
            />
            <span
              aria-hidden
              className={`pointer-events-none absolute inset-y-0 end-3 grid place-items-center text-xs tabular-nums ${
                draft.length >= maxLength ? 'font-semibold text-danger' : 'text-muted'
              }`}
            >
              {draft.length}/{maxLength}
            </span>
          </div>
          <p role="status" className="mt-1 text-xs font-medium text-danger">
            {notice}
          </p>
          <datalist id={`${id}-list`}>
            {unused.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
          {unused.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {unused.slice(0, 12).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => add(s)}
                  className="min-h-8 rounded-full border border-dashed border-line-strong px-2.5 text-xs text-body hover:bg-muted-bg"
                >
                  + {s}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </Field>
  );
}

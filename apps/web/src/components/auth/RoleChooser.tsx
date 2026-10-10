'use client';

import type { SignupRole } from '@academy/shared';
import { useId } from 'react';
import { useI18n } from '@/i18n/client';

/** "I'm a student / I'm a speaker": a two-option segmented control (radio buttons underneath). */
export function RoleChooser({ value, onChange }: { value: SignupRole; onChange: (v: SignupRole) => void }) {
  const { t } = useI18n();
  const name = useId();
  const options: { value: SignupRole; label: string }[] = [
    { value: 'STUDENT', label: t('auth.speakerChoice.student') },
    { value: 'SPEAKER', label: t('auth.speakerChoice.speaker') },
  ];
  return (
    <fieldset className="mb-5">
      <legend className="sr-only">{t('auth.speakerChoice.legend')}</legend>
      <div className="grid grid-cols-2 gap-1 rounded-xl border border-line-strong bg-muted-bg p-1">
        {options.map((o) => (
          <label
            key={o.value}
            className={`flex min-h-11 cursor-pointer items-center justify-center rounded-lg px-3 text-center text-[0.9375rem] transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-cyan ${
              value === o.value ? 'bg-card font-semibold text-fg shadow-sm' : 'text-body hover:text-fg'
            }`}
          >
            <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} className="sr-only" />
            {o.label}
          </label>
        ))}
      </div>
      <p className="mt-2 text-xs text-muted">{value === 'SPEAKER' ? t('auth.speakerChoice.speakerHint') : t('auth.speakerChoice.studentHint')}</p>
    </fieldset>
  );
}

/** The choice from `?as=speaker` (links from the speakers page), student otherwise. */
export function initialSignupRole(param: string | null): SignupRole {
  return param?.toLowerCase() === 'speaker' ? 'SPEAKER' : 'STUDENT';
}

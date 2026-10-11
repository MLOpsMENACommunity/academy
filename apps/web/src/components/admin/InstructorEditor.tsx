'use client';

import { instructorInputSchema, type InstructorDto, type InstructorInput } from '@academy/shared';
import { useState, type FormEvent } from 'react';
import { CheckboxField, TextAreaField, TextField } from '@/components/forms/fields';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { useI18n } from '@/i18n/client';
import { api, ApiError } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { issuesToErrors } from '@/lib/zod-errors';

export const EMPTY_SPEAKER: InstructorInput = {
  slug: '',
  name: '',
  nameAr: '',
  titleEn: '',
  titleAr: '',
  bioEn: '',
  bioAr: '',
  photoUrl: '',
  linkedinUrl: '',
  githubUrl: '',
};

export function toSpeakerInput(i: InstructorDto): InstructorInput {
  return {
    slug: i.slug ?? '',
    name: i.name,
    nameAr: i.nameAr ?? '',
    titleEn: i.titleEn,
    titleAr: i.titleAr ?? '',
    bioEn: i.bioEn,
    bioAr: i.bioAr ?? '',
    photoUrl: i.photoUrl ?? '',
    linkedinUrl: i.linkedinUrl ?? '',
    githubUrl: i.githubUrl ?? '',
  };
}

/**
 * Create or edit one instructor/speaker (shared across courses and sessions): inline in the
 * course form, or on its own page under Admin → Speakers.
 */
export function InstructorForm({
  initial,
  id,
  onSaved,
  onCancel,
  standalone = false,
}: {
  initial: InstructorInput;
  id?: string;
  onSaved: (i: InstructorDto) => void;
  onCancel?: () => void;
  /** On its own page: roomier, and no "shared" note (the page says so). */
  standalone?: boolean;
}) {
  const { t } = useI18n();
  const [v, setV] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const c = (k: string) => t(`admin.courses.${k}`);
  const sp = (k: string) => t(`admin.speakers.fields.${k}`);
  const set = (k: keyof InstructorInput) => (x: string) => setV((p) => ({ ...p, [k]: x }));

  // Not a <form>: it sits inside the course form, and forms can't nest.
  async function save(e?: FormEvent) {
    e?.preventDefault();
    setError(null);
    const parsed = instructorInputSchema.safeParse(v);
    if (!parsed.success) {
      setErrors(issuesToErrors(parsed.error.issues, t));
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      onSaved(await api<InstructorDto>(id ? `/admin/instructors/${id}` : '/admin/instructors', { method: id ? 'PUT' : 'POST', json: parsed.data }));
    } catch (err) {
      if (err instanceof ApiError && err.code === 'SLUG_TAKEN') setErrors({ slug: err.message });
      setError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={standalone ? 'space-y-4' : 'space-y-3 rounded-lg border border-line bg-page p-3'}
      // Inside the course <form>: Enter in a text field saves the instructor, not the course.
      onKeyDown={(e) => {
        if (e.key === 'Enter' && e.target instanceof HTMLInputElement) {
          e.preventDefault();
          void save();
        }
      }}
    >
      {error && <Alert tone="danger">{error}</Alert>}
      {id && !standalone && <Alert tone="info">{c('instructorShared')}</Alert>}
      <div className={`grid sm:grid-cols-2 ${standalone ? 'gap-4' : 'gap-3'}`}>
        <TextField label={c('instructorName')} required value={v.name} onChange={set('name')} error={errors.name} />
        <TextField label={c('instructorNameAr')} dir="rtl" value={v.nameAr ?? ''} onChange={set('nameAr')} />
        <TextField label={c('instructorTitle')} hint={sp('titleHint')} value={v.titleEn} onChange={set('titleEn')} error={errors.titleEn} />
        <TextField label={c('instructorTitleAr')} dir="rtl" value={v.titleAr ?? ''} onChange={set('titleAr')} />
        <TextAreaField label={c('instructorBio')} hint={sp('bioHint')} value={v.bioEn} onChange={set('bioEn')} error={errors.bioEn} rows={6} />
        <TextAreaField label={c('instructorBioAr')} dir="rtl" value={v.bioAr ?? ''} onChange={set('bioAr')} rows={6} />
        <TextField label={c('instructorPhoto')} hint={sp('photoHint')} dir="ltr" value={v.photoUrl ?? ''} onChange={set('photoUrl')} error={errors.photoUrl} />
        <TextField
          label={sp('slug')}
          hint={
            // Changing a page's address: the old one keeps working (it redirects).
            id && initial.slug && v.slug && v.slug !== initial.slug
              ? t('admin.speakerEdit.slugChanged', { old: initial.slug, new: v.slug })
              : `${sp('slugHint')} /speakers/${v.slug || '…'}`
          }
          dir="ltr"
          value={v.slug ?? ''}
          onChange={set('slug')}
          error={errors.slug}
        />
        <TextField
          label="LinkedIn"
          required
          type="url"
          dir="ltr"
          placeholder="https://www.linkedin.com/in/…"
          hint={sp('linkedinHint')}
          value={v.linkedinUrl ?? ''}
          onChange={set('linkedinUrl')}
          error={errors.linkedinUrl}
        />
        <TextField label={sp('github')} type="url" dir="ltr" value={v.githubUrl ?? ''} onChange={set('githubUrl')} error={errors.githubUrl} />
      </div>
      <div className="flex gap-2">
        <Button type="button" size={standalone ? 'lg' : 'sm'} loading={busy} onClick={() => save()}>
          {t('admin.common.save')}
        </Button>
        {onCancel && (
          <Button type="button" size={standalone ? 'lg' : 'sm'} variant="secondary" onClick={onCancel}>
            {t('admin.common.cancel')}
          </Button>
        )}
      </div>
    </div>
  );
}

/** Pick the course's instructors, edit any of them, or add a new one. */
export function InstructorPicker({
  instructors,
  selected,
  onSelect,
  onChange,
}: {
  instructors: InstructorDto[];
  selected: string[];
  onSelect: (ids: string[]) => void;
  onChange: (list: InstructorDto[]) => void;
}) {
  const { t } = useI18n();
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  return (
    <div className="space-y-3">
      <ul className="space-y-2">
        {instructors.map((i) => (
          <li key={i.id}>
            {editing === i.id ? (
              <InstructorForm
                id={i.id}
                initial={toSpeakerInput(i)}
                onCancel={() => setEditing(null)}
                onSaved={(saved) => {
                  onChange(instructors.map((x) => (x.id === saved.id ? saved : x)));
                  setEditing(null);
                }}
              />
            ) : (
              <div className="flex items-start justify-between gap-3">
                <CheckboxField
                  label={[i.name, i.titleEn].filter(Boolean).join(' · ')}
                  checked={selected.includes(i.id)}
                  onChange={(on) => onSelect(on ? [...selected, i.id] : selected.filter((x) => x !== i.id))}
                />
                <button type="button" onClick={() => setEditing(i.id)} className="shrink-0 rounded border border-line px-2 py-1 text-xs">
                  {t('admin.common.edit')}
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {editing === 'new' ? (
        <InstructorForm
          initial={EMPTY_SPEAKER}
          onCancel={() => setEditing(null)}
          onSaved={(created) => {
            onChange([...instructors, created]);
            onSelect([...selected, created.id]);
            setEditing(null);
          }}
        />
      ) : (
        <Button type="button" size="sm" variant="secondary" onClick={() => setEditing('new')}>
          + {t('admin.courses.newInstructor')}
        </Button>
      )}
    </div>
  );
}

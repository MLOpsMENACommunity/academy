'use client';

import {
  AUDIENCE_LEVELS,
  audienceLevelLabels,
  COURSE_LANGUAGES,
  COURSE_STATUSES,
  courseInputSchema,
  courseLanguageLabels,
  courseLevelsText,
  courseStatusLabels,
  courseTypeLabels,
  DELIVERY_PLATFORMS,
  deliveryPlatformLabels,
  RECORDINGS_PLATFORMS,
  recordingsPlatformLabels,
  type CourseInput,
  type FaqItem,
  type InstructorDto,
  type Localized,
  type OutlineModule,
} from '@academy/shared';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { CheckboxField, ChipGroup, SelectField, TextAreaField, TextField } from '@/components/forms/fields';
import { InstructorPicker } from './InstructorEditor';
import { MarkdownField } from './MarkdownField';
import { TopicsField } from './TopicsField';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useI18n } from '@/i18n/client';
import { api, ApiError } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { ImageUploadField } from './ImageUploadField';
import { issuesToErrors } from '@/lib/zod-errors';

/** The old single `level` isn't edited: the API derives it from `levels`. */
export type CourseFormValue = Omit<CourseInput, 'startDate' | 'applicationsOpenAt' | 'applicationDeadline' | 'endDate' | 'level'> & {
  startDate: string;
  applicationsOpenAt: string;
  applicationDeadline: string;
  endDate: string;
};

/** ISO (UTC) ⇄ value of a <input type="datetime-local"> in the admin's own timezone. */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}
export function fromLocalInput(v: string): string | null {
  return v ? new Date(v).toISOString() : null;
}

export const EMPTY_COURSE: CourseFormValue = {
  slug: '',
  titleEn: '',
  titleAr: '',
  shortDescriptionEn: '',
  shortDescriptionAr: '',
  longDescriptionEn: '',
  longDescriptionAr: '',
  type: 'FREE',
  price: 0,
  currency: 'EGP',
  requiresApproval: true,
  capacity: null,
  status: 'DRAFT',
  levels: [],
  levelProgression: false,
  language: 'BILINGUAL',
  startDate: '',
  applicationsOpenAt: '',
  applicationDeadline: '',
  durationWeeks: null,
  hoursPerWeek: null,
  coverImageUrl: null,
  targetAudience: { en: '', ar: '' },
  notFor: { en: '', ar: '' },
  preparation: { en: '', ar: '' },
  learningOutcomes: { en: [], ar: [] },
  prerequisites: { en: [], ar: [] },
  outline: [],
  faq: [],
  included: { liveSessions: true, recordings: true, assignments: false, finalProject: false, certificate: false },
  deliveryPlatform: 'GOOGLE_MEET',
  recordingsPlatform: 'YOUTUBE',
  driveFolderUrl: null,
  youtubePlaylistUrl: null,
  instructorIds: [],
  topics: [],
  cohortNumber: null,
  endDate: '',
  externalPlatform: null,
  externalUrl: null,
  publicRecordings: false,
};

function Fieldset({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <fieldset>
        <legend className="text-lg font-semibold text-fg">{title}</legend>
        <div className="mt-4 space-y-4">{children}</div>
      </fieldset>
    </Card>
  );
}

/**
 * The course editor. `staffEndpoint` (Teaching → {course} → Details, for course staff with
 * EDIT_COURSE): saves there, and leaves out what stays with the admins (status, address, type
 * and price, the cover upload, who teaches it); the API keeps those as they are whatever is sent.
 */
export function CourseForm({ initial, courseId, onSaved, staffEndpoint }: { initial: CourseFormValue; courseId?: string; onSaved: (id: string) => void; staffEndpoint?: string }) {
  const staff = Boolean(staffEndpoint);
  const { locale, t } = useI18n();
  const [v, setV] = useState<CourseFormValue>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [instructors, setInstructors] = useState<InstructorDto[]>([]);
  const f = (k: string) => t(`admin.courses.fields.${k}`);
  const set = <K extends keyof CourseFormValue>(k: K) => (val: CourseFormValue[K]) => {
    setV((p) => ({ ...p, [k]: val }));
    setSaved(false);
  };
  const opts = (values: readonly string[], labels: Record<string, Localized>) => values.map((x) => ({ value: x, label: labels[x]?.[locale] ?? x }));
  const lines = (list: string[]) => list.join('\n');
  const toList = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean);

  useEffect(() => {
    if (staff) return;
    api<InstructorDto[]>('/admin/instructors').then(setInstructors).catch(() => undefined);
  }, [staff]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    const payload = {
      ...v,
      startDate: fromLocalInput(v.startDate),
      applicationsOpenAt: fromLocalInput(v.applicationsOpenAt),
      applicationDeadline: fromLocalInput(v.applicationDeadline),
      endDate: fromLocalInput(v.endDate),
    };
    const parsed = courseInputSchema.safeParse(payload);
    if (!parsed.success) {
      setErrors(issuesToErrors(parsed.error.issues, t));
      setFormError(t('forms.fixErrors'));
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const res = await api<{ id: string }>(staffEndpoint ?? (courseId ? `/admin/courses/${courseId}` : '/admin/courses'), {
        method: staffEndpoint || courseId ? 'PUT' : 'POST',
        json: payload,
      });
      setSaved(true);
      onSaved(res.id);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'SLUG_TAKEN') setErrors({ slug: err.message });
      setFormError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  const isPaidDrive = v.type === 'PAID' && v.recordingsPlatform === 'GOOGLE_DRIVE';

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      {formError && <Alert tone="danger">{formError}</Alert>}

      <Fieldset title={t('admin.courses.basics')}>
        {staff && <p className="-mt-2 text-sm text-muted">{t('teach.details.adminOnly')}</p>}
        <div className="grid gap-4 sm:grid-cols-2">
          {!staff && (
            <>
              <TextField label={f('slug')} required dir="ltr" value={v.slug} onChange={set('slug')} error={errors.slug} hint={`/courses/${v.slug || '…'}`} />
              <SelectField label={f('status')} required value={v.status} onChange={(x) => set('status')((x ?? 'DRAFT') as CourseFormValue['status'])} options={opts(COURSE_STATUSES, courseStatusLabels)} />
            </>
          )}
          <TextField label={f('titleEn')} required value={v.titleEn} onChange={set('titleEn')} error={errors.titleEn} />
          <TextField label={f('titleAr')} required dir="rtl" value={v.titleAr} onChange={set('titleAr')} error={errors.titleAr} />
          <TextAreaField label={f('shortEn')} required value={v.shortDescriptionEn} onChange={set('shortDescriptionEn')} error={errors.shortDescriptionEn} rows={2} maxLength={400} />
          <TextAreaField label={f('shortAr')} required value={v.shortDescriptionAr} onChange={set('shortDescriptionAr')} error={errors.shortDescriptionAr} rows={2} maxLength={400} />
          <MarkdownField label={f('longEn')} hint={f('markdownHint')} value={v.longDescriptionEn} onChange={set('longDescriptionEn')} rows={12} />
          <MarkdownField label={f('longAr')} hint={f('markdownHint')} dir="rtl" value={v.longDescriptionAr} onChange={set('longDescriptionAr')} rows={12} />
          {!staff && (
            <>
              <SelectField label={f('type')} required value={v.type} onChange={(x) => set('type')((x ?? 'FREE') as CourseFormValue['type'])} options={opts(['FREE', 'PAID'], courseTypeLabels)} />
              <div className="grid grid-cols-[1fr_6rem] gap-2">
                <TextField label={f('price')} required type="number" inputMode="numeric" min={0} value={String(v.price)} onChange={(x) => set('price')(Number(x || 0))} error={errors.price} />
                <TextField label={f('currency')} required value={v.currency} onChange={set('currency')} maxLength={3} dir="ltr" />
              </div>
            </>
          )}
          <SelectField label={f('language')} required value={v.language} onChange={(x) => set('language')((x ?? 'BILINGUAL') as CourseFormValue['language'])} options={opts(COURSE_LANGUAGES, courseLanguageLabels)} />
          {!staff && <ImageUploadField label={f('cover')} value={v.coverImageUrl} onChange={(x) => set('coverImageUrl')(x)} error={errors.coverImageUrl} />}
          <CheckboxField label={f('requiresApproval')} checked={v.requiresApproval} onChange={set('requiresApproval')} />
          <div className="space-y-3 sm:col-span-2">
            <ChipGroup
              legend={f('levels')}
              hint={f('levelsHint')}
              options={opts(AUDIENCE_LEVELS, audienceLevelLabels)}
              value={v.levels}
              onChange={(x) => set('levels')(AUDIENCE_LEVELS.filter((l) => x.includes(l)))}
              error={errors.levels}
            />
            <CheckboxField label={f('levelProgression')} hint={f('levelProgressionHint')} checked={v.levelProgression} onChange={set('levelProgression')} />
            <p className="text-sm text-muted">
              {f('levelsPreview')}: <span className="font-medium text-fg">{courseLevelsText(v, locale)}</span>
            </p>
          </div>
        </div>
      </Fieldset>

      <Fieldset title={t('admin.courses.schedule')}>
        <div className="grid gap-4 sm:grid-cols-3">
          <TextField label={f('startDate')} type="datetime-local" value={v.startDate} onChange={set('startDate')} />
          <TextField label={f('applicationsOpenAt')} type="datetime-local" value={v.applicationsOpenAt} onChange={set('applicationsOpenAt')} />
          <TextField label={f('deadline')} type="datetime-local" value={v.applicationDeadline} onChange={set('applicationDeadline')} />
          <TextField label={f('durationWeeks')} type="number" min={1} value={v.durationWeeks?.toString() ?? ''} onChange={(x) => set('durationWeeks')(x ? Number(x) : null)} />
          <TextField label={f('hoursPerWeek')} type="number" min={1} value={v.hoursPerWeek?.toString() ?? ''} onChange={(x) => set('hoursPerWeek')(x ? Number(x) : null)} />
          <TextField label={f('capacity')} type="number" min={1} value={v.capacity?.toString() ?? ''} onChange={(x) => set('capacity')(x ? Number(x) : null)} />
        </div>
      </Fieldset>

      <Fieldset title={t('admin.courses.pastCohort')}>
        <p className="-mt-2 text-sm text-muted">{t('admin.courses.pastCohortHint')}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label={f('cohortNumber')} type="number" inputMode="numeric" min={1} value={v.cohortNumber?.toString() ?? ''} onChange={(x) => set('cohortNumber')(x ? Number(x) : null)} error={errors.cohortNumber} />
          <TextField label={f('endDate')} type="datetime-local" value={v.endDate} onChange={set('endDate')} error={errors.endDate} />
          <TextField label={f('externalPlatform')} hint={f('externalPlatformHint')} dir="ltr" value={v.externalPlatform ?? ''} onChange={(x) => set('externalPlatform')(x || null)} error={errors.externalPlatform} />
          <TextField label={f('externalUrl')} type="url" dir="ltr" value={v.externalUrl ?? ''} onChange={(x) => set('externalUrl')(x || null)} error={errors.externalUrl} />
          <div className="sm:col-span-2">
            <TopicsField label={f('topics')} hint={f('topicsHint')} value={v.topics} onChange={set('topics')} error={errors.topics} />
          </div>
        </div>
        <CheckboxField label={f('publicRecordings')} checked={v.publicRecordings} onChange={set('publicRecordings')} />
      </Fieldset>

      <Fieldset title={t('admin.courses.delivery')}>
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField label={f('deliveryPlatform')} required value={v.deliveryPlatform} onChange={(x) => set('deliveryPlatform')((x ?? 'GOOGLE_MEET') as CourseFormValue['deliveryPlatform'])} options={opts(DELIVERY_PLATFORMS, deliveryPlatformLabels)} />
          <SelectField label={f('recordingsPlatform')} required value={v.recordingsPlatform} onChange={(x) => set('recordingsPlatform')((x ?? 'YOUTUBE') as CourseFormValue['recordingsPlatform'])} options={opts(RECORDINGS_PLATFORMS, recordingsPlatformLabels)} />
          <TextField label={f('playlist')} type="url" dir="ltr" value={v.youtubePlaylistUrl ?? ''} onChange={(x) => set('youtubePlaylistUrl')(x || null)} error={errors.youtubePlaylistUrl} />
          <div>
            <TextField label={f('driveFolder')} type="url" dir="ltr" value={v.driveFolderUrl ?? ''} onChange={(x) => set('driveFolderUrl')(x || null)} error={errors.driveFolderUrl} />
            {/* Risk 1: the rules sit right next to the field they apply to. */}
            <Alert tone="danger" className="mt-2">
              {t('admin.courses.driveWarning')}
            </Alert>
          </div>
        </div>
        {isPaidDrive && (
          <Alert tone="warning" title={t('admin.courses.checklist')}>
            <ul className="list-disc ps-5">
              <li>{t('admin.courses.driveWarning')}</li>
              <li>{t('admin.courses.driveChecklist')}</li>
            </ul>
          </Alert>
        )}
      </Fieldset>

      <Fieldset title={t('admin.courses.content')}>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextAreaField label={f('audienceEn')} value={v.targetAudience.en} onChange={(x) => set('targetAudience')({ ...v.targetAudience, en: x })} rows={3} />
          <TextAreaField label={f('audienceAr')} value={v.targetAudience.ar} onChange={(x) => set('targetAudience')({ ...v.targetAudience, ar: x })} rows={3} />
          <TextAreaField label={f('notForEn')} value={v.notFor.en} onChange={(x) => set('notFor')({ ...v.notFor, en: x })} rows={2} />
          <TextAreaField label={f('notForAr')} value={v.notFor.ar} onChange={(x) => set('notFor')({ ...v.notFor, ar: x })} rows={2} />
          <TextAreaField label={f('outcomesEn')} value={lines(v.learningOutcomes.en)} onChange={(x) => set('learningOutcomes')({ ...v.learningOutcomes, en: toList(x) })} rows={5} />
          <TextAreaField label={f('outcomesAr')} value={lines(v.learningOutcomes.ar)} onChange={(x) => set('learningOutcomes')({ ...v.learningOutcomes, ar: toList(x) })} rows={5} />
          <TextAreaField label={f('prereqEn')} value={lines(v.prerequisites.en)} onChange={(x) => set('prerequisites')({ ...v.prerequisites, en: toList(x) })} rows={3} />
          <TextAreaField label={f('prereqAr')} value={lines(v.prerequisites.ar)} onChange={(x) => set('prerequisites')({ ...v.prerequisites, ar: toList(x) })} rows={3} />
          <MarkdownField label={f('preparationEn')} hint={f('preparationHint')} value={v.preparation.en} onChange={(x) => set('preparation')({ ...v.preparation, en: x })} />
          <MarkdownField label={f('preparationAr')} hint={f('preparationHint')} dir="rtl" value={v.preparation.ar} onChange={(x) => set('preparation')({ ...v.preparation, ar: x })} />
        </div>

        <ListEditor<OutlineModule>
          title={f('outline')}
          items={v.outline}
          onChange={set('outline')}
          empty={{ titleEn: '', titleAr: '' }}
          addLabel={t('admin.courses.addModule')}
          render={(m, change) => (
            <div className="grid gap-2 sm:grid-cols-2">
              <TextField label={f('moduleTitleEn')} required value={m.titleEn} onChange={(x) => change({ ...m, titleEn: x })} />
              <TextField label={f('moduleTitleAr')} required value={m.titleAr} onChange={(x) => change({ ...m, titleAr: x })} />
              <TextField label={f('moduleDescEn')} value={m.descriptionEn ?? ''} onChange={(x) => change({ ...m, descriptionEn: x || undefined })} />
              <TextField label={f('moduleDescAr')} value={m.descriptionAr ?? ''} onChange={(x) => change({ ...m, descriptionAr: x || undefined })} />
            </div>
          )}
        />

        <ListEditor<FaqItem>
          title={f('faq')}
          items={v.faq}
          onChange={set('faq')}
          empty={{ questionEn: '', questionAr: '', answerEn: '', answerAr: '' }}
          addLabel={t('admin.courses.addFaq')}
          render={(q, change) => (
            <div className="grid gap-2 sm:grid-cols-2">
              <TextField label={f('qEn')} required value={q.questionEn} onChange={(x) => change({ ...q, questionEn: x })} />
              <TextField label={f('qAr')} required value={q.questionAr} onChange={(x) => change({ ...q, questionAr: x })} />
              <TextAreaField label={f('aEn')} required value={q.answerEn} onChange={(x) => change({ ...q, answerEn: x })} rows={2} />
              <TextAreaField label={f('aAr')} required value={q.answerAr} onChange={(x) => change({ ...q, answerAr: x })} rows={2} />
            </div>
          )}
        />

        <fieldset>
          <legend className="text-sm font-semibold text-fg">{f('included')}</legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            {(['liveSessions', 'recordings', 'assignments', 'finalProject', 'certificate'] as const).map((k) => (
              <CheckboxField key={k} label={t(`course.inc.${k}`, { platform: '' }).replace(/\s+on\s*$|\s+على\s*$/, '')} checked={v.included[k]} onChange={(x) => set('included')({ ...v.included, [k]: x })} />
            ))}
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <TextField label={f('includedNotesEn')} value={v.included.notesEn ?? ''} onChange={(x) => set('included')({ ...v.included, notesEn: x || undefined })} />
            <TextField label={f('includedNotesAr')} value={v.included.notesAr ?? ''} onChange={(x) => set('included')({ ...v.included, notesAr: x || undefined })} />
          </div>
        </fieldset>
      </Fieldset>

      {!staff && (
        <Fieldset title={t('admin.courses.instructors')}>
          {/* A shortcut to the course staff: the first is the Main instructor, the rest Co-instructors. */}
          <p className="-mt-2 text-sm text-muted">{t('admin.staff.instructorsFieldHint')}</p>
          <InstructorPicker instructors={instructors} selected={v.instructorIds} onSelect={set('instructorIds')} onChange={setInstructors} />
        </Fieldset>
      )}

      <div className="sticky bottom-0 z-10 flex items-center gap-3 border-t border-line bg-page/95 py-3 backdrop-blur">
        <Button type="submit" size="lg" loading={busy}>
          {t('admin.common.save')}
        </Button>
        <span role="status" className="text-sm text-success">
          {saved ? `✓ ${t('admin.common.saved')}` : ''}
        </span>
      </div>
    </form>
  );
}

/** Repeatable rows with add / move / remove. */
export function ListEditor<T>({
  title,
  items,
  onChange,
  empty,
  addLabel,
  render,
}: {
  title: string;
  items: T[];
  onChange: (items: T[]) => void;
  empty: T;
  addLabel: string;
  render: (item: T, change: (next: T) => void) => ReactNode;
}) {
  const { t } = useI18n();
  const move = (i: number, d: number) => {
    const next = [...items];
    const [x] = next.splice(i, 1);
    next.splice(i + d, 0, x!);
    onChange(next);
  };
  return (
    <fieldset>
      <legend className="text-sm font-semibold text-fg">{title}</legend>
      <ol className="mt-2 space-y-3">
        {items.map((item, i) => (
          <li key={i} className="rounded-lg border border-line p-3">
            {render(item, (next) => onChange(items.map((x, j) => (j === i ? next : x))))}
            <div className="mt-2 flex gap-2 text-xs">
              <button type="button" disabled={i === 0} onClick={() => move(i, -1)} className="rounded border border-line px-2 py-1 disabled:opacity-40">
                ↑ {t('admin.common.moveUp')}
              </button>
              <button type="button" disabled={i === items.length - 1} onClick={() => move(i, 1)} className="rounded border border-line px-2 py-1 disabled:opacity-40">
                ↓ {t('admin.common.moveDown')}
              </button>
              <button type="button" onClick={() => onChange(items.filter((_, j) => j !== i))} className="rounded border border-danger/40 px-2 py-1 text-danger">
                {t('admin.common.remove')}
              </button>
            </div>
          </li>
        ))}
      </ol>
      <button type="button" onClick={() => onChange([...items, structuredClone(empty)])} className="mt-2 min-h-9 rounded-lg border border-dashed border-line-strong px-3 text-sm">
        + {addLabel}
      </button>
    </fieldset>
  );
}

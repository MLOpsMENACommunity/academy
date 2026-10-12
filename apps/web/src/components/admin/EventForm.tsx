'use client';

import {
  COURSE_LANGUAGES,
  courseLanguageLabels,
  DELIVERY_PLATFORMS,
  deliveryPlatformLabels,
  EVENT_CATEGORIES,
  EVENT_SPEAKER_ROLES,
  EVENT_STATUSES,
  eventSpeakerRoleLabels,
  eventCategoryLabels,
  eventEnded,
  eventInputSchema,
  eventPublishMissing,
  eventStatusLabels,
  readEventDetails,
  type EventCategory,
  type EventInput,
  type EventPublishField,
  type EventSpeakerRole,
  type EventStatus,
  type InstructorDto,
  type CourseStatus,
  type Localized,
  type SpeakerKind,
} from '@academy/shared';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { focusFirstInvalid, SelectField, TextField } from '@/components/forms/fields';
import { DetailsFields, detailsToValues, KindField, valuesToDetails, type DetailsValues } from '@/components/speakers/DetailsFields';
import { Alert } from '@/components/ui/Alert';
import type { Tone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useI18n } from '@/i18n/client';
import { api, ApiError } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { viewerTimezone } from '@/lib/format';
import { issuesToErrors } from '@/lib/zod-errors';
import { fromLocalInput, toLocalInput } from './CourseForm';
import { MarkdownField } from './MarkdownField';
import { ImageUploadField } from './ImageUploadField';
import { TopicsField } from './TopicsField';

/** A live session as the admin API returns it. */
export interface AdminEvent extends Omit<EventInput, 'startsAt' | 'details'> {
  id: string;
  startsAt: string;
  updatedAt: string;
  /** "import" when the archive import created it. */
  source: string | null;
  /** { kind, details } (see readEventDetails); {} for a session the team made by hand. */
  details?: unknown;
  _count: { registrations: number };
  /** The speaker booking this session came from, if any (its kind, who booked it, and its course if it became one). */
  speakingSlot?: {
    id: string;
    kind: SpeakerKind | null;
    course?: { id: string; slug: string; status: CourseStatus } | null;
    bookedBy?: { email: string; speakerApplication: { fullName: string } | null } | null;
  } | null;
}

export type CoSpeakerValue = { instructorId: string; role: EventSpeakerRole };
export type EventFormValue = Omit<EventInput, 'startsAt' | 'coSpeakers'> & {
  startsAt: string;
  coSpeakers: CoSpeakerValue[];
};

export const EMPTY_EVENT: EventFormValue = {
  slug: '',
  status: 'DRAFT',
  titleEn: '',
  titleAr: '',
  descriptionEn: '',
  descriptionAr: '',
  speakerName: '',
  speakerNameAr: '',
  speakerTitleEn: '',
  speakerTitleAr: '',
  speakerPhotoUrl: null,
  speakerLinkedinUrl: null,
  speakerId: null,
  coSpeakers: [],
  topics: [],
  category: null,
  startsAt: '',
  durationMin: 60,
  language: 'BILINGUAL',
  platform: 'GOOGLE_MEET',
  liveUrl: null,
  recordingUrl: null,
  coverImageUrl: null,
  capacity: null,
};

export function toEventForm(e: AdminEvent): EventFormValue {
  return {
    slug: e.slug,
    status: e.status,
    titleEn: e.titleEn,
    titleAr: e.titleAr,
    descriptionEn: e.descriptionEn,
    descriptionAr: e.descriptionAr,
    speakerName: e.speakerName,
    speakerNameAr: e.speakerNameAr,
    speakerTitleEn: e.speakerTitleEn,
    speakerTitleAr: e.speakerTitleAr,
    speakerPhotoUrl: e.speakerPhotoUrl,
    speakerLinkedinUrl: e.speakerLinkedinUrl,
    speakerId: e.speakerId ?? null,
    coSpeakers: (e.coSpeakers ?? []).map((c) => ({ instructorId: c.instructorId, role: c.role })),
    topics: e.topics ?? [],
    category: e.category ?? null,
    startsAt: toLocalInput(e.startsAt),
    durationMin: e.durationMin,
    language: e.language,
    platform: e.platform,
    liveUrl: e.liveUrl,
    recordingUrl: e.recordingUrl,
    coverImageUrl: e.coverImageUrl,
    capacity: e.capacity,
  };
}

export const eventStatusTone: Record<EventStatus, Tone> = { DRAFT: 'warning', PUBLISHED: 'success', CANCELLED: 'neutral' };

function Fieldset({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <fieldset>
        <legend className="text-lg font-semibold text-fg">{title}</legend>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">{children}</div>
      </fieldset>
    </Card>
  );
}

export function EventForm({
  initial,
  eventId,
  onSaved,
  initialDetails,
}: {
  initial: EventFormValue;
  eventId?: string;
  /** After a save, with the status it was saved with (the page says what it means). */
  onSaved: (id: string, status: EventStatus) => void;
  /** The session's stored kind and details (from a speaker booking or an earlier save). */
  initialDetails?: unknown;
}) {
  const { locale, t } = useI18n();
  const [v, setV] = useState<EventFormValue>(initial);
  const [kindDetails] = useState(() => readEventDetails(initialDetails));
  const [kind, setKind] = useState(kindDetails.kind);
  const [details, setDetails] = useState<DetailsValues>(() => detailsToValues(kindDetails.details));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState<false | 'save' | 'publish'>(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [tz, setTz] = useState('');
  const [speakers, setSpeakers] = useState<InstructorDto[]>([]);
  useEffect(() => setTz(viewerTimezone()), []);
  useEffect(() => {
    api<InstructorDto[]>('/admin/instructors')
      .then(setSpeakers)
      .catch(() => undefined);
  }, []);

  const f = (k: string, vars?: Record<string, string>) => t(`admin.sessions.fields.${k}`, vars);
  const set =
    <K extends keyof EventFormValue>(k: K) =>
    (val: EventFormValue[K]) => {
      setV((p) => ({ ...p, [k]: val }));
      setSaved(false);
    };
  const url = (k: 'speakerPhotoUrl' | 'speakerLinkedinUrl' | 'liveUrl' | 'recordingUrl' | 'coverImageUrl') => (x: string) => set(k)(x || null);
  const opts = (values: readonly string[], labels: Record<string, Localized>) => values.map((x) => ({ value: x, label: labels[x]?.[locale] ?? x }));

  // A stored draft gets the banner: what it needs to go public, and a one-step Publish.
  const draft = Boolean(eventId) && initial.status === 'DRAFT';
  const missing = eventPublishMissing({ titleAr: v.titleAr, liveUrl: v.liveUrl, startsAt: fromLocalInput(v.startsAt) || null, durationMin: v.durationMin });
  const need = (field: EventPublishField) => t(`admin.sessions.publish.need.${field}`);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    await submit(v.status);
  }

  /** Saves the form and publishes it in one step: the same request and checks as Save with status Published. */
  async function publish() {
    setPublishError(null);
    if (missing.length) {
      // Say what is needed, mark those fields, and take the admin to the first one.
      setErrors((prev) => ({ ...prev, ...Object.fromEntries(missing.map((m) => [m, need(m)])) }));
      setPublishError(t('admin.sessions.publish.blocked', { list: missing.map(need).join(' · ') }));
      focusFirstInvalid(formRef.current);
      return;
    }
    await submit('PUBLISHED');
  }

  async function submit(status: EventStatus) {
    setFormError(null);
    // A row left without a person is dropped rather than blocking the save.
    const payload = {
      ...v,
      status,
      startsAt: fromLocalInput(v.startsAt),
      coSpeakers: v.coSpeakers.filter((c) => c.instructorId),
      details: { kind, details: valuesToDetails(details) },
    };
    const parsed = eventInputSchema.safeParse(payload);
    // z.coerce.date() would turn an empty date into 1970.
    const found = parsed.success ? {} : detailErrors(issuesToErrors(parsed.error.issues, t));
    if (!payload.startsAt) found.startsAt = t('forms.errors.required');
    if (Object.keys(found).length) {
      setErrors(found);
      setFormError(t('forms.fixErrors'));
      focusFirstInvalid(formRef.current);
      return;
    }
    setErrors({});
    setBusy(status === 'PUBLISHED' && v.status !== 'PUBLISHED' ? 'publish' : 'save');
    try {
      const res = await api<{ id: string; status: EventStatus }>(eventId ? `/admin/events/${eventId}` : '/admin/events', {
        method: eventId ? 'PUT' : 'POST',
        json: payload,
      });
      setV((p) => ({ ...p, status: res.status }));
      setSaved(true);
      onSaved(res.id, res.status);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'SLUG_TAKEN') setErrors({ slug: err.message });
      if (err instanceof ApiError && err.errors.length) setErrors(detailErrors(err.fieldErrors()));
      setFormError(errorMessage(err, t));
      focusFirstInvalid(formRef.current);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate className="space-y-5">
      {draft && (
        <section aria-labelledby="draft-banner" className="rounded-card border border-warning/30 bg-warning-soft p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1 basis-64">
              <h2 id="draft-banner" className="text-lg font-semibold text-fg">
                {t('admin.sessions.publish.title')}
              </h2>
              {missing.length > 0 ? (
                <>
                  <p className="mt-1 text-[0.9375rem] text-body">{t('admin.sessions.publish.toPublish')}</p>
                  <ul className="mt-1 list-disc ps-5 text-[0.9375rem] text-body">
                    {missing.map((m) => (
                      <li key={m}>{need(m)}</li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="mt-1 text-[0.9375rem] text-body">{t('admin.sessions.publish.ready')}</p>
              )}
            </div>
            <Button type="button" size="lg" onClick={publish} loading={busy === 'publish'} disabled={Boolean(busy)} aria-describedby="draft-banner">
              {t('admin.sessions.publish.button')}
            </Button>
          </div>
          {publishError && (
            <Alert tone="danger" className="mt-3">
              {publishError}
            </Alert>
          )}
        </section>
      )}
      {formError && <Alert tone="danger">{formError}</Alert>}

      <Fieldset title={t('admin.sessions.basics')}>
        <TextField label={f('slug')} required dir="ltr" value={v.slug} onChange={set('slug')} error={errors.slug} hint={`/sessions/${v.slug || '…'}`} />
        <SelectField
          label={f('status')}
          required
          value={v.status}
          onChange={(x) => set('status')((x ?? 'DRAFT') as EventStatus)}
          options={opts(EVENT_STATUSES, eventStatusLabels)}
          hint={eventId ? f('statusHint') : undefined}
        />
        <TextField label={f('titleEn')} required value={v.titleEn} onChange={set('titleEn')} error={errors.titleEn} maxLength={160} />
        <TextField label={f('titleAr')} hint={f('titleArHint')} dir="rtl" value={v.titleAr} onChange={set('titleAr')} error={errors.titleAr} maxLength={160} />
        <MarkdownField label={f('descriptionEn')} hint={t('admin.courses.fields.markdownHint')} value={v.descriptionEn} onChange={set('descriptionEn')} rows={10} />
        <MarkdownField label={f('descriptionAr')} hint={t('admin.courses.fields.markdownHint')} dir="rtl" value={v.descriptionAr} onChange={set('descriptionAr')} rows={10} />
        <div className="sm:col-span-2">
          <TopicsField label={f('topics')} hint={f('topicsHint')} value={v.topics} onChange={set('topics')} error={errors.topics} />
        </div>
        <SelectField
          label={f('category')}
          hint={f('categoryHint')}
          placeholder={f('categoryNone')}
          value={v.category ?? null}
          onChange={(x) => set('category')((x || null) as EventCategory | null)}
          options={opts(EVENT_CATEGORIES, eventCategoryLabels)}
        />
      </Fieldset>

      <Fieldset title={t('admin.sessions.schedule')}>
        <TextField
          label={f('startsAt')}
          required
          type="datetime-local"
          value={v.startsAt}
          onChange={set('startsAt')}
          error={errors.startsAt}
          hint={tz ? f('startsAtHint', { tz }) : undefined}
        />
        <TextField
          label={f('durationMin')}
          required
          type="number"
          inputMode="numeric"
          min={15}
          max={600}
          step={15}
          value={String(v.durationMin)}
          onChange={(x) => set('durationMin')(Number(x || 0))}
          error={errors.durationMin}
        />
        <SelectField
          label={f('language')}
          required
          value={v.language}
          onChange={(x) => set('language')((x ?? 'BILINGUAL') as EventFormValue['language'])}
          options={opts(COURSE_LANGUAGES, courseLanguageLabels)}
        />
        <SelectField
          label={f('platform')}
          required
          value={v.platform}
          onChange={(x) => set('platform')((x ?? 'GOOGLE_MEET') as EventFormValue['platform'])}
          options={opts(DELIVERY_PLATFORMS, deliveryPlatformLabels)}
        />
        <TextField
          label={f('liveUrl')}
          required={v.status === 'PUBLISHED' && !(v.startsAt && eventEnded(new Date(v.startsAt), v.durationMin))}
          type="url"
          dir="ltr"
          value={v.liveUrl ?? ''}
          onChange={url('liveUrl')}
          error={errors.liveUrl}
          hint={f('liveUrlHint')}
        />
        <TextField
          label={f('capacity')}
          type="number"
          inputMode="numeric"
          min={1}
          value={v.capacity?.toString() ?? ''}
          onChange={(x) => set('capacity')(x ? Number(x) : null)}
          error={errors.capacity}
          hint={f('capacityHint')}
        />
      </Fieldset>

      <Fieldset title={t('admin.sessions.speaker')}>
        <div className="sm:col-span-2">
          <SelectField
            label={f('speakerProfile')}
            hint={f('speakerProfileHint')}
            value={v.speakerId ?? ''}
            onChange={(x) => set('speakerId')(x || null)}
            placeholder={f('noSpeakerProfile')}
            options={speakers.map((s) => ({ value: s.id, label: `${(locale === 'ar' && s.nameAr) || s.name} · ${(locale === 'ar' && s.titleAr) || s.titleEn}` }))}
          />
        </div>
        <TextField
          label={f('speakerName')}
          value={v.speakerName}
          onChange={set('speakerName')}
          error={errors.speakerName}
          maxLength={120}
        />
        <TextField
          label={f('speakerNameAr')}
          dir="rtl"
          value={v.speakerNameAr}
          onChange={set('speakerNameAr')}
          error={errors.speakerNameAr}
          maxLength={120}
        />
        <TextField
          label={f('speakerTitleEn')}
          value={v.speakerTitleEn}
          onChange={set('speakerTitleEn')}
          error={errors.speakerTitleEn}
          maxLength={160}
        />
        <TextField
          label={f('speakerTitleAr')}
          dir="rtl"
          value={v.speakerTitleAr}
          onChange={set('speakerTitleAr')}
          error={errors.speakerTitleAr}
          maxLength={160}
        />
        <ImageUploadField label={f('speakerPhoto')} shape="round" value={v.speakerPhotoUrl} onChange={(x) => url('speakerPhotoUrl')(x ?? '')} error={errors.speakerPhotoUrl} />
        <TextField
          label={f('speakerLinkedin')}
          type="url"
          dir="ltr"
          value={v.speakerLinkedinUrl ?? ''}
          onChange={url('speakerLinkedinUrl')}
          error={errors.speakerLinkedinUrl}
        />
        <div className="sm:col-span-2">
          <p className="text-sm font-semibold text-fg">{f('coSpeakers')}</p>
          <p className="mt-1 text-xs text-muted">{f('coSpeakersHint')}</p>
          {errors.coSpeakers && <p className="mt-1 text-sm text-danger">{errors.coSpeakers}</p>}
          <ul className="mt-3 space-y-3">
            {v.coSpeakers.map((c, i) => {
              const update = (next: Partial<CoSpeakerValue>) =>
                set('coSpeakers')(v.coSpeakers.map((x, j) => (j === i ? { ...x, ...next } : x)));
              return (
                <li key={i} className="grid items-end gap-3 sm:grid-cols-[1fr_12rem_auto]">
                  <SelectField
                    label={f('coSpeakerPerson')}
                    required
                    value={c.instructorId}
                    onChange={(x) => update({ instructorId: x ?? '' })}
                    placeholder={f('noSpeakerProfile')}
                    options={speakers.map((s) => ({
                      value: s.id,
                      label: (locale === 'ar' && s.nameAr) || s.name,
                    }))}
                  />
                  <SelectField
                    label={f('coSpeakerRole')}
                    required
                    value={c.role}
                    onChange={(x) => update({ role: (x ?? 'GUEST') as EventSpeakerRole })}
                    options={opts(EVENT_SPEAKER_ROLES, eventSpeakerRoleLabels)}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => set('coSpeakers')(v.coSpeakers.filter((_, j) => j !== i))}
                  >
                    {f('removeCoSpeaker')}
                  </Button>
                </li>
              );
            })}
          </ul>
          {v.coSpeakers.length < 10 && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="mt-3"
              onClick={() =>
                set('coSpeakers')([...v.coSpeakers, { instructorId: '', role: 'GUEST' }])
              }
            >
              {f('addCoSpeaker')}
            </Button>
          )}
        </div>
      </Fieldset>

      <Card>
        <fieldset className="space-y-4">
          <legend className="text-lg font-semibold text-fg">{t('admin.sessions.kindDetails')}</legend>
          <p className="text-sm text-muted">{t('admin.sessions.kindDetailsHint')}</p>
          <KindField value={kind} onChange={(k) => { setKind(k); setSaved(false); }} />
          <DetailsFields kind={kind} value={details} onChange={(d) => { setDetails(d); setSaved(false); }} errors={errors} />
        </fieldset>
      </Card>

      <Fieldset title={t('admin.sessions.links')}>
        <TextField label={f('recordingUrl')} hint={f('recordingUrlHint')} type="url" dir="ltr" value={v.recordingUrl ?? ''} onChange={url('recordingUrl')} error={errors.recordingUrl} />
        <ImageUploadField label={f('coverImage')} value={v.coverImageUrl} onChange={(x) => url('coverImageUrl')(x ?? '')} error={errors.coverImageUrl} />
      </Fieldset>

      <div className="sticky bottom-0 z-10 flex items-center gap-3 border-t border-line bg-page/95 py-3 backdrop-blur">
        <Button type="submit" size="lg" variant={draft ? 'secondary' : 'primary'} loading={busy === 'save'} disabled={Boolean(busy)}>
          {draft && v.status === 'DRAFT' ? t('admin.sessions.publish.saveDraft') : t('admin.common.save')}
        </Button>
        <span role="status" className="text-sm text-success">
          {saved ? `✓ ${t('admin.common.saved')}` : ''}
        </span>
      </div>
    </form>
  );
}

/** Deletes a session (and its registrations) after a confirm. */
export function DeleteEvent({ event, onDone }: { event: Pick<AdminEvent, 'id' | 'titleEn' | 'titleAr' | '_count'>; onDone: () => void }) {
  const { locale, t } = useI18n();
  const [busy, setBusy] = useState(false);
  const title = (locale === 'ar' && event.titleAr) || event.titleEn;

  async function run() {
    if (!window.confirm(t('admin.sessions.deleteConfirm', { title, count: event._count.registrations }))) return;
    setBusy(true);
    try {
      await api(`/admin/events/${event.id}`, { method: 'DELETE' });
      onDone();
    } catch (err) {
      window.alert(err instanceof ApiError && err.code === 'EVENT_HAS_REGISTRATIONS' ? t('admin.sessions.hasRegistrations') : errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={run}
      disabled={busy}
      className="inline-flex min-h-11 items-center rounded-full border border-danger/40 px-4 text-[0.9375rem] font-medium text-danger hover:bg-danger-soft disabled:opacity-50"
    >
      {busy ? t('admin.common.loading') : t('admin.common.delete')}
    </button>
  );
}

/** The event schema nests the details one level deeper ("details.details.x"): the fields expect "details.x". */
function detailErrors(errors: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(errors).map(([k, v]) => [k.replace(/^details\.details\./, 'details.'), v]));
}

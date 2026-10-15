'use client';

import { sessionMaterialsSchema, type Material, type TeachingSessionDto } from '@academy/shared';
import { useState, type FormEvent } from 'react';
import { ListEditor } from '@/components/admin/CourseForm';
import { TextAreaField, TextField } from '@/components/forms/fields';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useI18n } from '@/i18n/client';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { formatDateTime, viewerTimezone } from '@/lib/format';
import { issuesToErrors } from '@/lib/zod-errors';

type Draft = Pick<TeachingSessionDto, 'descriptionEn' | 'descriptionAr' | 'recordingUrl' | 'assignmentUrl' | 'materials'>;

const draftOf = (s: TeachingSessionDto): Draft => ({
  descriptionEn: s.descriptionEn,
  descriptionAr: s.descriptionAr,
  recordingUrl: s.recordingUrl,
  assignmentUrl: s.assignmentUrl,
  materials: s.materials,
});

/** One session: its date (read-only) and the form for its text and links. */
function SessionMaterials({ courseId, session, onSaved }: { courseId: string; session: TeachingSessionDto; onSaved: (s: TeachingSessionDto) => void }) {
  const { locale, t } = useI18n();
  const m = (k: string, v?: Record<string, string | number>) => t(`speakerTeaching.materials.${k}`, v);
  const c = (k: string) => t(`admin.courses.${k}`);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(draftOf(session));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof Draft>(k: K) => (v: Draft[K]) => {
    setDraft((d) => ({ ...d, [k]: v }));
    setSaved(false);
  };
  const title = locale === 'ar' ? session.titleAr : session.titleEn;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = sessionMaterialsSchema.safeParse(draft);
    if (!parsed.success) {
      setErrors(issuesToErrors(parsed.error.issues, t));
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const next = await api<TeachingSessionDto>(`/teach/courses/${courseId}/sessions/${session.id}/materials`, { method: 'PUT', json: parsed.data });
      setDraft(draftOf(next));
      setSaved(true);
      onSaved(next);
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="!p-4 sm:!p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold break-words text-fg">
            {session.order}. {title}
          </p>
          <p className="mt-1 text-sm text-muted">{formatDateTime(session.startsAt, locale, viewerTimezone())}</p>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {session.materials.length > 0 && <Badge>{t('admin.courses.badgeMaterials', { count: session.materials.length })}</Badge>}
            {session.recordingUrl && <Badge tone="success">{m('hasRecording')}</Badge>}
          </div>
        </div>
        <Button size="sm" variant="secondary" aria-expanded={open} onClick={() => setOpen((o) => !o)} aria-label={`${open ? m('close') : m('edit')}: ${title}`}>
          {open ? m('close') : m('edit')}
        </Button>
      </div>
      {open && (
        <form onSubmit={submit} noValidate className="mt-4 space-y-3 border-t border-line pt-4">
          {error && <Alert tone="danger">{error}</Alert>}
          {saved && (
            <p role="status" className="text-sm font-medium text-success">
              {m('saved')}
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <TextAreaField label={c('topicsEn')} hint={c('topicsHint')} dir="ltr" rows={5} value={draft.descriptionEn ?? ''} onChange={(x) => set('descriptionEn')(x || null)} error={errors.descriptionEn} />
            <TextAreaField label={c('topicsAr')} hint={c('topicsHint')} dir="rtl" rows={5} value={draft.descriptionAr ?? ''} onChange={(x) => set('descriptionAr')(x || null)} error={errors.descriptionAr} />
            <TextField label={c('recordingUrl')} type="url" dir="ltr" value={draft.recordingUrl ?? ''} onChange={(x) => set('recordingUrl')(x || null)} error={errors.recordingUrl} />
            <TextField label={c('assignmentUrl')} type="url" dir="ltr" value={draft.assignmentUrl ?? ''} onChange={(x) => set('assignmentUrl')(x || null)} error={errors.assignmentUrl} />
          </div>
          <ListEditor<Material>
            title={c('materials')}
            items={draft.materials}
            onChange={set('materials')}
            empty={{ labelEn: '', labelAr: '', url: '' }}
            addLabel={c('addMaterial')}
            render={(mat, ch) => (
              <div className="grid gap-2 sm:grid-cols-3">
                <TextField label={c('materialLabelEn')} required value={mat.labelEn} onChange={(x) => ch({ ...mat, labelEn: x })} />
                <TextField label={c('materialLabelAr')} required dir="rtl" value={mat.labelAr} onChange={(x) => ch({ ...mat, labelAr: x })} />
                <TextField label="URL" required type="url" dir="ltr" value={mat.url} onChange={(x) => ch({ ...mat, url: x })} />
              </div>
            )}
          />
          {Object.keys(errors).some((k) => k.startsWith('materials')) && <p className="text-sm text-danger">{m('materialsInvalid')}</p>}
          <Button type="submit" loading={busy}>
            {m('save')}
          </Button>
        </form>
      )}
    </Card>
  );
}

/** My courses → {course} → Materials: each session's "what we cover" text, recording and links. */
export function TeachingMaterials({ courseId, sessions, onChange }: { courseId: string; sessions: TeachingSessionDto[]; onChange: (s: TeachingSessionDto) => void }) {
  const { t } = useI18n();
  return (
    <div className="space-y-3">
      <p className="max-w-3xl text-sm text-muted">{t('speakerTeaching.materials.intro')}</p>
      {sessions.length === 0 ? (
        <p className="rounded-card border border-dashed border-line-strong/50 p-6 text-center text-muted">{t('speakerTeaching.materials.none')}</p>
      ) : (
        <ul className="space-y-3">
          {sessions.map((s) => (
            <li key={s.id}>
              <SessionMaterials courseId={courseId} session={s} onSaved={onChange} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

'use client';

import { courseStatusLabels, type CourseStatus, type MediaLibraryDto } from '@academy/shared';
import { useCallback, useEffect, useState, type KeyboardEvent, type ReactNode } from 'react';
import { ImageUploadField } from '@/components/admin/ImageUploadField';
import { TextField } from '@/components/forms/fields';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { inputClass } from '@/components/ui/input';
import { PageSpinner } from '@/components/ui/Spinner';
import { useI18n } from '@/i18n/client';
import { api, ApiError } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { formatDate } from '@/lib/format';

const TABS = ['courses', 'events', 'speakers'] as const;
type Tab = (typeof TABS)[number];
type Values = Record<string, string | null>;

/**
 * One item's media fields with its own Save. Sends only what changed (PATCH: the rest is kept),
 * so nothing else about a course, session or speaker can be touched from here.
 */
function MediaForm({
  path,
  initial,
  fields,
}: {
  path: string;
  initial: Values;
  fields: (v: Values, set: (k: string) => (x: string | null) => void, errors: Record<string, string>) => ReactNode;
}) {
  const { t } = useI18n();
  const [base, setBase] = useState<Values>(initial);
  const [v, setV] = useState<Values>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<'idle' | 'busy' | 'saved'>('idle');
  const changed = Object.fromEntries(Object.entries(v).filter(([k, x]) => (x ?? null) !== (base[k] ?? null)));
  const set = (k: string) => (x: string | null) => {
    setV((p) => ({ ...p, [k]: x }));
    setState('idle');
  };

  async function save() {
    setError(null);
    setErrors({});
    setState('busy');
    try {
      const saved = await api<Values>(path, { method: 'PATCH', json: Object.fromEntries(Object.entries(changed).map(([k, x]) => [k, x ?? ''])) });
      const next = Object.fromEntries(Object.keys(base).map((k) => [k, saved[k] ?? null]));
      setBase(next);
      setV(next);
      setState('saved');
    } catch (err) {
      if (err instanceof ApiError && err.errors.length) setErrors(Object.fromEntries(err.errors.map((x) => [x.path, x.message])));
      setError(errorMessage(err, t));
      setState('idle');
    }
  }

  return (
    <div className="space-y-3">
      {error && <Alert tone="danger">{error}</Alert>}
      {fields(v, set, errors)}
      <div className="flex items-center gap-3">
        <Button size="sm" onClick={save} loading={state === 'busy'} disabled={!Object.keys(changed).length}>
          {t('admin.media.save')}
        </Button>
        <span role="status" className="text-sm text-success">
          {state === 'saved' ? `✓ ${t('admin.media.saved')}` : ''}
        </span>
      </div>
    </div>
  );
}

export default function AdminMedia() {
  const { locale, t } = useI18n();
  const [data, setData] = useState<MediaLibraryDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('courses');
  const [q, setQ] = useState('');
  const m = (k: string, v?: Record<string, string | number>) => t(`admin.media.${k}`, v);

  const load = useCallback(() => {
    api<MediaLibraryDto>('/admin/media/library')
      .then(setData)
      .catch((err: unknown) => setError(errorMessage(err, t)));
  }, [t]);
  useEffect(load, [load]);

  if (!data) return error ? <Alert tone="danger">{error}</Alert> : <PageSpinner />;

  const match = (...texts: (string | null | undefined)[]) => !q.trim() || texts.some((x) => x?.toLowerCase().includes(q.trim().toLowerCase()));
  const title = (x: { titleEn: string; titleAr: string }) => (locale === 'ar' && x.titleAr) || x.titleEn;
  const courses = data.courses.filter((c) => match(c.titleEn, c.titleAr, c.slug));
  const events = data.events.filter((e) => match(e.titleEn, e.titleAr, e.slug, e.speakerName));
  const speakers = data.speakers.filter((s) => match(s.name, s.nameAr, s.slug));
  const counts: Record<Tab, number> = { courses: courses.length, events: events.length, speakers: speakers.length };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const d = (e.key === 'ArrowRight') !== (locale === 'ar') ? 1 : -1;
    const next = TABS[(TABS.indexOf(tab) + d + TABS.length) % TABS.length]!;
    setTab(next);
    document.getElementById(`media-tab-${next}`)?.focus();
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-3xl">{m('title')}</h1>
        <p className="mt-1 max-w-2xl text-muted">{m('intro')}</p>
      </div>
      <input type="search" className={`${inputClass} max-w-md`} placeholder={m('search')} aria-label={m('search')} value={q} onChange={(e) => setQ(e.target.value)} />
      <div role="tablist" aria-label={m('title')} className="flex gap-1 overflow-x-auto border-b border-line" onKeyDown={onKey}>
        {TABS.map((k) => (
          <button
            key={k}
            id={`media-tab-${k}`}
            role="tab"
            type="button"
            aria-selected={tab === k}
            aria-controls="media-panel"
            tabIndex={tab === k ? 0 : -1}
            onClick={() => setTab(k)}
            className={`min-h-11 border-b-2 px-3 text-sm font-semibold whitespace-nowrap ${tab === k ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-fg'}`}
          >
            {m(`tabs.${k}`)} ({counts[k]})
          </button>
        ))}
      </div>

      <div role="tabpanel" id="media-panel" aria-labelledby={`media-tab-${tab}`}>
        {counts[tab] === 0 && <p className="text-muted">{m('empty')}</p>}
        <ul className="space-y-3">
          {tab === 'courses' &&
            courses.map((c) => (
              <li key={c.id}>
                <Card>
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <h2 className="text-lg break-words">{title(c)}</h2>
                    <Badge>{courseStatusLabels[c.status as CourseStatus]?.[locale] ?? c.status}</Badge>
                  </div>
                  <MediaForm
                    path={`/admin/media/courses/${c.id}`}
                    initial={{ coverImageUrl: c.coverImageUrl, youtubePlaylistUrl: c.youtubePlaylistUrl }}
                    fields={(v, set, errors) => (
                      <div className="grid gap-3 lg:grid-cols-2">
                        <ImageUploadField label={m('cover')} value={v.coverImageUrl} onChange={set('coverImageUrl')} error={errors.coverImageUrl} />
                        <TextField label={m('playlist')} type="url" dir="ltr" value={v.youtubePlaylistUrl} onChange={(x) => set('youtubePlaylistUrl')(x || null)} error={errors.youtubePlaylistUrl} />
                      </div>
                    )}
                  />
                  {c.sessions.length > 0 && (
                    <details className="mt-4 rounded-xl border border-line">
                      <summary className="min-h-11 cursor-pointer px-3 py-2.5 text-sm font-semibold">{m('sessionRecordings', { count: c.sessions.length })}</summary>
                      <ol className="space-y-4 border-t border-line p-3">
                        {c.sessions.map((s) => (
                          <li key={s.id}>
                            <p className="mb-2 text-sm font-semibold break-words text-fg">
                              {s.order}. {title(s)} <span className="font-normal text-muted">· {formatDate(s.startsAt, locale)}</span>
                            </p>
                            <MediaForm
                              path={`/admin/media/courses/${c.id}/sessions/${s.id}`}
                              initial={{ recordingUrl: s.recordingUrl }}
                              fields={(v, set, errors) => (
                                <TextField label={m('recording')} type="url" dir="ltr" value={v.recordingUrl} onChange={(x) => set('recordingUrl')(x || null)} error={errors.recordingUrl} />
                              )}
                            />
                          </li>
                        ))}
                      </ol>
                    </details>
                  )}
                </Card>
              </li>
            ))}
          {tab === 'events' &&
            events.map((e) => (
              <li key={e.id}>
                <Card>
                  <div className="mb-3">
                    <h2 className="text-lg break-words">{title(e)}</h2>
                    <p className="text-sm text-muted">
                      {formatDate(e.startsAt, locale)}
                      {e.speakerName ? ` · ${e.speakerName}` : ''}
                    </p>
                  </div>
                  <MediaForm
                    path={`/admin/media/events/${e.id}`}
                    initial={{ coverImageUrl: e.coverImageUrl, speakerPhotoUrl: e.speakerPhotoUrl, recordingUrl: e.recordingUrl }}
                    fields={(v, set, errors) => (
                      <div className="grid gap-3 lg:grid-cols-2">
                        <ImageUploadField label={m('cover')} value={v.coverImageUrl} onChange={set('coverImageUrl')} error={errors.coverImageUrl} />
                        <ImageUploadField label={m('speakerPhoto')} shape="round" value={v.speakerPhotoUrl} onChange={set('speakerPhotoUrl')} error={errors.speakerPhotoUrl} />
                        <TextField label={m('recording')} type="url" dir="ltr" value={v.recordingUrl} onChange={(x) => set('recordingUrl')(x || null)} error={errors.recordingUrl} />
                      </div>
                    )}
                  />
                </Card>
              </li>
            ))}
          {tab === 'speakers' &&
            speakers.map((s) => (
              <li key={s.id}>
                <Card>
                  <h2 className="mb-3 text-lg break-words">{(locale === 'ar' && s.nameAr) || s.name}</h2>
                  <MediaForm
                    path={`/admin/media/instructors/${s.id}`}
                    initial={{ photoUrl: s.photoUrl }}
                    fields={(v, set, errors) => <ImageUploadField label={m('photo')} shape="round" value={v.photoUrl} onChange={set('photoUrl')} error={errors.photoUrl} />}
                  />
                </Card>
              </li>
            ))}
        </ul>
      </div>
    </div>
  );
}

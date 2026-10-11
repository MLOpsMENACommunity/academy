'use client';

import {
  COURSE_LANGUAGES,
  courseLanguageLabels,
  DETAIL_LEVELS,
  DETAIL_LIMITS,
  detailLevelLabels,
  EPISODE_FORMATS,
  episodeFormatLabels,
  SPEAKER_KINDS,
  speakerKindLabels,
  type SpeakerDetailsDto,
  type SpeakerKind,
} from '@academy/shared';
import { RadioGroup, SelectField, TagInput, TextAreaField, TextField } from '@/components/forms/fields';
import { Button } from '@/components/ui/Button';
import { useI18n } from '@/i18n/client';

/** Form state of the optional details: strings everywhere (the shared schema converts). */
export interface DetailsValues {
  audience: string;
  prerequisites: string;
  /** One per line in the form. */
  outcomes: string;
  level: string;
  language: string;
  tags: string[];
  course: { modulesCount: string; modules: { title: string; description: string }[]; weeklyHours: string; durationWeeks: string; materialsUrl: string };
  podcast: { guests: { name: string; linkedinUrl: string }[]; discussion: string; episodeFormat: string; host: string };
}

export function detailsToValues(d: SpeakerDetailsDto | null | undefined): DetailsValues {
  const num = (n: number | undefined) => (n === undefined ? '' : String(n));
  return {
    audience: d?.audience ?? '',
    prerequisites: d?.prerequisites ?? '',
    outcomes: (d?.outcomes ?? []).join('\n'),
    level: d?.level ?? '',
    language: d?.language ?? '',
    tags: d?.tags ?? [],
    course: {
      modulesCount: num(d?.course?.modulesCount),
      modules: d?.course?.modules ?? [],
      weeklyHours: num(d?.course?.weeklyHours),
      durationWeeks: num(d?.course?.durationWeeks),
      materialsUrl: d?.course?.materialsUrl ?? '',
    },
    podcast: {
      guests: (d?.podcast?.guests ?? []).map((g) => ({ name: g.name, linkedinUrl: g.linkedinUrl ?? '' })),
      discussion: (d?.podcast?.discussion ?? []).join('\n'),
      episodeFormat: d?.podcast?.episodeFormat ?? '',
      host: d?.podcast?.host ?? '',
    },
  };
}

const lines = (v: string) => v.split('\n').map((x) => x.trim()).filter(Boolean);

/** What the API (and the shared schema) takes. */
export function valuesToDetails(v: DetailsValues): Record<string, unknown> {
  return {
    ...v,
    outcomes: lines(v.outcomes),
    podcast: { ...v.podcast, discussion: lines(v.podcast.discussion) },
  };
}

/** The kind choice: Session / Course / Podcast. */
export function KindField({ value, onChange, error }: { value: SpeakerKind; onChange: (k: SpeakerKind) => void; error?: string }) {
  const { locale, t } = useI18n();
  return (
    <RadioGroup
      legend={t('speakers.details.kind')}
      hint={t('speakers.details.kindHint')}
      required
      value={value}
      onChange={(k) => onChange(k as SpeakerKind)}
      error={error}
      options={SPEAKER_KINDS.map((k) => ({ value: k, label: speakerKindLabels[k][locale] }))}
    />
  );
}

/**
 * The optional details of a session, course or podcast. Every field is optional: whatever is
 * left empty, the team fills in or leaves out (empty sections never show on the public page).
 * `errors` is keyed by path from the form (e.g. "details.course.materialsUrl").
 */
export function DetailsFields({
  kind,
  value: v,
  onChange,
  errors,
  open = false,
}: {
  kind: SpeakerKind;
  value: DetailsValues;
  onChange: (v: DetailsValues) => void;
  errors: Record<string, string>;
  /** Start expanded (e.g. when something is filled or invalid). */
  open?: boolean;
}) {
  const { locale, t } = useI18n();
  const d = (k: string, vars?: Record<string, string | number>) => t(`speakers.details.${k}`, vars);
  const err = (path: string) => errors[`details.${path}`];
  const set = <K extends keyof DetailsValues>(k: K) => (x: DetailsValues[K]) => onChange({ ...v, [k]: x });
  const setCourse = <K extends keyof DetailsValues['course']>(k: K) => (x: DetailsValues['course'][K]) => onChange({ ...v, course: { ...v.course, [k]: x } });
  const setPodcast = <K extends keyof DetailsValues['podcast']>(k: K) => (x: DetailsValues['podcast'][K]) => onChange({ ...v, podcast: { ...v.podcast, [k]: x } });
  const anyError = Object.keys(errors).some((k) => k.startsWith('details.'));

  return (
    <details open={open || anyError || undefined} className="group rounded-xl border border-line p-4">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 font-semibold text-fg">
        <span>{d('title', { kind: speakerKindLabels[kind][locale] })}</span>
        <span aria-hidden className="text-muted transition-transform group-open:rotate-180">
          ▾
        </span>
      </summary>
      <div className="mt-4 space-y-4">
        <p className="text-sm text-muted">{d('intro')}</p>
        <TextAreaField label={d('audience')} rows={2} maxLength={500} value={v.audience} onChange={set('audience')} error={err('audience')} />
        <TextAreaField label={d('prerequisites')} rows={2} maxLength={1000} value={v.prerequisites} onChange={set('prerequisites')} error={err('prerequisites')} />
        <TextAreaField
          label={d('outcomes')}
          hint={d('onePerLine', { max: DETAIL_LIMITS.outcomes })}
          rows={3}
          value={v.outcomes}
          onChange={set('outcomes')}
          error={err('outcomes') ?? Object.entries(errors).find(([k]) => k.startsWith('details.outcomes.'))?.[1]}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            label={d('level')}
            value={v.level}
            onChange={(x) => set('level')(x ?? '')}
            error={err('level')}
            options={DETAIL_LEVELS.map((l) => ({ value: l, label: detailLevelLabels[l][locale] }))}
          />
          <SelectField
            label={d('language')}
            value={v.language}
            onChange={(x) => set('language')(x ?? '')}
            error={err('language')}
            options={COURSE_LANGUAGES.map((l) => ({ value: l, label: courseLanguageLabels[l][locale] }))}
          />
        </div>
        <TagInput label={d('tags')} hint={d('tagsHint', { max: DETAIL_LIMITS.tags })} value={v.tags} onChange={set('tags')} max={DETAIL_LIMITS.tags} maxLength={40} />

        {kind === 'COURSE' && (
          <fieldset className="space-y-4 border-t border-line pt-4">
            <legend className="pt-4 text-base font-semibold text-fg">{d('course.title')}</legend>
            <div className="grid gap-4 sm:grid-cols-3">
              <TextField label={d('course.modulesCount')} inputMode="numeric" dir="ltr" value={v.course.modulesCount} onChange={setCourse('modulesCount')} error={err('course.modulesCount')} />
              <TextField label={d('course.weeklyHours')} inputMode="decimal" dir="ltr" value={v.course.weeklyHours} onChange={setCourse('weeklyHours')} error={err('course.weeklyHours')} />
              <TextField label={d('course.durationWeeks')} inputMode="numeric" dir="ltr" value={v.course.durationWeeks} onChange={setCourse('durationWeeks')} error={err('course.durationWeeks')} />
            </div>
            <div className="space-y-3">
              <p className="text-sm font-semibold text-fg">{d('course.modules')}</p>
              {v.course.modules.map((m, i) => (
                <div key={i} className="space-y-2 rounded-lg bg-muted-bg p-3">
                  <TextField
                    label={d('course.moduleTitle', { n: i + 1 })}
                    maxLength={120}
                    value={m.title}
                    onChange={(x) => setCourse('modules')(v.course.modules.map((o, j) => (j === i ? { ...o, title: x } : o)))}
                    error={err(`course.modules.${i}.title`)}
                  />
                  <TextAreaField
                    label={d('course.moduleDescription')}
                    rows={2}
                    maxLength={500}
                    value={m.description}
                    onChange={(x) => setCourse('modules')(v.course.modules.map((o, j) => (j === i ? { ...o, description: x } : o)))}
                    error={err(`course.modules.${i}.description`)}
                  />
                  <Button type="button" variant="ghost" size="sm" onClick={() => setCourse('modules')(v.course.modules.filter((_, j) => j !== i))}>
                    {d('remove')}
                  </Button>
                </div>
              ))}
              {v.course.modules.length < DETAIL_LIMITS.modules && (
                <Button type="button" variant="secondary" size="sm" onClick={() => setCourse('modules')([...v.course.modules, { title: '', description: '' }])}>
                  + {d('course.addModule')}
                </Button>
              )}
            </div>
            <TextField label={d('course.materialsUrl')} type="url" dir="ltr" placeholder="https://…" value={v.course.materialsUrl} onChange={setCourse('materialsUrl')} error={err('course.materialsUrl')} />
          </fieldset>
        )}

        {kind === 'PODCAST' && (
          <fieldset className="space-y-4 border-t border-line pt-4">
            <legend className="pt-4 text-base font-semibold text-fg">{d('podcast.title')}</legend>
            <div className="space-y-3">
              <p className="text-sm font-semibold text-fg">{d('podcast.guests')}</p>
              {v.podcast.guests.map((g, i) => (
                <div key={i} className="grid gap-2 rounded-lg bg-muted-bg p-3 sm:grid-cols-2">
                  <TextField
                    label={d('podcast.guestName', { n: i + 1 })}
                    maxLength={120}
                    value={g.name}
                    onChange={(x) => setPodcast('guests')(v.podcast.guests.map((o, j) => (j === i ? { ...o, name: x } : o)))}
                    error={err(`podcast.guests.${i}.name`)}
                  />
                  <TextField
                    label={d('podcast.guestLinkedin')}
                    type="url"
                    dir="ltr"
                    placeholder="https://www.linkedin.com/in/…"
                    value={g.linkedinUrl}
                    onChange={(x) => setPodcast('guests')(v.podcast.guests.map((o, j) => (j === i ? { ...o, linkedinUrl: x } : o)))}
                    error={err(`podcast.guests.${i}.linkedinUrl`)}
                  />
                  <div className="sm:col-span-2">
                    <Button type="button" variant="ghost" size="sm" onClick={() => setPodcast('guests')(v.podcast.guests.filter((_, j) => j !== i))}>
                      {d('remove')}
                    </Button>
                  </div>
                </div>
              ))}
              {v.podcast.guests.length < DETAIL_LIMITS.guests && (
                <Button type="button" variant="secondary" size="sm" onClick={() => setPodcast('guests')([...v.podcast.guests, { name: '', linkedinUrl: '' }])}>
                  + {d('podcast.addGuest')}
                </Button>
              )}
            </div>
            <TextAreaField
              label={d('podcast.discussion')}
              hint={d('onePerLine', { max: DETAIL_LIMITS.discussion })}
              rows={3}
              value={v.podcast.discussion}
              onChange={setPodcast('discussion')}
              error={err('podcast.discussion') ?? Object.entries(errors).find(([k]) => k.startsWith('details.podcast.discussion.'))?.[1]}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <RadioGroup
                legend={d('podcast.episodeFormat')}
                value={v.podcast.episodeFormat}
                onChange={setPodcast('episodeFormat')}
                error={err('podcast.episodeFormat')}
                options={EPISODE_FORMATS.map((f) => ({ value: f, label: episodeFormatLabels[f][locale] }))}
              />
              <TextField label={d('podcast.host')} maxLength={120} value={v.podcast.host} onChange={setPodcast('host')} error={err('podcast.host')} />
            </div>
          </fieldset>
        )}
      </div>
    </details>
  );
}

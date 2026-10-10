'use client';

import {
  ASSESSMENT_STATUSES,
  ASSESSMENT_TYPES,
  assessmentInputSchema,
  QUIZ_QUESTION_KINDS,
  REVEAL_POLICIES,
  SCORING_POLICIES,
  SUBMISSION_KINDS,
  type AdminAssessmentDto,
  type AdminAssessmentRow,
  type AssessmentStatus,
  type AssessmentType,
  type QuizQuestionInput,
  type QuizQuestionKind,
  type RevealPolicy,
  type ScoringPolicy,
  type SubmissionKind,
} from '@academy/shared';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { ZodIssue } from 'zod';
import { CheckboxField, focusFirstInvalid, SelectField, TextAreaField, TextField } from '@/components/forms/fields';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useI18n } from '@/i18n/client';
import type { Translate } from '@/i18n/translator';
import { api } from '@/lib/api';
import { downloadViaApi } from '@/lib/download';
import { errorMessage } from '@/lib/errors';
import { formatDateTime } from '@/lib/format';
import { issuesToErrors } from '@/lib/zod-errors';
import { AssessmentGradebook } from './AssessmentGradebook';
import { fromLocalInput, toLocalInput } from './CourseForm';
import { MarkdownField } from './MarkdownField';

export interface AssessmentSessionOption {
  id: string;
  order: number;
  titleEn: string;
  titleAr: string;
}

type Option = QuizQuestionInput['options'][number];
type Question = Omit<QuizQuestionInput, 'explanationEn' | 'explanationAr'> & { explanationEn: string | null; explanationAr: string | null };

interface Draft {
  type: AssessmentType;
  status: AssessmentStatus;
  sessionId: string | null;
  order: number;
  titleEn: string;
  titleAr: string;
  instructionsEn: string;
  instructionsAr: string;
  dueAt: string;
  allowLate: boolean;
  maxPoints: number;
  passPercent: number;
  countsForCertificate: boolean;
  submissionKind: SubmissionKind | null;
  attemptsAllowed: number;
  scoring: ScoringPolicy;
  revealAnswers: RevealPolicy;
  timeLimitMin: number | null;
  shuffle: boolean;
  questions: Question[];
}

const emptyOption = (): Option => ({ labelEn: '', labelAr: '', correct: false });
const emptyQuestion = (): Question => ({
  kind: 'SINGLE',
  promptEn: '',
  promptAr: '',
  weight: 1,
  explanationEn: null,
  explanationAr: null,
  options: [{ ...emptyOption(), correct: true }, emptyOption()],
});

const EMPTY: Draft = {
  type: 'QUIZ',
  status: 'DRAFT',
  sessionId: null,
  order: 0,
  titleEn: '',
  titleAr: '',
  instructionsEn: '',
  instructionsAr: '',
  dueAt: '',
  allowLate: true,
  maxPoints: 100,
  passPercent: 70,
  countsForCertificate: false,
  submissionKind: null,
  attemptsAllowed: 1,
  scoring: 'BEST',
  revealAnswers: 'AFTER_SUBMIT',
  timeLimitMin: null,
  shuffle: false,
  questions: [],
};

function toDraft(a: AdminAssessmentDto): Draft {
  return {
    type: a.type,
    status: a.status,
    sessionId: a.sessionId,
    order: a.order,
    titleEn: a.titleEn,
    titleAr: a.titleAr,
    instructionsEn: a.instructionsEn,
    instructionsAr: a.instructionsAr,
    dueAt: toLocalInput(a.dueAt),
    allowLate: a.allowLate,
    maxPoints: a.maxPoints,
    passPercent: a.passPercent,
    countsForCertificate: a.countsForCertificate,
    submissionKind: a.submissionKind,
    attemptsAllowed: a.attemptsAllowed,
    scoring: a.scoring,
    revealAnswers: a.revealAnswers,
    timeLimitMin: a.timeLimitMin,
    shuffle: a.shuffle,
    questions: a.questions,
  };
}

/** Field errors in the admin's language; the schema's own rules get specific messages. */
function draftErrors(issues: ZodIssue[], t: Translate): Record<string, string> {
  const out = issuesToErrors(issues, t);
  const e = (k: string) => t(`admin.assessments.form.errors.${k}`);
  for (const i of issues) {
    const key = i.path.join('.');
    if (i.code !== 'custom') continue;
    if (i.message.startsWith('Add at least one question')) out[key] = e('questions');
    else if (i.message.startsWith('Set a due date')) out[key] = e('dueForReveal');
    else if (i.message.startsWith('Choose how students submit')) out[key] = e('submissionKind');
    else if (i.message.startsWith('Mark exactly one')) out[key] = e('oneCorrect');
    else if (i.message.startsWith('Mark at least one')) out[key] = e('someCorrect');
    else if (i.message.startsWith('A true/false')) out[key] = e('twoOptions');
    else if (i.message.startsWith('Late work cannot')) out[key] = e('lateWithReveal');
    else if (i.message.startsWith('A practice quiz')) out[key] = e('practiceCertificate');
  }
  return out;
}

// ------------------------------------------------------------------ quiz builder

function QuestionEditor({
  q,
  n,
  count,
  errors,
  onChange,
  onMove,
  onRemove,
}: {
  q: Question;
  n: number;
  count: number;
  errors: Record<string, string>;
  onChange: (q: Question) => void;
  onMove: (d: number) => void;
  onRemove: () => void;
}) {
  const { t } = useI18n();
  const b = (k: string, v?: Record<string, string | number>) => t(`admin.assessments.builder.${k}`, v);
  const prefix = `questions.${n - 1}`;
  const err = (k: string) => errors[`${prefix}.${k}`];
  const multi = q.kind === 'MULTIPLE';
  const setKind = (kind: QuizQuestionKind) => {
    if (kind === 'TRUE_FALSE') {
      onChange({ ...q, kind, options: [{ labelEn: b('true'), labelAr: 'صح', correct: true }, { labelEn: b('false'), labelAr: 'خطأ', correct: false }] });
    } else if (kind === 'SINGLE' && q.options.filter((o) => o.correct).length !== 1) {
      onChange({ ...q, kind, options: q.options.map((o, i) => ({ ...o, correct: i === 0 })) });
    } else {
      onChange({ ...q, kind });
    }
  };
  const setOption = (i: number, o: Option) => onChange({ ...q, options: q.options.map((x, j) => (j === i ? o : x)) });
  const markCorrect = (i: number, v: boolean) =>
    onChange({ ...q, options: q.options.map((x, j) => (multi ? (j === i ? { ...x, correct: v } : x) : { ...x, correct: j === i })) });

  return (
    <fieldset className="flex flex-col gap-3 rounded-xl border border-line bg-page p-4" aria-describedby={err('options') ? `${prefix}-options-err` : undefined}>
      <legend className="sr-only">{b('question', { n })}</legend>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold text-fg" aria-hidden>
          {b('question', { n })}
        </p>
        <div className="flex flex-wrap gap-1 text-xs">
          <button type="button" disabled={n === 1} onClick={() => onMove(-1)} className="min-h-9 rounded border border-line px-2.5 disabled:opacity-40" aria-label={`${t('admin.common.moveUp')}: ${b('question', { n })}`}>
            ↑
          </button>
          <button type="button" disabled={n === count} onClick={() => onMove(1)} className="min-h-9 rounded border border-line px-2.5 disabled:opacity-40" aria-label={`${t('admin.common.moveDown')}: ${b('question', { n })}`}>
            ↓
          </button>
          <button type="button" onClick={onRemove} className="min-h-9 rounded border border-danger/40 px-2.5 text-danger">
            {b('removeQuestion', { n })}
          </button>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
        <SelectField
          label={b('kind')}
          required
          value={q.kind}
          onChange={(v) => v && setKind(v as QuizQuestionKind)}
          options={QUIZ_QUESTION_KINDS.map((k) => ({ value: k, label: b(`kindOpt.${k}`) }))}
        />
        <TextField label={b('weight')} required type="number" min={1} max={100} value={String(q.weight)} onChange={(v) => onChange({ ...q, weight: Number(v || 0) })} error={err('weight')} />
        <TextAreaField label={b('promptEn')} required rows={2} value={q.promptEn} onChange={(v) => onChange({ ...q, promptEn: v })} error={err('promptEn')} />
        <TextAreaField label={b('promptAr')} required rows={2} dir="rtl" value={q.promptAr} onChange={(v) => onChange({ ...q, promptAr: v })} error={err('promptAr')} />
      </div>
      <div className="flex flex-col gap-2">
        <p className="text-sm font-semibold text-fg">{b('options')}</p>
        {q.options.map((o, i) => (
          <div key={o.id ?? `new-${i}`} className="grid items-start gap-2 rounded-lg border border-line bg-card p-3 sm:grid-cols-[auto_1fr_1fr_auto]">
            <label className="flex min-h-11 items-center gap-2 text-sm font-medium sm:mt-7">
              <input
                type={multi ? 'checkbox' : 'radio'}
                name={`${prefix}-correct`}
                checked={o.correct}
                onChange={(e) => markCorrect(i, e.target.checked)}
                aria-label={b('markCorrect', { n: i + 1 })}
                aria-invalid={err('options') ? true : undefined}
                className="size-5 accent-[var(--success)]"
              />
              <span aria-hidden>{b('correct')}</span>
            </label>
            <TextField label={b('optionEn', { n: i + 1 })} required value={o.labelEn} onChange={(v) => setOption(i, { ...o, labelEn: v })} error={err(`options.${i}.labelEn`)} />
            <TextField label={b('optionAr', { n: i + 1 })} required dir="rtl" value={o.labelAr} onChange={(v) => setOption(i, { ...o, labelAr: v })} error={err(`options.${i}.labelAr`)} />
            {q.kind !== 'TRUE_FALSE' && (
              <button
                type="button"
                disabled={q.options.length <= 2}
                onClick={() => onChange({ ...q, options: q.options.filter((_, j) => j !== i) })}
                className="min-h-11 self-end rounded border border-line px-3 text-sm disabled:opacity-40"
                aria-label={b('removeOption', { n: i + 1 })}
              >
                ✕
              </button>
            )}
          </div>
        ))}
        {err('options') && (
          <p id={`${prefix}-options-err`} className="text-sm font-medium text-danger">
            {err('options')}
          </p>
        )}
        {q.kind !== 'TRUE_FALSE' && q.options.length < 10 && (
          <Button type="button" size="sm" variant="secondary" className="self-start" onClick={() => onChange({ ...q, options: [...q.options, emptyOption()] })}>
            + {b('addOption')}
          </Button>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextAreaField label={b('explanationEn')} rows={2} value={q.explanationEn ?? ''} onChange={(v) => onChange({ ...q, explanationEn: v || null })} />
        <TextAreaField label={b('explanationAr')} rows={2} dir="rtl" value={q.explanationAr ?? ''} onChange={(v) => onChange({ ...q, explanationAr: v || null })} />
      </div>
    </fieldset>
  );
}

// ------------------------------------------------------------------ form

function AssessmentForm({
  courseId,
  sessions,
  id,
  onSaved,
  onCancel,
}: {
  courseId: string;
  sessions: AssessmentSessionOption[];
  id: string | null;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const { locale, t } = useI18n();
  const f = (k: string, v?: Record<string, string | number>) => t(`admin.assessments.form.${k}`, v);
  const [draft, setDraft] = useState<Draft | null>(id ? null : EMPTY);
  const [submissions, setSubmissions] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (!id) return;
    api<AdminAssessmentDto>(`/admin/assessments/${id}`)
      .then((a) => {
        setDraft(toDraft(a));
        setSubmissions(a.submissionCount);
      })
      .catch((err) => setFormError(errorMessage(err, t)));
  }, [id, t]);
  useEffect(() => heading.current?.focus(), []);

  if (!draft) return formError ? <Alert tone="danger">{formError}</Alert> : <p className="text-muted">{t('admin.common.loading')}</p>;

  const set = <K extends keyof Draft>(k: K) => (v: Draft[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d));
  const quiz = draft.type === 'QUIZ';
  const totalWeight = draft.questions.reduce((n, q) => n + (Number(q.weight) || 0), 0);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!draft) return;
    setFormError(null);
    const payload = { ...draft, dueAt: fromLocalInput(draft.dueAt), questions: quiz ? draft.questions : [] };
    const parsed = assessmentInputSchema.safeParse(payload);
    if (!parsed.success) {
      setErrors(draftErrors(parsed.error.issues, t));
      setFormError(t('forms.fixErrors'));
      focusFirstInvalid(form.current);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await api(id ? `/admin/assessments/${id}` : `/admin/courses/${courseId}/assessments`, { method: id ? 'PUT' : 'POST', json: payload });
      onSaved();
    } catch (err) {
      setFormError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  const moveQuestion = (i: number, d: number) => {
    const next = [...draft.questions];
    const [x] = next.splice(i, 1);
    next.splice(i + d, 0, x!);
    set('questions')(next);
  };

  return (
    <Card>
      <form ref={form} onSubmit={submit} noValidate className="flex flex-col gap-4">
        <h2 ref={heading} tabIndex={-1} className="text-xl focus:outline-none">
          {id ? f('editTitle') : f('newTitle')}
        </h2>
        {formError && <Alert tone="danger">{formError}</Alert>}
        {submissions > 0 && <Alert tone="warning">{t('admin.assessments.hasSubmissions', { count: submissions })}</Alert>}
        <div className="grid gap-3 sm:grid-cols-3">
          <SelectField label={f('type')} required value={draft.type} onChange={(v) => v && set('type')(v as AssessmentType)} options={ASSESSMENT_TYPES.map((x) => ({ value: x, label: t(`assessments.type.${x}`) }))} />
          <SelectField label={f('status')} hint={f('statusHint')} required value={draft.status} onChange={(v) => v && set('status')(v as AssessmentStatus)} options={ASSESSMENT_STATUSES.map((x) => ({ value: x, label: t(`admin.assessments.status.${x}`) }))} />
          <SelectField
            label={f('session')}
            hint={f('sessionHint')}
            value={draft.sessionId ?? ''}
            onChange={(v) => set('sessionId')(v || null)}
            placeholder={t('admin.assessments.courseLevel')}
            options={sessions.map((s) => ({ value: s.id, label: t('admin.assessments.sessionN', { n: s.order, title: locale === 'ar' ? s.titleAr : s.titleEn }) }))}
            error={errors.sessionId}
          />
          <TextField label={f('titleEn')} required value={draft.titleEn} onChange={set('titleEn')} error={errors.titleEn} className="sm:col-span-3" />
          <TextField label={f('titleAr')} required dir="rtl" value={draft.titleAr} onChange={set('titleAr')} error={errors.titleAr} className="sm:col-span-3" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <MarkdownField label={f('instructionsEn')} value={draft.instructionsEn} onChange={set('instructionsEn')} rows={5} />
          <MarkdownField label={f('instructionsAr')} value={draft.instructionsAr} onChange={set('instructionsAr')} rows={5} dir="rtl" />
        </div>
        <div className="grid gap-3 sm:grid-cols-4">
          <TextField label={f('dueAt')} hint={f('dueHint')} type="datetime-local" value={draft.dueAt} onChange={set('dueAt')} error={errors.dueAt} className="sm:col-span-2" />
          <TextField label={f('maxPoints')} required type="number" min={1} max={1000} value={String(draft.maxPoints)} onChange={(v) => set('maxPoints')(Number(v || 0))} error={errors.maxPoints} />
          <TextField label={f('passPercent')} required type="number" min={0} max={100} value={String(draft.passPercent)} onChange={(v) => set('passPercent')(Number(v || 0))} error={errors.passPercent} />
          <TextField label={f('order')} type="number" min={0} max={999} value={String(draft.order)} onChange={(v) => set('order')(Number(v || 0))} error={errors.order} />
        </div>
        <div className="flex flex-col gap-2">
          <CheckboxField label={f('allowLate')} checked={draft.allowLate} onChange={set('allowLate')} error={errors.allowLate} />
          <CheckboxField label={f('certificate')} checked={draft.countsForCertificate} onChange={set('countsForCertificate')} error={errors.countsForCertificate} />
        </div>

        {quiz ? (
          <section aria-labelledby="quiz-settings" className="flex flex-col gap-3 border-t border-line pt-4">
            <h3 id="quiz-settings" className="text-base">
              {f('quizSettings')}
            </h3>
            <div className="grid gap-3 sm:grid-cols-4">
              <TextField label={f('attempts')} hint={f('attemptsHint')} required type="number" min={0} max={20} value={String(draft.attemptsAllowed)} onChange={(v) => set('attemptsAllowed')(Number(v || 0))} error={errors.attemptsAllowed} />
              <SelectField label={f('scoring')} required value={draft.scoring} onChange={(v) => v && set('scoring')(v as ScoringPolicy)} options={SCORING_POLICIES.map((x) => ({ value: x, label: f(`scoringOpt.${x}`) }))} />
              <SelectField label={f('reveal')} required value={draft.revealAnswers} onChange={(v) => v && set('revealAnswers')(v as RevealPolicy)} options={REVEAL_POLICIES.map((x) => ({ value: x, label: f(`revealOpt.${x}`) }))} />
              <TextField
                label={f('timeLimit')}
                hint={f('timeLimitHint')}
                type="number"
                min={1}
                max={600}
                value={draft.timeLimitMin ? String(draft.timeLimitMin) : ''}
                onChange={(v) => set('timeLimitMin')(v ? Number(v) : null)}
                error={errors.timeLimitMin}
              />
            </div>
            <p className="text-xs text-muted">{f('revealHint')}</p>
            <CheckboxField label={f('shuffle')} checked={draft.shuffle} onChange={set('shuffle')} />

            <div className="flex flex-col gap-3 border-t border-line pt-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-base">{t('admin.assessments.builder.title')}</h3>
                <p className="text-xs text-muted">{t('admin.assessments.builder.totalWeight', { weight: totalWeight })}</p>
              </div>
              {errors.questions && (
                <p className="text-sm font-medium text-danger" role="alert">
                  {errors.questions}
                </p>
              )}
              <ol className="flex flex-col gap-3">
                {draft.questions.map((q, i) => (
                  <li key={q.id ?? `new-${i}`}>
                    <QuestionEditor
                      q={q}
                      n={i + 1}
                      count={draft.questions.length}
                      errors={errors}
                      onChange={(next) => set('questions')(draft.questions.map((x, j) => (j === i ? next : x)))}
                      onMove={(d) => moveQuestion(i, d)}
                      onRemove={() => set('questions')(draft.questions.filter((_, j) => j !== i))}
                    />
                  </li>
                ))}
              </ol>
              <Button type="button" variant="secondary" className="self-start" onClick={() => set('questions')([...draft.questions, emptyQuestion()])}>
                + {t('admin.assessments.builder.add')}
              </Button>
            </div>
          </section>
        ) : (
          <SelectField
            label={f('submissionKind')}
            required
            value={draft.submissionKind ?? ''}
            onChange={(v) => set('submissionKind')((v as SubmissionKind) || null)}
            options={SUBMISSION_KINDS.map((x) => ({ value: x, label: f(`kind.${x}`) }))}
            error={errors.submissionKind}
          />
        )}

        <div className="flex flex-wrap gap-2 border-t border-line pt-4">
          <Button type="submit" loading={busy}>
            {f('save')}
          </Button>
          <Button type="button" variant="secondary" onClick={onCancel}>
            {t('admin.common.cancel')}
          </Button>
        </div>
      </form>
    </Card>
  );
}

// ------------------------------------------------------------------ the tab

type View = { mode: 'list' } | { mode: 'edit'; id: string | null } | { mode: 'book'; id: string };

/** The course editor's Assessments tab: the list, the editor (quiz builder) and each gradebook. */
export function AssessmentsEditor({ courseId, sessions }: { courseId: string; sessions: AssessmentSessionOption[] }) {
  const { locale, t } = useI18n();
  const a = (k: string, v?: Record<string, string | number>) => t(`admin.assessments.${k}`, v);
  const [rows, setRows] = useState<AdminAssessmentRow[] | null>(null);
  const [view, setView] = useState<View>({ mode: 'list' });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    api<AdminAssessmentRow[]>(`/admin/courses/${courseId}/assessments`)
      .then(setRows)
      .catch((err) => setError(errorMessage(err, t)));
  }, [courseId, t]);
  useEffect(load, [load]);

  async function remove(r: AdminAssessmentRow) {
    if (!window.confirm(a('deleteConfirm', { title: locale === 'ar' ? r.titleAr : r.titleEn }))) return;
    setError(null);
    try {
      await api(`/admin/assessments/${r.id}`, { method: 'DELETE' });
      load();
    } catch (err) {
      setError(errorMessage(err, t));
    }
  }

  if (view.mode === 'edit') {
    return (
      <AssessmentForm
        courseId={courseId}
        sessions={sessions}
        id={view.id}
        onCancel={() => setView({ mode: 'list' })}
        onSaved={() => {
          setNotice(a('saved'));
          setView({ mode: 'list' });
          load();
        }}
      />
    );
  }
  if (view.mode === 'book') {
    return (
      <AssessmentGradebook
        assessmentId={view.id}
        onBack={() => {
          setView({ mode: 'list' });
          load();
        }}
      />
    );
  }

  const sessionLabel = (id: string | null) => {
    const s = sessions.find((x) => x.id === id);
    return s ? a('sessionN', { n: s.order, title: locale === 'ar' ? s.titleAr : s.titleEn }) : a('courseLevel');
  };

  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-sm text-muted">{a('intro')}</p>
      {error && <Alert tone="danger">{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => setView({ mode: 'edit', id: null })}>+ {a('add')}</Button>
        <Button variant="secondary" onClick={() => downloadViaApi(`/admin/courses/${courseId}/gradebook.csv`, 'gradebook.csv').catch((err: unknown) => setError(errorMessage(err, t)))}>
          ⬇ {a('exportGradebook')}
        </Button>
      </div>
      {rows === null ? (
        <p className="text-muted">{t('admin.common.loading')}</p>
      ) : rows.length === 0 ? (
        <p className="text-muted">{a('none')}</p>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <li key={r.id}>
              <div className="flex flex-wrap items-start justify-between gap-3 rounded-card border border-line bg-card p-4 sm:p-5">
                <div className="min-w-0">
                  <p className="font-semibold text-fg">{locale === 'ar' ? r.titleAr : r.titleEn}</p>
                  <p className="text-sm text-muted">
                    {sessionLabel(r.sessionId)}
                    {r.dueAt && ` · ${t('assessments.due')}: ${formatDateTime(r.dueAt, locale)}`}
                    {` · ${t('assessments.points', { count: r.maxPoints })}`}
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    <Badge tone={r.type === 'QUIZ' ? 'primary' : 'accent'}>{t(`assessments.type.${r.type}`)}</Badge>
                    <Badge tone={r.status === 'PUBLISHED' ? 'success' : 'warning'}>{a(`status.${r.status}`)}</Badge>
                    {r.type === 'QUIZ' ? <Badge>{t('assessments.questions', { count: r.questionCount })}</Badge> : r.submissionKind && <Badge>{t(`admin.assessments.form.kind.${r.submissionKind}`)}</Badge>}
                    {r.countsForCertificate && <Badge tone="info">{t('assessments.certificate')}</Badge>}
                    <Badge>{a('submittedCount', { count: r.submitted })}</Badge>
                    {r.toGrade > 0 && <Badge tone="danger">{a('toGrade', { count: r.toGrade })}</Badge>}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => setView({ mode: 'book', id: r.id })}>
                    {a('grade')}
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => setView({ mode: 'edit', id: r.id })}>
                    {a('edit')}
                  </Button>
                  <Button size="sm" variant="ghost" className="text-danger" onClick={() => remove(r)}>
                    {a('delete')}
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

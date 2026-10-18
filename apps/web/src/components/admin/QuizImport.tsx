'use client';

import {
  QUIZ_BOOK_MAX_QUESTIONS,
  QUIZ_BOOK_MAX_QUIZZES,
  type AdminAssessmentRow,
  type QuizBookError,
  type QuizBookQuiz,
  type QuizBookResult,
  type QuizImportResult,
} from '@academy/shared';
import { useEffect, useId, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { CheckboxField } from '@/components/forms/fields';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useI18n } from '@/i18n/client';
import { api, ApiError } from '@/lib/api';
import { downloadBlob } from '@/lib/download';
import { errorMessage } from '@/lib/errors';
import { formatDateTime } from '@/lib/format';
import { QuizFileError, quizBookTemplate, readQuizBookFile } from '@/lib/quiz-file';
import type { AssessmentEndpoints } from './assessment-endpoints';
import type { AssessmentSessionOption } from './AssessmentsEditor';

interface Preview extends QuizBookResult {
  file: string;
}

/** A row problem from the file, or a session number this course doesn't have. */
type RowError = Omit<QuizBookError, 'code'> & { code: QuizBookError['code'] | 'UNKNOWN_SESSION' };

/** The sheet's own error codes are worded in admin.assessments.upload.errors; the import's own here. */
const BOOK_CODES = new Set([
  'NO_QUIZ_TITLE',
  'BAD_TITLE',
  'BAD_SESSION',
  'SESSION_MISMATCH',
  'BAD_PASS_PERCENT',
  'BAD_DUE',
  'BAD_ATTEMPTS',
  'BAD_TIME_LIMIT',
  'BAD_REVEAL',
  'BAD_MANDATORY',
  'BAD_STATUS',
  'BAD_MAX_POINTS',
  'REVEAL_NEEDS_DUE',
  'PRACTICE_CERTIFICATE',
  'TOO_MANY_QUIZZES',
  'QUIZ_TOO_MANY_QUESTIONS',
  'TOO_MANY_QUESTIONS',
  'UNKNOWN_SESSION',
]);

/**
 * The Assessments tab's "Import quizzes from a file": one .xlsx or .csv (read in this browser)
 * becomes several quizzes, each on a session, with all their questions. A preview per quiz
 * (session, questions, total weight, settings, what happens to it) and every row's problem
 * come first; nothing is saved while there are errors, and then all quizzes are saved at once
 * (all or nothing).
 */
export function QuizImport({
  endpoints,
  sessions,
  existing,
  onDone,
  onCancel,
}: {
  endpoints: AssessmentEndpoints;
  sessions: AssessmentSessionOption[];
  /** The course's assessments now: a quiz with the same title in the same session is skipped or replaced. */
  existing: AdminAssessmentRow[];
  onDone: (result: QuizImportResult & { rows: AdminAssessmentRow[] }) => void;
  onCancel: () => void;
}) {
  const { locale, t } = useI18n();
  const m = (k: string, v?: Record<string, string | number>) => t(`admin.assessments.import.${k}`, v);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [replace, setReplace] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const headingId = useId();
  useEffect(() => headingRef.current?.focus(), []);

  const sessionByNumber = useMemo(() => new Map(sessions.map((s) => [s.order, s])), [sessions]);
  const sessionLabel = (n: number | null) => {
    if (n === null) return t('admin.assessments.courseLevel');
    const s = sessionByNumber.get(n);
    return s ? t('admin.assessments.sessionN', { n, title: locale === 'ar' ? s.titleAr || s.titleEn : s.titleEn }) : m('noSuchSession', { n });
  };

  /** The file's errors plus sessions this course doesn't have (the server checks again). */
  const errors: RowError[] = useMemo(() => {
    if (!preview) return [];
    const missing = preview.quizzes
      .filter((q) => q.session !== null && !sessionByNumber.has(q.session))
      .map((q): RowError => ({ row: q.row, code: 'UNKNOWN_SESSION', params: { n: q.session! }, message: '', quiz: q.assessment.titleEn }));
    return [...preview.errors, ...missing].sort((a, b) => a.row - b.row);
  }, [preview, sessionByNumber]);

  const existingFor = (q: QuizBookQuiz) => {
    const sessionId = q.session === null ? null : (sessionByNumber.get(q.session)?.id ?? '?');
    return existing.find((r) => r.type === 'QUIZ' && r.sessionId === sessionId && r.titleEn.trim().toLowerCase() === q.assessment.titleEn.trim().toLowerCase()) ?? null;
  };

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    setPreview(null);
    setError(null);
    if (!f) return;
    setReading(true);
    try {
      setPreview({ ...(await readQuizBookFile(f)), file: f.name });
      requestAnimationFrame(() => previewRef.current?.focus());
    } catch (err) {
      setError(err instanceof QuizFileError && err.code === 'TOO_BIG' ? t('admin.assessments.upload.tooBig') : t('admin.assessments.upload.badFile'));
    } finally {
      setReading(false);
    }
  }

  const message = (e: RowError) => (BOOK_CODES.has(e.code) ? m(`errors.${e.code}`, e.params) : t(`admin.assessments.upload.errors.${e.code}`, e.params));

  async function save() {
    if (!preview || errors.length) return;
    setError(null);
    setSaving(true);
    try {
      const result = await api<QuizImportResult & { rows: AdminAssessmentRow[] }>(endpoints.import, {
        method: 'POST',
        json: { replaceExisting: replace, quizzes: preview.quizzes.map(({ session, assessment }) => ({ session, assessment })) },
      });
      onDone(result);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'HAS_SUBMISSIONS') setError(m('hasSubmissions', { titles: ((err.body.titles as string[] | undefined) ?? []).join(', ') }));
      else if (err instanceof ApiError && err.code === 'SPEAKER_ASSESSMENT_LIMIT') setError(m('dailyLimit'));
      else if (err instanceof ApiError && err.code === 'UNKNOWN_SESSION') setError(m('sessionsChanged'));
      else if (err instanceof ApiError && err.status === 413) setError(m('tooLarge'));
      else setError(errorMessage(err, t));
    } finally {
      setSaving(false);
    }
  }

  const quizzes = preview?.quizzes ?? [];
  const published = quizzes.filter((q) => q.assessment.status === 'PUBLISHED' && !(existingFor(q) && !replace)).length;
  const toSave = quizzes.filter((q) => replace || !existingFor(q)).length;
  const canSave = Boolean(preview && errors.length === 0 && quizzes.length > 0 && toSave > 0);

  const settings = (q: QuizBookQuiz) => {
    const a = q.assessment;
    return [
      m('setPass', { n: a.passPercent }),
      a.dueAt ? m('setDue', { when: formatDateTime(a.dueAt, locale) }) : m('setNoDue'),
      a.attemptsAllowed === 0 ? m('setUnlimited') : m('setAttempts', { count: a.attemptsAllowed }),
      a.timeLimitMin ? m('setLimit', { n: a.timeLimitMin }) : null,
      t(`admin.assessments.form.revealOpt.${a.revealAnswers}`),
      m('setMax', { n: a.maxPoints }),
    ].filter(Boolean) as string[];
  };

  return (
    <Card>
      <section aria-labelledby={headingId} className="flex flex-col gap-4">
        <h2 id={headingId} ref={headingRef} tabIndex={-1} className="text-xl focus:outline-none">
          {m('title')}
        </h2>
        <p className="max-w-3xl text-sm text-muted">{m('intro', { quizzes: QUIZ_BOOK_MAX_QUIZZES, questions: QUIZ_BOOK_MAX_QUESTIONS })}</p>
        <div className="max-w-3xl space-y-1 text-xs text-muted">
          <p>{m('columnsQuiz')}</p>
          <p>{t('admin.assessments.upload.columns')}</p>
          <p>{m('columnsSettings')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex min-h-11 cursor-pointer items-center rounded-lg border border-line-button bg-card px-4 text-sm font-medium hover:bg-hover-bg focus-within:outline-2 focus-within:outline-primary">
            {reading ? t('admin.assessments.upload.reading') : t('admin.assessments.upload.choose')}
            <input type="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" className="sr-only" disabled={reading || saving} onChange={(e) => void onFile(e)} />
          </label>
          <Button type="button" size="sm" variant="secondary" onClick={() => downloadBlob(quizBookTemplate('xlsx'), 'quizzes-template.xlsx')}>
            ⬇ {m('templateXlsx')}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => downloadBlob(quizBookTemplate('csv'), 'quizzes-template.csv')}>
            ⬇ {m('templateCsv')}
          </Button>
        </div>
        {error && <Alert tone="danger">{error}</Alert>}

        {preview && (
          <div ref={previewRef} tabIndex={-1} className="flex flex-col gap-3 focus:outline-none" aria-live="polite">
            <p className="text-sm font-semibold text-fg">
              <span className="ltr-embed">{t('admin.assessments.upload.previewTitle', { file: preview.file })}</span>
            </p>
            {errors.length > 0 ? (
              <Alert tone="danger">
                <p>{t('admin.assessments.upload.errorCount', { count: errors.length })}</p>
                <ul className="mt-2 list-disc space-y-1 ps-5">
                  {errors.slice(0, 50).map((e, i) => (
                    <li key={`${e.row}-${e.code}-${i}`}>
                      <span className="font-semibold">
                        {t('admin.assessments.upload.row')} {e.row}
                        {e.quiz && (
                          <>
                            {' '}
                            (<bdi>{e.quiz}</bdi>)
                          </>
                        )}
                        :
                      </span>{' '}
                      {message(e)}
                    </li>
                  ))}
                </ul>
              </Alert>
            ) : (
              <Alert tone="success">{m('ready', { quizzes: quizzes.length, questions: preview.questionCount })}</Alert>
            )}
            {quizzes.length > 0 && (
              <div className="overflow-x-auto rounded-xl border border-line bg-card">
                <table className="w-full min-w-[40rem] text-sm">
                  <caption className="sr-only">{m('tableCaption')}</caption>
                  <thead className="bg-muted-bg text-xs text-muted">
                    <tr>
                      <th scope="col" className="p-2 text-start">
                        {m('quiz')}
                      </th>
                      <th scope="col" className="p-2 text-start">
                        {m('session')}
                      </th>
                      <th scope="col" className="p-2 text-start">
                        {m('questions')}
                      </th>
                      <th scope="col" className="p-2 text-start">
                        {m('totalWeight')}
                      </th>
                      <th scope="col" className="p-2 text-start">
                        {m('settings')}
                      </th>
                      <th scope="col" className="p-2 text-start">
                        {m('outcome')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {quizzes.map((q) => {
                      const a = q.assessment;
                      const match = existingFor(q);
                      const weights = a.questions.map((x) => x.weight);
                      return (
                        <tr key={`${q.row}`} className="border-t border-line align-top">
                          <th scope="row" className="p-2 text-start font-semibold text-fg">
                            <span dir="auto">{a.titleEn}</span>
                            <span className="block text-xs font-normal text-muted">{m('fromRow', { row: q.row })}</span>
                          </th>
                          <td className="p-2">{sessionLabel(q.session)}</td>
                          <td className="p-2">
                            {a.questions.length}
                            <span className="block text-xs text-muted">{m('kinds', { single: a.questions.filter((x) => x.kind === 'SINGLE').length, multiple: a.questions.filter((x) => x.kind === 'MULTIPLE').length, tf: a.questions.filter((x) => x.kind === 'TRUE_FALSE').length })}</span>
                          </td>
                          <td className="p-2">
                            {weights.reduce((n, w) => n + w, 0)}
                            <span className="block text-xs text-muted">
                              <bdi dir="ltr">{weights.join(' + ')}</bdi>
                            </span>
                          </td>
                          <td className="p-2">
                            <div className="mb-1 flex flex-wrap gap-1">
                              <Badge tone={a.status === 'PUBLISHED' ? 'success' : 'warning'}>{t(`admin.assessments.status.${a.status}`)}</Badge>
                              <Badge tone={a.countsForCertificate ? 'info' : 'neutral'}>{t(`admin.assessments.${a.countsForCertificate ? 'mandatory' : 'optional'}`)}</Badge>
                            </div>
                            <p className="text-xs text-muted">{settings(q).join(' · ')}</p>
                          </td>
                          <td className="p-2">{!match ? <Badge tone="success">{m('new')}</Badge> : replace ? <Badge tone="danger">{m('willReplace')}</Badge> : <Badge>{m('willSkip')}</Badge>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {quizzes.length > 0 && (
              <CheckboxField label={m('replace')} hint={m('replaceHint')} checked={replace} onChange={setReplace} />
            )}
            {canSave && published > 0 && <Alert tone="warning">{m('publishWarning', { count: published })}</Alert>}
            {preview && errors.length === 0 && quizzes.length > 0 && toSave === 0 && <Alert tone="info">{m('nothingToSave')}</Alert>}
          </div>
        )}

        <div className="flex flex-wrap gap-2 border-t border-line pt-4">
          <Button type="button" disabled={!canSave} loading={saving} onClick={() => void save()}>
            {m('save', { count: toSave })}
          </Button>
          <Button type="button" variant="secondary" onClick={onCancel}>
            {t('admin.common.cancel')}
          </Button>
        </div>
      </section>
    </Card>
  );
}

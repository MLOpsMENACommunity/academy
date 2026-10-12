'use client';

import { MAX_QUESTIONS, type QuizQuestionInput, type QuizSheetError, type QuizSheetResult } from '@academy/shared';
import { useId, useRef, useState, type ChangeEvent } from 'react';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { useI18n } from '@/i18n/client';
import { downloadBlob } from '@/lib/download';
import { QuizFileError, quizTemplate, readQuizFile } from '@/lib/quiz-file';

interface Preview extends QuizSheetResult {
  file: string;
}

/**
 * The quiz builder's "Upload questions" panel: the template, a file picker (.xlsx or
 * .csv, read in this browser), a preview with each row's problem, then "add" or "replace".
 * Nothing is saved here: the questions land in the builder and the admin saves the quiz.
 */
export function QuizUpload({
  current,
  disabled,
  onApply,
}: {
  /** Questions already in the builder. */
  current: number;
  /** Students have submitted: the question set is locked. */
  disabled: boolean;
  onApply: (questions: QuizQuestionInput[], mode: 'append' | 'replace') => void;
}) {
  const { t } = useI18n();
  const u = (k: string, v?: Record<string, string | number>) => t(`admin.assessments.upload.${k}`, v);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const headingId = useId();
  const previewRef = useRef<HTMLDivElement>(null);

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    setPreview(null);
    setError(null);
    if (!f) return;
    setBusy(true);
    try {
      const r = await readQuizFile(f);
      setPreview({ ...r, file: f.name });
      requestAnimationFrame(() => previewRef.current?.focus());
    } catch (err) {
      setError(err instanceof QuizFileError && err.code === 'TOO_BIG' ? u('tooBig') : u('badFile'));
    } finally {
      setBusy(false);
    }
  }

  // Column names in messages stay as the sheet's own headers ("question", "option", "explanation").
  const message = (e: QuizSheetError) => u(`errors.${e.code}`, e.params);

  function apply(mode: 'append' | 'replace') {
    if (!preview) return;
    if (mode === 'replace' && current > 0 && !window.confirm(u('replaceConfirm', { count: current, next: preview.questions.length }))) return;
    onApply(preview.questions, mode);
    setPreview(null);
  }

  const appendTotal = current + (preview?.questions.length ?? 0);
  const canApply = Boolean(preview && preview.errors.length === 0 && preview.questions.length > 0);

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3 rounded-xl border border-dashed border-line-strong bg-page p-4">
      <h4 id={headingId} className="text-sm font-semibold text-fg">
        {u('title')}
      </h4>
      <p className="max-w-3xl text-sm text-muted">{u('intro', { max: MAX_QUESTIONS })}</p>
      <p className="max-w-3xl text-xs text-muted">{u('columns')}</p>
      {disabled ? (
        <p className="text-sm text-muted">{u('lockedNote')}</p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex min-h-11 cursor-pointer items-center rounded-lg border border-line-button bg-card px-4 text-sm font-medium hover:bg-hover-bg focus-within:outline-2 focus-within:outline-primary">
            {busy ? u('reading') : u('choose')}
            <input type="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" className="sr-only" disabled={busy} onChange={(e) => void onFile(e)} />
          </label>
          <Button type="button" size="sm" variant="secondary" onClick={() => downloadBlob(quizTemplate('xlsx'), 'quiz-template.xlsx')}>
            ⬇ {u('templateXlsx')}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => downloadBlob(quizTemplate('csv'), 'quiz-template.csv')}>
            ⬇ {u('templateCsv')}
          </Button>
        </div>
      )}
      {error && <Alert tone="danger">{error}</Alert>}

      {preview && (
        <div ref={previewRef} tabIndex={-1} className="flex flex-col gap-3 focus:outline-none" aria-live="polite">
          <p className="text-sm font-semibold text-fg">
            <span className="ltr-embed">{u('previewTitle', { file: preview.file })}</span>
          </p>
          {preview.errors.length > 0 ? (
            <Alert tone="danger">
              <p>{u('errorCount', { count: preview.errors.length })}</p>
              <ul className="mt-2 list-disc space-y-1 ps-5">
                {preview.errors.slice(0, 50).map((e) => (
                  <li key={`${e.row}-${e.code}`}>
                    <span className="font-semibold">
                      {u('row')} {e.row}:
                    </span>{' '}
                    {message(e)}
                  </li>
                ))}
              </ul>
            </Alert>
          ) : (
            <Alert tone="success">{u('found', { count: preview.questions.length })}</Alert>
          )}
          {preview.questions.length > 0 && (
            <div className="max-h-96 overflow-auto rounded-xl border border-line bg-card">
              <table className="w-full min-w-[36rem] text-sm">
                <thead className="sticky top-0 bg-muted-bg text-xs text-muted">
                  <tr>
                    <th className="p-2 text-start">#</th>
                    <th className="p-2 text-start">{u('type')}</th>
                    <th className="p-2 text-start">{u('question')}</th>
                    <th className="p-2 text-start">{u('answers')}</th>
                    <th className="p-2 text-start">{u('weight')}</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.questions.map((q, i) => (
                    <tr key={i} className="border-t border-line align-top">
                      <td className="p-2 text-muted">{i + 1}</td>
                      <td className="p-2 whitespace-nowrap">{t(`admin.assessments.builder.kindOpt.${q.kind}`)}</td>
                      <td className="p-2" dir="auto">
                        {q.promptEn}
                      </td>
                      <td className="p-2">
                        <ul className="space-y-0.5">
                          {q.options.map((o, j) => (
                            <li key={j} dir="auto" className={o.correct ? 'font-semibold text-success' : ''}>
                              {o.correct ? '✓ ' : '· '}
                              {q.kind === 'TRUE_FALSE' ? t(j === 0 ? 'assessments.true' : 'assessments.false') : o.labelEn}
                            </li>
                          ))}
                        </ul>
                      </td>
                      <td className="p-2">{q.weight}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {canApply && appendTotal > MAX_QUESTIONS && <Alert tone="warning">{u('overLimit', { max: MAX_QUESTIONS, total: appendTotal })}</Alert>}
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" disabled={!canApply || appendTotal > MAX_QUESTIONS} onClick={() => apply('append')}>
              {u('append')}
            </Button>
            <Button type="button" size="sm" variant="secondary" disabled={!canApply} onClick={() => apply('replace')}>
              {u('replace')}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setPreview(null)}>
              {u('cancel')}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

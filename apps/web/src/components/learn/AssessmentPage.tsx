'use client';

import type { AssessmentDetailDto, MySubmissionDto, QuizAttemptDto, QuizResultDto } from '@academy/shared';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { RequireAuth } from '@/components/auth/RequireAuth';
import { useAuth } from '@/components/auth/AuthProvider';
import { LocalTime } from '@/components/course/LocalTime';
import { Markdown } from '@/components/course/Markdown';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Container } from '@/components/ui/Container';
import { PageSpinner } from '@/components/ui/Spinner';
import { useI18n } from '@/i18n/client';
import { api, ApiError } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { scoreText, stateTone } from './AssessmentList';
import { assessmentError } from './assessment-errors';
import { assessmentText } from './assessment-text';
import { QuizPlayer } from './QuizPlayer';
import { QuizReview } from './QuizReview';
import { WorkSubmission } from './WorkSubmission';

export function AssessmentPage() {
  return <RequireAuth>{() => <Inner />}</RequireAuth>;
}

/** The score screen after a quiz attempt. */
function ResultCard({ result, detail }: { result: QuizResultDto; detail: AssessmentDetailDto }) {
  const { t } = useI18n();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  return (
    <section aria-labelledby="quiz-result" className={`flex flex-col items-center gap-3 rounded-xl border p-6 text-center sm:p-8 ${result.passed ? 'border-success/40 bg-success-soft' : 'border-warning/40 bg-warning-soft'}`}>
      <h2 id="quiz-result" ref={heading} tabIndex={-1} className="text-base font-medium text-body focus:outline-none">
        {t('assessments.result.title')}
      </h2>
      <p className="text-5xl font-bold text-fg tabular-nums" dir="ltr">
        {scoreText(result.score, result.maxScore)}
      </p>
      <p className="text-[0.9375rem] text-body">
        {t('assessments.result.score', { score: Number(result.score.toFixed(2)), max: result.maxScore })} · {t('assessments.percent', { percent: result.percent })}
      </p>
      <Badge tone={result.passed ? 'success' : 'warning'}>{result.passed ? t('assessments.result.passed') : t('assessments.result.below', { percent: detail.passPercent })}</Badge>
      {result.late && <p className="text-sm text-warning">{t('assessments.result.late')}</p>}
      {result.attemptsLeft !== null && <p className="text-sm text-muted">{t('assessments.attemptsLeft', { count: result.attemptsLeft })}</p>}
      {!result.review && <p className="text-sm text-muted">{detail.revealAnswers === 'NEVER' ? t('assessments.result.keyNever') : t('assessments.result.keyLater')}</p>}
    </section>
  );
}

function SubmittedWork({ s, slug, assessmentId }: { s: MySubmissionDto; slug: string; assessmentId: string }) {
  const { t } = useI18n();
  const [error, setError] = useState<string | null>(null);
  async function openFile() {
    setError(null);
    // Open the tab first (in the click) so pop-up blockers allow it, then point it at the signed link.
    const tab = window.open('', '_blank');
    try {
      const { url } = await api<{ url: string }>(`/learn/${slug}/assessments/${assessmentId}/file`);
      if (tab) tab.location.href = url;
      else window.location.href = url;
    } catch (err) {
      tab?.close();
      setError(errorMessage(err, t));
    }
  }
  return (
    <section aria-labelledby="my-work" className="flex flex-col gap-3 rounded-xl border border-line bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="my-work" className="text-base">
          {t('assessments.work.yourSubmission')}
        </h2>
        <span className="flex flex-wrap gap-2">
          {s.late && <Badge tone="warning">{t('assessments.late')}</Badge>}
          {s.gradedAt && s.score !== null ? <Badge tone="success">{scoreText(s.score, s.maxScore)}</Badge> : <Badge tone="warning">{t('assessments.work.awaiting')}</Badge>}
        </span>
      </div>
      <dl className="grid gap-x-4 gap-y-1 text-[0.9375rem] sm:grid-cols-[auto_1fr]">
        {s.submittedAt && (
          <>
            <dt className="text-muted">{t('assessments.work.submittedAt')}</dt>
            <dd>
              <LocalTime iso={s.submittedAt} style="weekday-datetime" />
            </dd>
          </>
        )}
        {s.url && (
          <>
            <dt className="text-muted">{t('assessments.work.link')}</dt>
            <dd className="min-w-0 break-all" dir="ltr">
              <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-primary underline">
                {s.url}
              </a>
            </dd>
          </>
        )}
        {s.hasFile && (
          <>
            <dt className="text-muted">PDF</dt>
            <dd>
              <button type="button" onClick={openFile} className="inline-flex min-h-11 items-center text-primary underline sm:min-h-0">
                {s.fileName ?? t('assessments.work.viewFile')}
              </button>
            </dd>
          </>
        )}
        {s.note && (
          <>
            <dt className="text-muted">{t('assessments.work.noteLabel')}</dt>
            <dd className="whitespace-pre-line">{s.note}</dd>
          </>
        )}
      </dl>
      {s.repoCheck === 'UNVERIFIED' && !s.gradedAt && <Alert tone="warning">{t('assessments.work.unverified')}</Alert>}
      {s.gradedAt && (s.feedback || s.rubricNotes) && (
        <div className="flex flex-col gap-2 rounded-lg bg-muted-bg p-4">
          {s.feedback && (
            <div>
              <h3 className="text-sm font-semibold text-fg">{t('assessments.work.feedback')}</h3>
              <p className="mt-1 whitespace-pre-line text-body">{s.feedback}</p>
            </div>
          )}
          {s.rubricNotes && (
            <div>
              <h3 className="text-sm font-semibold text-fg">{t('assessments.work.rubric')}</h3>
              <p className="mt-1 whitespace-pre-line text-body">{s.rubricNotes}</p>
            </div>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </section>
  );
}

function Inner() {
  const { locale, t } = useI18n();
  const { user } = useAuth();
  const { slug, id } = useParams<{ slug: string; id: string }>();
  const [detail, setDetail] = useState<AssessmentDetailDto | null>(null);
  const [loadError, setLoadError] = useState<'forbidden' | 'notFound' | 'generic' | null>(null);
  const [attempt, setAttempt] = useState<QuizAttemptDto | null>(null);
  const [result, setResult] = useState<QuizResultDto | null>(null);
  const [notice, setNotice] = useState<{ tone: 'success' | 'warning' | 'danger'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api<AssessmentDetailDto>(`/learn/${slug}/assessments/${id}`)
      .then(setDetail)
      .catch((e: unknown) =>
        setLoadError(e instanceof ApiError && e.status === 403 ? 'forbidden' : e instanceof ApiError && e.status === 404 ? 'notFound' : 'generic'),
      );
  }, [slug, id]);
  useEffect(load, [load]);

  async function start() {
    setBusy(true);
    setNotice(null);
    try {
      setAttempt(await api<QuizAttemptDto>(`/learn/${slug}/assessments/${id}/start`, { method: 'POST' }));
      setResult(null);
      window.scrollTo({ top: 0 });
    } catch (err) {
      setNotice({ tone: 'danger', text: assessmentError(err, t) });
      load();
    } finally {
      setBusy(false);
    }
  }

  const back = (
    <Link href={`/${locale}/learn/${slug}#assessments`} className="inline-flex min-h-11 items-center gap-1.5 text-sm text-muted hover:underline">
      <span aria-hidden className="inline-block rtl:rotate-180">
        ←
      </span>{' '}
      {t('assessments.back')}
    </Link>
  );

  if (loadError) {
    return (
      <Container className="py-12">
        <Alert tone={loadError === 'generic' ? 'danger' : 'info'}>
          {loadError === 'forbidden' ? t('learn.notEnrolled') : loadError === 'notFound' ? t('errors.notFound') : t('errors.generic')}
        </Alert>
        <div className="mt-4">{back}</div>
      </Container>
    );
  }
  if (!detail) return <PageSpinner />;

  const title = assessmentText(locale, detail.titleEn, detail.titleAr);
  const instructions = assessmentText(locale, detail.instructionsEn, detail.instructionsAr);
  const quiz = detail.type === 'QUIZ';
  const preview = user?.role === 'ADMIN';
  const latest = detail.submissions[0] ?? null;

  return (
    <Container className="flex max-w-3xl flex-col gap-6 py-6 sm:py-10">
      {back}
      <header className="flex flex-col gap-2">
        <p className="flex flex-wrap items-center gap-2">
          <Badge tone={quiz ? 'primary' : 'accent'}>{t(`assessments.type.${detail.type}`)}</Badge>
          <Badge tone={stateTone[detail.state]}>{t(`assessments.state.${detail.state}`)}</Badge>
          {detail.late && <Badge tone="warning">{t('assessments.late')}</Badge>}
          {detail.countsForCertificate && <Badge tone="info">{t('assessments.certificate')}</Badge>}
        </p>
        <h1 dir={title.dir} className="text-2xl leading-snug sm:text-3xl">
          {title.text}
        </h1>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[0.9375rem] text-muted">
          <li>
            {detail.dueAt ? (
              <>
                {t('assessments.due')}: <LocalTime iso={detail.dueAt} style="weekday-datetime" />
              </>
            ) : (
              t('assessments.noDue')
            )}
          </li>
          <li>{t('assessments.points', { count: detail.maxPoints })}</li>
          <li>{t('assessments.passMark', { percent: detail.passPercent })}</li>
          {quiz && <li>{t('assessments.questions', { count: detail.questionCount })}</li>}
          {quiz && detail.timeLimitMin && <li>{t('assessments.timeLimit', { minutes: detail.timeLimitMin })}</li>}
          {quiz && <li>{detail.attemptsAllowed === 0 ? t('assessments.unlimited') : t('assessments.attemptsAllowed', { count: detail.attemptsAllowed })}</li>}
        </ul>
      </header>

      {preview && <Alert tone="info">{t('assessments.adminPreview')}</Alert>}
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}

      {attempt ? (
        <QuizPlayer
          slug={slug}
          assessmentId={id}
          attempt={attempt}
          onSubmitted={(r) => {
            setAttempt(null);
            setResult(r);
            window.scrollTo({ top: 0 });
            load();
          }}
          onClosed={(msg) => {
            setAttempt(null);
            setNotice({ tone: 'warning', text: msg });
            load();
          }}
        />
      ) : (
        <>
          {result && <ResultCard result={result} detail={detail} />}

          {instructions.text.trim() && (
            <section aria-labelledby="instructions" className="flex flex-col gap-2">
              <h2 id="instructions" className="text-lg">
                {t('assessments.instructions')}
              </h2>
              <div dir={instructions.dir}>
                <Markdown>{instructions.text}</Markdown>
              </div>
            </section>
          )}

          {quiz ? (
            <section className="flex flex-col gap-3 rounded-xl border border-line bg-card p-5">
              <ul className="flex flex-col gap-1 text-[0.9375rem] text-body">
                <li>{t(`assessments.scoring.${detail.scoring}`)}</li>
                <li>{t(`assessments.reveal.${detail.revealAnswers}`)}</li>
                {detail.dueAt && <li>{detail.allowLate ? t('assessments.lateAllowed') : t('assessments.lateNotAllowed')}</li>}
                {detail.attemptsLeft !== null && detail.attemptsUsed > 0 && !detail.closed && <li>{t('assessments.attemptsLeft', { count: detail.attemptsLeft })}</li>}
              </ul>
              {detail.inProgress ? (
                <Button className="self-start" size="lg" disabled={preview} onClick={() => setAttempt(detail.inProgress)}>
                  {t('assessments.continue')}
                </Button>
              ) : detail.closed ? (
                <Alert tone={detail.closed === 'PAST_DUE' ? 'warning' : 'info'}>{t(`assessments.closed.${detail.closed}`)}</Alert>
              ) : (
                <>
                  <p className="text-sm text-muted">{detail.timeLimitMin ? t('assessments.timeStartsHint', { minutes: detail.timeLimitMin }) : t('assessments.startHint')}</p>
                  <Button className="self-start" size="lg" loading={busy} disabled={preview} onClick={start}>
                    {detail.attemptsUsed > 0 ? t('assessments.retake') : t('assessments.start')}
                  </Button>
                </>
              )}
            </section>
          ) : (
            <>
              {latest && <SubmittedWork s={latest} slug={slug} assessmentId={id} />}
              {detail.closed ? (
                detail.closed !== 'GRADED' && <Alert tone="warning">{t(`assessments.closed.${detail.closed}`)}</Alert>
              ) : (
                !preview &&
                detail.submissionKind && (
                  <section aria-labelledby="submit-work" className="flex flex-col gap-3 rounded-xl border border-line bg-card p-5">
                    <h2 id="submit-work" className="text-base">
                      {t(`assessments.submitAs.${detail.submissionKind}`)}
                    </h2>
                    {latest && <p className="text-sm text-muted">{t('assessments.work.resubmitHint')}</p>}
                    {detail.dueAt && <p className="text-sm text-muted">{detail.allowLate ? t('assessments.lateAllowed') : t('assessments.lateNotAllowed')}</p>}
                    <WorkSubmission
                      key={latest?.id ?? 'new'}
                      slug={slug}
                      assessmentId={id}
                      kind={detail.submissionKind}
                      current={latest}
                      onSaved={(s) => {
                        setNotice({ tone: s.repoCheck === 'UNVERIFIED' ? 'warning' : 'success', text: s.repoCheck === 'UNVERIFIED' ? t('assessments.work.unverified') : t('assessments.work.saved') });
                        window.scrollTo({ top: 0 });
                        load();
                      }}
                    />
                  </section>
                )
              )}
            </>
          )}

          {quiz && detail.submissions.length > 0 && (
            <section aria-labelledby="attempts" className="flex flex-col gap-2">
              <h2 id="attempts" className="text-base">
                {t('assessments.result.history')}
              </h2>
              <ul className="divide-y divide-line-soft overflow-hidden rounded-xl border border-line bg-card">
                {detail.submissions.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-[0.9375rem]">
                    <span>
                      {t('assessments.result.attempt', { n: s.attempt })}
                      {s.submittedAt && (
                        <span className="text-muted">
                          {' · '}
                          <LocalTime iso={s.submittedAt} style="datetime" />
                        </span>
                      )}
                    </span>
                    <span className="flex flex-wrap gap-2">
                      {s.late && <Badge tone="warning">{t('assessments.late')}</Badge>}
                      {s.score !== null && <Badge tone="neutral">{scoreText(s.score, s.maxScore)}</Badge>}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {(result?.review ?? detail.review) && <QuizReview review={(result?.review ?? detail.review)!} />}
        </>
      )}
    </Container>
  );
}

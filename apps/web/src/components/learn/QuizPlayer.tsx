'use client';

import type { QuizAnswers, QuizAttemptDto, QuizQuestionDto, QuizResultDto } from '@academy/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { useI18n } from '@/i18n/client';
import { api } from '@/lib/api';
import { assessmentError } from './assessment-errors';
import { assessmentText, optionText } from './assessment-text';

const PHONE = '(max-width: 39.99rem)';

/** Answers survive a reload or a dropped connection: kept in this browser per attempt. */
function loadSaved(id: string): QuizAnswers {
  try {
    const raw = window.localStorage.getItem(`quiz:${id}`);
    return raw ? (JSON.parse(raw) as QuizAnswers) : {};
  } catch {
    return {};
  }
}
function save(id: string, answers: QuizAnswers | null): void {
  try {
    if (answers) window.localStorage.setItem(`quiz:${id}`, JSON.stringify(answers));
    else window.localStorage.removeItem(`quiz:${id}`);
  } catch {
    // private mode or storage blocked: answers live in memory only
  }
}

function clock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

function Question({
  q,
  n,
  total,
  value,
  onChange,
  flagged,
  headingRef,
}: {
  q: QuizQuestionDto;
  n: number;
  total: number;
  value: string[];
  onChange: (v: string[]) => void;
  /** Shown after "Review and submit" when the question has no answer. */
  flagged: boolean;
  headingRef?: (el: HTMLElement | null) => void;
}) {
  const { locale, t } = useI18n();
  const multi = q.kind === 'MULTIPLE';
  const prompt = assessmentText(locale, q.promptEn, q.promptAr);
  const hintId = `q-${q.id}-hint`;
  const flagId = `q-${q.id}-flag`;
  return (
    <div id={`q-${q.id}`} className={`scroll-mt-40 rounded-xl border bg-card p-4 sm:p-5 ${flagged ? 'border-warning' : 'border-line'}`}>
      <fieldset aria-describedby={[hintId, flagged ? flagId : ''].filter(Boolean).join(' ')}>
      <legend ref={headingRef} tabIndex={-1} className="w-full rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan">
        <span className="flex flex-wrap items-center justify-between gap-2 text-[0.8125rem] text-muted">
          <span>{t('assessments.player.questionOf', { n, total })}</span>
          <span>{t('assessments.points', { count: q.weight })}</span>
        </span>
        <span dir={prompt.dir} className="mt-1 block text-[1.0625rem] leading-snug font-semibold whitespace-pre-line text-fg">
          {prompt.text}
        </span>
      </legend>
      <p id={hintId} className="mt-1 text-[0.8125rem] text-muted">
        {multi ? t('assessments.player.chooseAll') : t('assessments.player.chooseOne')}
      </p>
      <div className="mt-3 flex flex-col gap-2">
        {q.options.map((o, i) => {
          const checked = value.includes(o.id);
          const label = optionText(locale, t, q.kind, o, i);
          return (
            <label
              key={o.id}
              className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border px-3.5 py-2.5 text-[0.9375rem] has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-cyan ${
                checked ? 'border-primary bg-primary-soft text-fg' : 'border-line-strong bg-card hover:bg-hover-bg'
              }`}
            >
              <input
                type={multi ? 'checkbox' : 'radio'}
                name={`q-${q.id}`}
                value={o.id}
                checked={checked}
                onChange={(e) => {
                  if (!multi) onChange([o.id]);
                  else onChange(e.target.checked ? [...value, o.id] : value.filter((x) => x !== o.id));
                }}
                aria-invalid={flagged || undefined}
                className="size-5 shrink-0 accent-[var(--brand-primary)]"
              />
              <span dir={label.dir} className="whitespace-pre-line">
                {label.text}
              </span>
            </label>
          );
        })}
      </div>
      {flagged && (
        <p id={flagId} className="mt-2 text-sm font-medium text-warning">
          {t('assessments.player.unanswered')}
        </p>
      )}
      </fieldset>
    </div>
  );
}

/**
 * Takes one quiz attempt. Phones get one question per screen with Previous/Next;
 * wider screens get every question on one page. A progress bar counts answers, a
 * timer shows the server's deadline, and submitting asks for confirmation first
 * (except when time runs out, which submits by itself).
 */
export function QuizPlayer({
  slug,
  assessmentId,
  attempt,
  onSubmitted,
  onClosed,
}: {
  slug: string;
  assessmentId: string;
  attempt: QuizAttemptDto;
  onSubmitted: (r: QuizResultDto) => void;
  /** The server closed the attempt (time up): reload the page state. */
  onClosed: (message: string) => void;
}) {
  const { t } = useI18n();
  const questions = attempt.questions;
  const total = questions.length;
  const [answers, setAnswers] = useState<QuizAnswers>({});
  const [phone, setPhone] = useState(false);
  const [index, setIndex] = useState(0);
  const [reviewing, setReviewing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Server time minus this device's time: the countdown follows the server's clock.
  const [skew] = useState(() => new Date(attempt.serverNow).getTime() - Date.now());
  const [now, setNow] = useState(() => Date.now() + skew);
  const autoTried = useRef(false);
  const headings = useRef(new Map<string, HTMLElement>());
  const confirmHeading = useRef<HTMLHeadingElement>(null);
  const submitted = useRef(false);
  const moved = useRef(false);

  useEffect(() => setAnswers(loadSaved(attempt.submissionId)), [attempt.submissionId]);
  useEffect(() => {
    const mq = window.matchMedia(PHONE);
    const on = () => setPhone(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  const answered = questions.filter((q) => (answers[q.id] ?? []).length > 0).length;
  const unanswered = questions.filter((q) => !(answers[q.id] ?? []).length);
  const deadline = attempt.deadline ? new Date(attempt.deadline).getTime() : null;
  const remaining = deadline ? deadline - now : null;

  const set = (id: string, v: string[]) =>
    setAnswers((a) => {
      const next = { ...a, [id]: v };
      save(attempt.submissionId, next);
      return next;
    });

  const submit = useCallback(async () => {
    if (submitted.current) return;
    submitted.current = true;
    setBusy(true);
    setError(null);
    try {
      const r = await api<QuizResultDto>(`/learn/${slug}/assessments/${assessmentId}/submit`, { method: 'POST', json: { answers } });
      save(attempt.submissionId, null);
      onSubmitted(r);
    } catch (err) {
      submitted.current = false;
      const msg = assessmentError(err, t);
      const code = (err as { code?: string }).code;
      if (code === 'TIME_UP' || code === 'ALREADY_SUBMITTED' || code === 'NO_OPEN_ATTEMPT') {
        save(attempt.submissionId, null);
        onClosed(msg);
      } else {
        setError(msg);
      }
    } finally {
      setBusy(false);
    }
  }, [answers, assessmentId, attempt.submissionId, onClosed, onSubmitted, slug, t]);

  // The countdown, and an automatic submit when it reaches zero.
  useEffect(() => {
    if (!deadline) return;
    const id = setInterval(() => setNow(Date.now() + skew), 1000);
    return () => clearInterval(id);
  }, [deadline, skew]);
  // Once, when time is up; if that fails the student can still press Submit (within the grace period).
  useEffect(() => {
    if (remaining !== null && remaining <= 0 && !submitted.current && !autoTried.current) {
      autoTried.current = true;
      void submit();
    }
  }, [remaining, submit]);

  // One question per screen: move focus to the new question's text.
  useEffect(() => {
    if (!phone || confirming) return;
    if (!moved.current) return;
    headings.current.get(questions[index]?.id ?? '')?.focus();
  }, [index, phone, confirming, questions]);
  useEffect(() => {
    if (confirming) confirmHeading.current?.focus();
  }, [confirming]);

  function go(i: number) {
    moved.current = true;
    setConfirming(false);
    setIndex(Math.max(0, Math.min(total - 1, i)));
    if (!phone) {
      const q = questions[i];
      if (q) {
        document.getElementById(`q-${q.id}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
        headings.current.get(q.id)?.focus({ preventScroll: true });
      }
    }
  }

  function review() {
    setReviewing(true);
    setConfirming(true);
  }

  const lowTime = remaining !== null && remaining < 60_000;

  return (
    <div className="flex flex-col gap-4">
      <div className="sticky top-0 z-10 -mx-1 flex flex-col gap-2 border-b border-line bg-page/95 px-1 py-3 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="font-medium text-fg">{t('assessments.player.answered', { answered, total })}</span>
          {remaining !== null && (
            <span role="timer" aria-live="off" className={`rounded-md px-2.5 py-0.5 font-semibold tabular-nums ${lowTime ? 'bg-danger-soft text-danger' : 'bg-muted-bg text-fg'}`}>
              {t('assessments.player.timeLeft')}: <span dir="ltr">{clock(remaining)}</span>
            </span>
          )}
        </div>
        <div
          role="progressbar"
          aria-label={t('assessments.player.progressLabel')}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={answered}
          aria-valuetext={t('assessments.player.answered', { answered, total })}
          className="h-2 overflow-hidden rounded-full bg-track"
        >
          <div className="h-full rounded-full bg-logo-cyan transition-[width]" style={{ width: `${total ? (answered / total) * 100 : 0}%` }} />
        </div>
        {phone && (
          <ol className="flex flex-wrap gap-1.5" aria-label={t('assessments.player.progressLabel')}>
            {questions.map((q, i) => {
              const done = (answers[q.id] ?? []).length > 0;
              return (
                <li key={q.id}>
                  <button
                    type="button"
                    onClick={() => go(i)}
                    aria-label={t('assessments.player.jumpTo', { n: i + 1 })}
                    aria-current={!confirming && i === index ? 'step' : undefined}
                    className={`grid size-9 place-items-center rounded-full border text-sm font-medium ${
                      !confirming && i === index ? 'border-primary bg-primary text-white' : done ? 'border-primary bg-primary-soft text-primary' : 'border-line-strong bg-card text-muted'
                    }`}
                  >
                    {i + 1}
                  </button>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      {/* Screen readers hear the time at a few points, not every second. */}
      <p className="sr-only" aria-live="polite">
        {remaining !== null && remaining > 0 && [60_000, 30_000, 10_000].some((m) => remaining <= m && remaining > m - 5_000)
          ? t('assessments.player.secondsLeft', { seconds: Math.ceil(remaining / 1000 / 10) * 10 })
          : ''}
      </p>
      {remaining !== null && remaining <= 0 && <Alert tone="warning">{t('assessments.player.timeUp')}</Alert>}
      {error && <Alert tone="danger">{error}</Alert>}

      {confirming ? (
        <section role="alertdialog" aria-labelledby="quiz-confirm-title" aria-describedby="quiz-confirm-body" className="flex flex-col gap-4 rounded-xl border border-line bg-card p-5">
          <h2 id="quiz-confirm-title" ref={confirmHeading} tabIndex={-1} className="text-lg">
            {t('assessments.player.confirmTitle')}
          </h2>
          <div id="quiz-confirm-body" className="flex flex-col gap-2 text-[0.9375rem] text-body">
            <p>{t('assessments.player.confirmBody', { answered, total })}</p>
            {unanswered.length > 0 && <p className="font-medium text-warning">{t('assessments.player.confirmUnanswered', { count: unanswered.length })}</p>}
          </div>
          {unanswered.length > 0 && (
            <ul className="flex flex-wrap gap-2">
              {unanswered.map((q) => {
                const i = questions.indexOf(q);
                return (
                  <li key={q.id}>
                    <Button type="button" size="sm" variant="secondary" onClick={() => go(i)}>
                      {t('assessments.player.jumpTo', { n: i + 1 })}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => void submit()} loading={busy}>
              {busy ? t('assessments.player.submitting') : t('assessments.player.confirmYes')}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setConfirming(false)} disabled={busy}>
              {t('assessments.player.confirmNo')}
            </Button>
          </div>
        </section>
      ) : phone ? (
        <>
          {questions[index] && (
            <Question
              q={questions[index]}
              n={index + 1}
              total={total}
              value={answers[questions[index].id] ?? []}
              onChange={(v) => set(questions[index]!.id, v)}
              flagged={reviewing && !(answers[questions[index].id] ?? []).length}
              headingRef={(el) => {
                if (el) headings.current.set(questions[index]!.id, el);
              }}
            />
          )}
          <div className="flex items-center justify-between gap-2">
            <Button type="button" variant="secondary" onClick={() => go(index - 1)} disabled={index === 0}>
              <span aria-hidden className="inline-block rtl:rotate-180">←</span> {t('assessments.player.prev')}
            </Button>
            {index < total - 1 ? (
              <Button type="button" onClick={() => go(index + 1)}>
                {t('assessments.player.next')} <span aria-hidden className="inline-block rtl:rotate-180">→</span>
              </Button>
            ) : (
              <Button type="button" onClick={review}>
                {t('assessments.player.review')}
              </Button>
            )}
          </div>
        </>
      ) : (
        <>
          <ol className="flex flex-col gap-4">
            {questions.map((q, i) => (
              <li key={q.id}>
                <Question
                  q={q}
                  n={i + 1}
                  total={total}
                  value={answers[q.id] ?? []}
                  onChange={(v) => set(q.id, v)}
                  flagged={reviewing && !(answers[q.id] ?? []).length}
                  headingRef={(el) => {
                    if (el) headings.current.set(q.id, el);
                  }}
                />
              </li>
            ))}
          </ol>
          <div>
            <Button type="button" size="lg" onClick={review}>
              {t('assessments.player.review')}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

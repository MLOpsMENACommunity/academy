'use client';

import {
  buildAnswersSchema,
  pickSourceParams,
  type CourseDetailDto,
  type MeResponse,
  type MyApplicationDetailDto,
  type MyCourseStatusDto,
  type ProfileDto,
  type ScreeningQuestionDto,
} from '@academy/shared';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { RequireAuth } from '@/components/auth/RequireAuth';
import { ChipGroup, RadioGroup, TextAreaField, TextField } from '@/components/forms/fields';
import { Alert } from '@/components/ui/Alert';
import { Button, buttonClass } from '@/components/ui/Button';
import { Container } from '@/components/ui/Container';
import { PageSpinner } from '@/components/ui/Spinner';
import { useI18n } from '@/i18n/client';
import { api, ApiError } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { issuesToErrors } from '@/lib/zod-errors';

/** Moves keyboard and screen-reader focus to the first field marked invalid. */
export function focusFirstInvalid(): void {
  requestAnimationFrame(() => {
    const el = document.querySelector<HTMLElement>('[aria-invalid="true"], fieldset[data-invalid="true"] input');
    el?.focus();
  });
}

export function ApplyForm() {
  return <RequireAuth>{(user) => <Inner user={user} />}</RequireAuth>;
}

type Answers = Record<string, unknown>;

function Inner({ user }: { user: MeResponse }) {
  const { locale, t } = useI18n();
  const router = useRouter();
  const { slug } = useParams<{ slug: string }>();
  const search = useSearchParams();
  const [course, setCourse] = useState<CourseDetailDto | null>(null);
  const [status, setStatus] = useState<MyCourseStatusDto | null>(null);
  const [profile, setProfile] = useState<ProfileDto | null>(null);
  const [answers, setAnswers] = useState<Answers>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState(false);
  /** Changes on every failed submit so the error banner is announced again. */
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    Promise.all([
      api<CourseDetailDto>(`/courses/${slug}`),
      api<MyCourseStatusDto>(`/courses/${slug}/my-status`),
      api<ProfileDto>('/me/profile'),
    ])
      .then(([c, s, p]) => {
        setCourse(c);
        setStatus(s);
        setProfile(p);
      })
      .catch(() => setLoadError(true));
  }, [slug]);

  const schema = useMemo(() => (course ? buildAnswersSchema(course.screeningQuestions) : null), [course]);
  const here = `/${locale}/courses/${slug}/apply${search.toString() ? `?${search}` : ''}`;
  const label = (q: ScreeningQuestionDto) => (locale === 'ar' ? q.labelAr : q.labelEn);
  const help = (q: ScreeningQuestionDto) => (locale === 'ar' ? q.helpAr : q.helpEn) ?? undefined;
  const set = (id: string) => (v: unknown) => setAnswers((a) => ({ ...a, [id]: v }));

  if (loadError) {
    return (
      <Container className="max-w-2xl py-12">
        <Alert tone="danger">{t('errors.generic')}</Alert>
      </Container>
    );
  }
  if (!course || !status || !profile || !schema) return <PageSpinner />;

  const title = locale === 'ar' ? course.titleAr : course.titleEn;
  const shell = (body: React.ReactNode) => (
    <Container className="max-w-2xl py-10">
      <Link href={`/${locale}/courses/${slug}`} className="text-sm text-primary hover:underline">
        <span aria-hidden className="inline-block rtl:rotate-180">←</span> {title}
      </Link>
      <h1 className="mt-2 text-3xl">{t('apply.title', { course: title })}</h1>
      <div className="mt-6">{body}</div>
    </Container>
  );

  if (status.applicationId) {
    return shell(
      <Alert tone="info" title={t('apply.already')}>
        <Link href={`/${locale}/dashboard/applications/${status.applicationId}`} className="font-semibold underline">
          {t('apply.viewApplication')}
        </Link>
      </Alert>,
    );
  }
  if (course.availability !== 'OPEN') return shell(<Alert tone="warning">{t('apply.closed')}</Alert>);
  if (!user.emailVerified) return shell(<Alert tone="warning">{t('apply.verifyFirst', { email: user.email })}</Alert>);
  if (!profile.coreComplete) {
    return shell(
      <Alert tone="warning" title={t('apply.profileFirst')}>
        <Link href={`/${locale}/onboarding?returnTo=${encodeURIComponent(here)}`} className={buttonClass('accent', 'md', 'mt-3')}>
          {t('apply.completeProfile')}
        </Link>
      </Alert>,
    );
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    const parsed = schema!.safeParse(answers);
    if (!parsed.success) {
      setErrors(issuesToErrors(parsed.error.issues, t));
      setFormError(t('forms.fixErrors'));
      setAttempt((n) => n + 1);
      focusFirstInvalid();
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const source = pickSourceParams(Object.fromEntries(search.entries()));
      const app = await api<MyApplicationDetailDto>('/applications', {
        method: 'POST',
        json: { courseSlug: slug, answers: parsed.data, source },
      });
      router.replace(`/${locale}/dashboard/applications/${app.id}`);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.errors.length) {
          setErrors(Object.fromEntries(err.errors.map((x) => [x.path.replace(/^answers\./, ''), x.message])));
        }
        const known = err.code ? t(`apply.errors.${err.code}`) : '';
        setFormError(known && known !== `apply.errors.${err.code}` ? known : errorMessage(err, t));
      } else setFormError(errorMessage(err, t));
      setBusy(false);
    }
  }

  return shell(
    <>
      <p className="text-muted">{t('apply.intro')}</p>
      <Alert tone="info" className="mt-4">
        {t('apply.profileNote')}{' '}
        <Link href={`/${locale}/profile`} className="font-semibold underline">
          {t('apply.reviewProfile')}
        </Link>
        {course.recordingsPlatform === 'GOOGLE_DRIVE' && profile.googleEmail && (
          <p className="mt-1">{t('apply.googleNote', { email: profile.googleEmail })}</p>
        )}
      </Alert>
      <form onSubmit={onSubmit} noValidate className="mt-6 space-y-6 rounded-card border border-line bg-card p-5 sm:p-8">
        {formError && (
          <Alert key={attempt} tone="danger">
            {formError}
          </Alert>
        )}
        {course.screeningQuestions.map((q) => {
          const v = answers[q.id];
          const common = { label: label(q), hint: help(q), error: errors[q.id], required: q.required };
          const options = (q.options ?? []).map((o) => ({ value: o.value, label: locale === 'ar' ? o.labelAr : o.labelEn }));
          switch (q.type) {
            case 'SHORT_TEXT':
              return <TextField key={q.id} {...common} value={(v as string) ?? ''} onChange={set(q.id)} maxLength={300} />;
            case 'LONG_TEXT':
              return <TextAreaField key={q.id} {...common} value={(v as string) ?? ''} onChange={set(q.id)} maxLength={4000} rows={5} />;
            case 'NUMBER':
              return (
                <TextField key={q.id} {...common} type="number" inputMode="numeric" value={v === undefined ? '' : String(v)} onChange={(x) => set(q.id)(x === '' ? undefined : x)} />
              );
            case 'YES_NO':
              return (
                <RadioGroup
                  key={q.id}
                  legend={common.label}
                  hint={common.hint}
                  error={common.error}
                  required={q.required}
                  value={v === undefined ? null : v ? 'yes' : 'no'}
                  onChange={(x) => set(q.id)(x === 'yes')}
                  options={[
                    { value: 'yes', label: t('apply.yes') },
                    { value: 'no', label: t('apply.no') },
                  ]}
                />
              );
            case 'SINGLE_SELECT':
              return (
                <RadioGroup key={q.id} legend={common.label} hint={common.hint} error={common.error} required={q.required} value={(v as string) ?? null} onChange={set(q.id)} options={options} />
              );
            case 'MULTI_SELECT':
              return (
                <ChipGroup key={q.id} legend={common.label} hint={common.hint} error={common.error} required={q.required} value={(v as string[]) ?? []} onChange={set(q.id)} options={options} />
              );
          }
        })}
        <div className="border-t border-line pt-5">
          <Button type="submit" size="lg" variant="accent" loading={busy}>
            {course.type === 'FREE' && !course.requiresApproval ? t('apply.enrollSubmit') : t('apply.submit')}
          </Button>
        </div>
      </form>
    </>,
  );
}

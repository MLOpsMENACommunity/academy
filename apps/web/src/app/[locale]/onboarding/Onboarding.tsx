'use client';

import { CORE_FIELD_SECTION, computeCompleteness, isRequiredSection, PROFILE_SECTIONS, REQUIRED_SECTIONS, type ProfileDto, type ProfileSection } from '@academy/shared';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { RequireAuth } from '@/components/auth/RequireAuth';
import { SpeakerRedirect } from '@/components/auth/SpeakerRedirect';
import { SectionForm } from '@/components/profile/SectionForm';
import { Alert } from '@/components/ui/Alert';
import { Button, buttonClass } from '@/components/ui/Button';
import { Container } from '@/components/ui/Container';
import { Progress } from '@/components/ui/Progress';
import { PageSpinner } from '@/components/ui/Spinner';
import { useI18n } from '@/i18n/client';
import { api } from '@/lib/api';
import { courseSlugFromPath, trackFunnel } from '@/lib/funnel';
import { useReturnTo } from '@/lib/use-return-to';

const STEPS: ProfileSection[] = [...PROFILE_SECTIONS];

export function Onboarding() {
  // Speakers skip student onboarding.
  return <RequireAuth>{(user) => (user.role === 'SPEAKER' ? <SpeakerRedirect /> : <Stepper />)}</RequireAuth>;
}

function Stepper() {
  const { locale, t } = useI18n();
  const { reload } = useAuth();
  const returnTo = useReturnTo();
  const [profile, setProfile] = useState<ProfileDto | null>(null);
  const [step, setStep] = useState(0);
  const [done, setDone] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const courseSlug = courseSlugFromPath(returnTo);

  const [loadError, setLoadError] = useState(false);
  useEffect(() => {
    api<ProfileDto>('/me/profile')
      .then((p) => {
        setProfile(p);
        // Start at the first required step that still has gaps; if none, at the first optional step.
        const missing = computeCompleteness(p).missingCore.map((f) => CORE_FIELD_SECTION[f]);
        const first = STEPS.findIndex((s) => missing.includes(s as (typeof REQUIRED_SECTIONS)[number]));
        setStep(first >= 0 ? first : REQUIRED_SECTIONS.length);
      })
      .catch(() => setLoadError(true));
  }, []);

  // Move focus to the new step's heading so screen-reader users hear the change.
  useEffect(() => {
    heading.current?.focus();
  }, [step, done]);

  if (loadError) {
    return (
      <Container className="py-12">
        <Alert tone="danger">{t('errors.generic')}</Alert>
      </Container>
    );
  }
  if (!profile) return <PageSpinner />;
  const section = STEPS[step]!;
  const next = () => (step + 1 < STEPS.length ? setStep(step + 1) : setDone(true));

  if (done) {
    return (
      <Container className="max-w-2xl py-12">
        <h1 ref={heading} tabIndex={-1} className="text-3xl outline-none">
          {t('onboarding.doneTitle')}
        </h1>
        <p className="mt-3 text-muted">{t('onboarding.doneBody')}</p>
        <div className="mt-6 flex flex-wrap gap-3">
          {courseSlug ? (
            <Link href={returnTo} className={buttonClass('accent', 'lg')}>
              {t('onboarding.backToCourse')}
            </Link>
          ) : returnTo !== `/${locale}/dashboard` ? (
            <Link href={returnTo} className={buttonClass('accent', 'lg')}>
              {t('onboarding.continue')}
            </Link>
          ) : (
            <Link href={`/${locale}/courses`} className={buttonClass('accent', 'lg')}>
              {t('onboarding.toCourses')}
            </Link>
          )}
          <Link href={`/${locale}/dashboard`} className={buttonClass('secondary', 'lg')}>
            {t('nav.dashboard')}
          </Link>
        </div>
      </Container>
    );
  }

  return (
    <Container className="max-w-3xl py-10">
      <p className="text-sm font-semibold text-primary">{t('onboarding.step', { current: step + 1, total: STEPS.length })}</p>
      <h1 ref={heading} tabIndex={-1} className="mt-1 text-3xl outline-none">
        {t('onboarding.title')}
      </h1>
      <p className="mt-2 text-muted">{t('onboarding.subtitle')}</p>
      <div className="mt-6">
        <Progress value={profile.completeness} label={t('profile.completeness', { percent: profile.completeness })} />
      </div>

      <ol className="mt-6 flex gap-1.5" aria-label={t('onboarding.title')}>
        {STEPS.map((s, i) => (
          <li
            key={s}
            className={`h-1.5 flex-1 rounded-full ${i < step ? 'bg-primary' : i === step ? 'bg-ink' : 'bg-line'}`}
            aria-current={i === step ? 'step' : undefined}
          >
            <span className="sr-only">
              {t(`profile.sections.${s}`)}
              {!isRequiredSection(s) && ` (${t('common.optional')})`}
            </span>
          </li>
        ))}
      </ol>

      <section className="mt-8 rounded-card border border-line bg-card p-5 sm:p-8">
        <div className="mb-6 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-xl">
            {t(`profile.sections.${section}`)}
            {!isRequiredSection(section) && (
              <>
                {' '}
                <span className="text-base font-normal text-muted">({t('common.optional')})</span>
              </>
            )}
          </h2>
          {isRequiredSection(section) && <span className="text-xs font-semibold text-danger">{t('onboarding.requiredStep')}</span>}
        </div>
        <p className="-mt-4 mb-6 text-sm text-muted">{t(`profile.sectionHints.${section}`)}</p>
        {isRequiredSection(section) && returnTo && courseSlug && !profile.coreComplete && (
          <Alert tone="info" className="mb-6">
            {t('profile.coreMissing')}
          </Alert>
        )}
        <SectionForm
          key={section}
          section={section}
          profile={profile}
          submitLabel={step + 1 < STEPS.length ? t('onboarding.saveContinue') : t('onboarding.finish')}
          onSaved={(p) => {
            const firstCompletion = !profile.coreComplete && p.coreComplete;
            setProfile(p);
            if (firstCompletion) {
              void reload();
              if (courseSlug) trackFunnel(courseSlug, 'PROFILE_COMPLETED');
            }
            next();
          }}
          onProfileChange={setProfile}
          secondary={
            <>
              {step > 0 && (
                <Button type="button" variant="ghost" onClick={() => setStep(step - 1)}>
                  {t('common.back')}
                </Button>
              )}
              {/* Required steps can't be skipped; the optional ones can. */}
              {!isRequiredSection(section) && (
                <Button type="button" variant="ghost" onClick={next}>
                  {t('onboarding.skip')}
                </Button>
              )}
            </>
          }
        />
      </section>
    </Container>
  );
}

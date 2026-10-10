'use client';

import { describeRule, type LearnCertificateDto } from '@academy/shared';
import type { ReactNode } from 'react';
import { IconCheck } from '@/components/ui/Icons';
import { useI18n } from '@/i18n/client';
import { formatDate } from '@/lib/format';
import { pick } from '@/lib/sessions';
import { CertificateActions } from './CertificateActions';

/** "Your certificate is ready": shown at the top of the course once it's issued. */
export function CertificateBanner({ data }: { data: LearnCertificateDto | null }) {
  const { locale, t } = useI18n();
  const c = data?.certificate;
  if (!c || c.status !== 'VALID') return null;
  return (
    <section aria-labelledby="cert-banner" className="flex flex-col gap-3 rounded-xl border border-success/25 bg-success-soft p-5 sm:p-6">
      <h2 id="cert-banner" className="text-lg text-success sm:text-xl">
        {t('certificates.banner.title')}
      </h2>
      <p className="text-body">
        {t('certificates.banner.body', { course: pick(locale, c.courseTitleEn, c.courseTitleAr) })}{' '}
        <span className="text-sm text-muted">
          {t('certificates.issuedOn', { date: formatDate(c.issuedAt, locale) })} · <span dir="ltr">{c.serial}</span>
        </span>
      </p>
      <CertificateActions cert={c} compact />
    </section>
  );
}

function Check({ ok, children }: { ok: boolean; children: ReactNode }) {
  const { t } = useI18n();
  return (
    <li className="flex items-start gap-3">
      {ok ? (
        <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-logo-green text-white">
          <IconCheck size={12} strokeWidth={3.2} />
          <span className="sr-only">{t('certificates.earn.met')}</span>
        </span>
      ) : (
        <span className="mt-0.5 size-5 shrink-0 rounded-full border-2 border-line-button bg-card">
          <span className="sr-only">{t('certificates.earn.notYet')}</span>
        </span>
      )}
      <span className="min-w-0">{children}</span>
    </li>
  );
}

/** "How to earn the certificate": the course rule and the student's live status against it. */
export function CertificateRuleCard({ data, progress }: { data: LearnCertificateDto | null; progress: { completed: number; total: number; percent: number } }) {
  const { locale, t } = useI18n();
  if (!data?.offered) return null;
  const c = data.certificate;
  if (c?.status === 'VALID') return null;
  // Sessions follow the page's own progress (ticking a session updates it at once).
  const min = data.rule.minSessionsPercent;
  const sessionsOk = min === null || (progress.total > 0 && progress.percent >= min);
  const e = { ...data.eligibility, sessions: { ...progress, required: min, ok: sessionsOk }, eligible: sessionsOk && data.eligibility.assessments.ok };
  return (
    <section aria-labelledby="cert-rule" className="flex flex-col gap-4 rounded-xl border border-line bg-card p-5 sm:p-6">
      <h2 id="cert-rule" className="text-lg sm:text-xl">
        {t('certificates.earn.title')}
      </h2>
      <p className="text-body">{describeRule(data.rule, locale)}</p>
      {c?.status === 'REVOKED' ? (
        <p className="text-sm text-danger">{t('certificates.revokedNote')}</p>
      ) : (
        <>
          <ul className="flex flex-col gap-2.5 text-[0.9375rem]">
            {data.rule.minSessionsPercent !== null && (
              <Check ok={e.sessions.ok}>
                {t('certificates.earn.sessions', { completed: e.sessions.completed, total: e.sessions.total, percent: e.sessions.percent, required: data.rule.minSessionsPercent })}
              </Check>
            )}
            {data.rule.requireAssessments && e.assessments.required > 0 && (
              <Check ok={e.assessments.ok}>
                {t('certificates.earn.assessments', { passed: e.assessments.passed, required: e.assessments.required })}
                {e.assessments.pending > 0 && <span className="block text-sm text-muted">{t('certificates.earn.pending', { count: e.assessments.pending })}</span>}
              </Check>
            )}
            {e.capstone && <Check ok={e.capstone === 'PASSED'}>{t(`certificates.earn.capstone.${e.capstone}`)}</Check>}
          </ul>
          {e.averagePercent !== null && <p className="text-sm text-muted">{t('certificates.earn.average', { percent: e.averagePercent })}</p>}
          <p className={`text-sm font-medium ${e.eligible ? 'text-success' : 'text-muted'}`}>{t(e.eligible ? 'certificates.earn.eligible' : 'certificates.earn.keepGoing')}</p>
        </>
      )}
    </section>
  );
}

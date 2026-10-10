'use client';

import {
  countryName,
  courseLanguageLabels,
  speakerAreaLabels,
  speakerFormatLabels,
  speakerReviewSchema,
  type AdminSpeakerApplicationDto,
} from '@academy/shared';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { SpeakersTabs } from '@/components/admin/SpeakersTabs';
import { SelectField, TextAreaField } from '@/components/forms/fields';
import { monthLabel, SPEAKER_APP_TONE, speakerError } from '@/components/speakers/shared';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { PageSpinner } from '@/components/ui/Spinner';
import { useI18n } from '@/i18n/client';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { issuesToErrors } from '@/lib/zod-errors';
import type { AdminSpeaker } from '../../types';

export default function AdminSpeakerApplication() {
  const { locale, t } = useI18n();
  const { id } = useParams<{ id: string }>();
  const [a, setA] = useState<AdminSpeakerApplicationDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<AdminSpeaker[]>([]);
  const [note, setNote] = useState('');
  const [instructorId, setInstructorId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const load = useCallback(() => {
    api<AdminSpeakerApplicationDto>(`/admin/speaker-applications/${id}`)
      .then(setA)
      .catch((err) => setError(speakerError(err, t)));
  }, [id, t]);
  useEffect(load, [load]);
  useEffect(() => {
    api<AdminSpeaker[]>('/admin/instructors').then(setProfiles).catch(() => setProfiles([]));
  }, []);

  async function review(decision: 'APPROVE' | 'REJECT') {
    const parsed = speakerReviewSchema.safeParse({ decision, note, instructorId });
    if (!parsed.success) {
      setErrors(issuesToErrors(parsed.error.issues, t));
      return;
    }
    setErrors({});
    setError(null);
    setBusy(decision);
    try {
      setA(await api<AdminSpeakerApplicationDto>(`/admin/speaker-applications/${id}/review`, { method: 'POST', json: parsed.data }));
      setDone(decision === 'APPROVE' ? t('admin.speakerApps.approvedDone') : t('admin.speakerApps.rejectedDone'));
    } catch (err) {
      setError(speakerError(err, t));
    } finally {
      setBusy(null);
    }
  }

  async function switchRole(role: 'STUDENT' | 'SPEAKER') {
    if (!a || !window.confirm(t(role === 'STUDENT' ? 'admin.speakerApps.toStudentConfirm' : 'admin.speakerApps.toSpeakerConfirm'))) return;
    setBusy('role');
    setError(null);
    try {
      await api(`/admin/users/${a.userId}/role`, { method: 'PUT', json: { role } });
      load();
    } catch (err) {
      setError(speakerError(err, t));
    } finally {
      setBusy(null);
    }
  }

  if (!a) return error ? <Alert tone="danger">{error}</Alert> : <PageSpinner />;
  const row = (label: string, value: ReactNode) => (
    <div className="grid gap-1 py-2 sm:grid-cols-[12rem_1fr]">
      <dt className="text-sm font-semibold text-muted">{label}</dt>
      <dd className="min-w-0 break-words text-fg">{value}</dd>
    </div>
  );
  const f = (k: string) => t(`speakers.portal.form.${k}`);

  return (
    <div className="space-y-5">
      <SpeakersTabs />
      <Link href={`/${locale}/admin/speakers/applications`} className="inline-flex min-h-11 items-center text-sm text-muted hover:underline">
        <span aria-hidden className="inline-block rtl:rotate-180">←</span>&nbsp;{t('admin.speakerApps.title')}
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-3xl break-words">{a.fullName}</h1>
        <Badge tone={SPEAKER_APP_TONE[a.status]}>{t(`speakers.portal.status.${a.status}`)}</Badge>
        {a.userRole !== 'SPEAKER' && <Badge tone="info">{t('admin.speakerApps.studentAccount')}</Badge>}
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
      {done && <Alert tone="success">{done}</Alert>}
      <div className="grid gap-5 lg:grid-cols-[1fr_22rem]">
        <Card>
          <dl className="divide-y divide-line">
            {row(f('email'), <span className="ltr-embed">{a.email}</span>)}
            {row(f('phone'), <a href={`https://wa.me/${a.phone.replace(/\D/g, '')}`} className="ltr-embed text-primary underline" target="_blank" rel="noopener noreferrer">{a.phone}</a>)}
            {row(f('linkedinUrl'), <a href={a.linkedinUrl} className="text-primary underline" target="_blank" rel="noopener noreferrer">{a.linkedinUrl}</a>)}
            {row(f('title'), `${a.title}${a.company ? ` · ${a.company}` : ''}`)}
            {row(f('country'), countryName(a.country, locale))}
            {a.photoUrl && row(f('photoUrl'), <a href={a.photoUrl} className="text-primary underline" target="_blank" rel="noopener noreferrer">{a.photoUrl}</a>)}
            {row(f('bio'), <span className="whitespace-pre-line">{a.bio}</span>)}
            {row(f('areas'), a.areas.map((x) => speakerAreaLabels[x][locale]).join(' · '))}
            {row(f('sessionTitle'), a.sessionTitle)}
            {row(f('abstract'), <span className="whitespace-pre-line">{a.abstract}</span>)}
            {row(f('format'), speakerFormatLabels[a.format][locale])}
            {row(f('language'), courseLanguageLabels[a.language][locale])}
            {row(f('preferredMonths'), a.preferredMonths.map((m) => monthLabel(m, locale)).join(' · '))}
            {row(t('admin.speakerApps.submitted'), `${formatDateTime(a.submittedAt, locale)}${a.submissions > 1 ? ` (${t('admin.speakerApps.resubmitted', { n: a.submissions })})` : ''}`)}
            {a.reviewedAt && row(t('admin.speakerApps.reviewed'), `${formatDateTime(a.reviewedAt, locale)}${a.reviewedBy ? ` · ${a.reviewedBy}` : ''}`)}
            {a.reviewNote && row(t('admin.speakerApps.note'), a.reviewNote)}
          </dl>
        </Card>
        <div className="space-y-5">
          {a.status === 'SUBMITTED' && (
            <Card>
              <h2 className="text-lg">{t('admin.speakerApps.decide')}</h2>
              <div className="mt-3 space-y-4">
                <SelectField
                  label={t('admin.speakerApps.linkProfile')}
                  hint={t('admin.speakerApps.linkProfileHint')}
                  value={instructorId}
                  onChange={setInstructorId}
                  placeholder={t('admin.speakerApps.createProfile')}
                  options={profiles.map((p) => ({ value: p.id, label: p.name }))}
                />
                <Button className="w-full" loading={busy === 'APPROVE'} disabled={Boolean(busy) || a.userRole !== 'SPEAKER'} onClick={() => review('APPROVE')}>
                  {t('admin.speakerApps.approve')}
                </Button>
                <hr className="border-line" />
                <TextAreaField label={t('admin.speakerApps.note')} hint={t('admin.speakerApps.noteHint')} rows={3} maxLength={1000} value={note} onChange={setNote} error={errors.note} />
                <Button variant="danger" className="w-full" loading={busy === 'REJECT'} disabled={Boolean(busy)} onClick={() => review('REJECT')}>
                  {t('admin.speakerApps.reject')}
                </Button>
              </div>
            </Card>
          )}
          {a.instructor && (
            <Card>
              <h2 className="text-lg">{t('admin.speakerApps.profile')}</h2>
              <p className="mt-2">
                <Link href={`/${locale}/admin/speakers/${a.instructor.id}`} className="font-medium text-primary underline">
                  {a.instructor.name}
                </Link>
              </p>
              <p className="mt-1 text-sm text-muted">{t('admin.speakerApps.profileHint')}</p>
            </Card>
          )}
          <Card>
            <h2 className="text-lg">{t('admin.speakerApps.account')}</h2>
            <p className="mt-2 text-sm text-muted">{t('admin.speakerApps.accountHint')}</p>
            {a.userRole === 'SPEAKER' ? (
              <Button variant="secondary" className="mt-3" loading={busy === 'role'} onClick={() => switchRole('STUDENT')}>
                {t('admin.speakerApps.toStudent')}
              </Button>
            ) : a.userRole === 'STUDENT' ? (
              <Button variant="secondary" className="mt-3" loading={busy === 'role'} onClick={() => switchRole('SPEAKER')}>
                {t('admin.speakerApps.toSpeaker')}
              </Button>
            ) : null}
          </Card>
        </div>
      </div>
    </div>
  );
}

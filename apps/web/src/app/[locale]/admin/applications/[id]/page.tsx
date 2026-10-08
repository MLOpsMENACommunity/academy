'use client';

import {
  applicationStatusLabels,
  paymentStatusLabels,
  type AdminApplicationEvent,
  type AdminPaymentDto,
  type AnswerValue,
  type ApplicationStatus,
  type ProfileDto,
  type QuestionOption,
} from '@academy/shared';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Notes, type Note } from '@/components/admin/Notes';
import { ProfileView } from '@/components/admin/ProfileView';
import { StatusBadge } from '@/components/applications/StatusBadge';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { PageSpinner } from '@/components/ui/Spinner';
import { useI18n } from '@/i18n/client';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { formatDateTime, formatMoney } from '@/lib/format';

interface Detail {
  id: string;
  status: ApplicationStatus;
  createdAt: string;
  source: Record<string, string>;
  course: { id: string; slug: string; titleEn: string; titleAr: string };
  questions: { id: string; labelEn: string; labelAr: string; options: QuestionOption[] | null }[];
  answers: Record<string, AnswerValue>;
  profileSnapshot: ProfileDto;
  currentProfile: ProfileDto;
  student: { id: string; email: string; emailVerified: boolean; deleted: boolean };
  history: { fromStatus: ApplicationStatus | null; toStatus: ApplicationStatus; reason: string | null; actor: string | null; createdAt: string }[];
  notes: Note[];
  payments: AdminPaymentDto[];
  availableEvents: AdminApplicationEvent[];
}

export default function ApplicationDetailAdmin() {
  const { locale, t } = useI18n();
  const { id } = useParams<{ id: string }>();
  const [a, setA] = useState<Detail | null>(null);
  const [tab, setTab] = useState<'snapshot' | 'current'>('snapshot');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    api<Detail>(`/admin/applications/${id}`).then(setA).catch((e: unknown) => setError(errorMessage(e, t)));
  }, [id, t]);
  useEffect(load, [load]);

  async function act(event: AdminApplicationEvent) {
    setBusy(event);
    setError(null);
    try {
      await api(`/admin/applications/${id}/transition`, { method: 'POST', json: { event, reason: event === 'REJECT' ? reason || undefined : undefined } });
      setReason('');
      load();
    } catch (e) {
      setError(errorMessage(e, t));
    } finally {
      setBusy(null);
    }
  }

  if (!a) return error ? <Alert tone="danger">{error}</Alert> : <PageSpinner />;
  const answer = (q: Detail['questions'][number]) => {
    const v = a.answers[q.id];
    if (v === undefined || v === '') return '—';
    if (typeof v === 'boolean') return v ? t('admin.common.yes') : t('admin.common.no');
    const lbl = (x: string) => {
      const o = q.options?.find((o) => o.value === x);
      return o ? (locale === 'ar' ? o.labelAr : o.labelEn) : x;
    };
    return Array.isArray(v) ? v.map(lbl).join(', ') : lbl(String(v));
  };

  return (
    <div className="space-y-5">
      <Link href={`/${locale}/admin/applications`} className="text-sm text-primary hover:underline">
        <span aria-hidden className="inline-block rtl:rotate-180">←</span> {t('admin.apps.title')}
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl">{a.currentProfile.fullNameEn ?? a.student.email}</h1>
          <p className="text-sm text-muted">
            <span className="ltr-embed">{a.student.email}</span> · {locale === 'ar' ? a.course.titleAr : a.course.titleEn} · {formatDateTime(a.createdAt, locale)}
          </p>
          <Link href={`/${locale}/admin/students/${a.student.id}`} className="text-sm text-primary underline">
            {t('admin.students.profile')}
          </Link>
        </div>
        <StatusBadge status={a.status} locale={locale} />
      </div>

      {a.availableEvents.length > 0 && (
        <Card>
          <div className="flex flex-wrap items-end gap-2">
            {a.availableEvents.map((ev) => (
              <Button key={ev} size="sm" variant={ev === 'REJECT' ? 'danger' : ev === 'ACCEPT' ? 'accent' : 'secondary'} loading={busy === ev} onClick={() => act(ev)}>
                {t(`admin.apps.events.${ev}`)}
              </Button>
            ))}
          </div>
          {a.availableEvents.includes('REJECT') && (
            <label className="mt-4 block">
              <span className="mb-1 block text-xs font-semibold text-fg">{t('admin.apps.reason')}</span>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={1000}
                rows={3}
                placeholder={t('admin.apps.reasonPlaceholder')}
                className="block w-full rounded-lg border border-line-strong bg-card px-3 py-2 text-sm"
              />
            </label>
          )}
          {error && <Alert tone="danger" className="mt-3">{error}</Alert>}
        </Card>
      )}

      <div className="grid gap-5 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-5">
          <Card>
            <h2 className="text-lg">{t('admin.apps.answers')}</h2>
            <dl className="mt-3 divide-y divide-line">
              {a.questions.map((q) => (
                <div key={q.id} className="py-2">
                  <dt className="text-sm font-semibold text-fg">{locale === 'ar' ? q.labelAr : q.labelEn}</dt>
                  <dd className="mt-1 text-sm whitespace-pre-line">{answer(q)}</dd>
                </div>
              ))}
            </dl>
          </Card>
          <Card>
            <div
              role="tablist"
              aria-label={t('admin.apps.snapshot')}
              className="flex gap-2"
              onKeyDown={(e) => {
                if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
                const next = tab === 'snapshot' ? 'current' : 'snapshot';
                setTab(next);
                document.getElementById(`profile-tab-${next}`)?.focus();
              }}
            >
              {(['snapshot', 'current'] as const).map((k) => (
                <button
                  key={k}
                  id={`profile-tab-${k}`}
                  type="button"
                  role="tab"
                  aria-selected={tab === k}
                  aria-controls="profile-panel"
                  tabIndex={tab === k ? 0 : -1}
                  onClick={() => setTab(k)}
                  className={`min-h-9 rounded-lg px-3 text-sm font-semibold ${tab === k ? 'bg-ink text-white' : 'bg-muted-bg'}`}>
                  {t(`admin.apps.${k}`)}
                </button>
              ))}
            </div>
            <div role="tabpanel" id="profile-panel" aria-labelledby={`profile-tab-${tab}`} className="mt-4">
              <ProfileView profile={tab === 'snapshot' ? a.profileSnapshot : a.currentProfile} />
            </div>
          </Card>
        </div>
        <div className="space-y-5">
          <Card>
            <h2 className="text-lg">{t('admin.apps.history')}</h2>
            <ol className="mt-3 space-y-2 text-sm">
              {a.history.map((h, i) => (
                <li key={i}>
                  <span className="font-semibold text-fg">{applicationStatusLabels[h.toStatus][locale]}</span>
                  <span className="block text-xs text-muted">
                    {formatDateTime(h.createdAt, locale)} · {h.actor ?? '—'}
                  </span>
                  {h.reason && <span className="block text-xs">{h.reason}</span>}
                </li>
              ))}
            </ol>
            {Object.keys(a.source ?? {}).length > 0 && (
              <p className="mt-3 text-xs text-muted">
                {t('admin.apps.source')}: {Object.entries(a.source).map(([k, v]) => `${k}=${v}`).join(' · ')}
              </p>
            )}
          </Card>
          {a.payments.length > 0 && (
            <Card>
              <h2 className="text-lg">{t('admin.apps.payments')}</h2>
              <ul className="mt-2 space-y-2 text-sm">
                {a.payments.map((p) => (
                  <li key={p.id}>
                    <Link href={`/${locale}/admin/payments/${p.id}`} className="text-primary underline">
                      {formatMoney(p.amount, p.currency, locale)} · {paymentStatusLabels[p.status][locale]}
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <Card>
            <h2 className="text-lg">{t('admin.common.notes')}</h2>
            <div className="mt-3">
              <Notes notes={a.notes} postUrl={`/admin/applications/${a.id}/notes`} />
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

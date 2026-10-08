'use client';

import type { ApplicationStatus, ProfileDto } from '@academy/shared';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
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
import { formatDate } from '@/lib/format';

interface Student {
  id: string;
  email: string;
  emailVerified: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  profile: ProfileDto;
  applications: { id: string; status: ApplicationStatus; createdAt: string; course: { titleEn: string; titleAr: string } }[];
  notes: Note[];
}

export default function StudentDetail() {
  const { locale, t } = useI18n();
  const { id } = useParams<{ id: string }>();
  const [s, setS] = useState<Student | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cvBusy, setCvBusy] = useState(false);
  useEffect(() => {
    api<Student>(`/admin/students/${id}`).then(setS).catch((e: unknown) => setError(errorMessage(e, t)));
  }, [id, t]);

  if (!s) return error ? <Alert tone="danger">{error}</Alert> : <PageSpinner />;
  return (
    <div className="space-y-5">
      <Link href={`/${locale}/admin/students`} className="text-sm text-primary hover:underline">
        <span aria-hidden className="inline-block rtl:rotate-180">←</span> {t('admin.students.title')}
      </Link>
      <div>
        <h1 className="text-2xl">{s.profile.fullNameEn ?? s.email}</h1>
        <p className="text-sm text-muted">
          <span className="ltr-embed">{s.email}</span> · {t('admin.students.joined')} {formatDate(s.createdAt, locale)}
        </p>
      </div>
      <Alert tone="info">{t('admin.students.readOnly')}</Alert>
      <div className="grid gap-5 lg:grid-cols-[1fr_22rem]">
        <Card>
          <ProfileView profile={s.profile} />
        </Card>
        <div className="space-y-5">
          <Card>
            <h2 className="text-lg">{t('profile.fields.cv')}</h2>
            {s.profile.hasCv ? (
              <Button
                className="mt-3"
                size="sm"
                variant="secondary"
                loading={cvBusy}
                onClick={async () => {
                  // Open the tab inside the click (popup blockers), then point it at the signed URL.
                  const tab = window.open('', '_blank');
                  if (tab) tab.opener = null;
                  setCvBusy(true);
                  try {
                    const r = await api<{ url: string }>(`/admin/students/${s.id}/cv`);
                    if (tab) tab.location.href = r.url;
                    else window.location.href = r.url;
                  } catch {
                    tab?.close();
                  } finally {
                    setCvBusy(false);
                  }
                }}
              >
                {t('admin.students.viewCv')}
              </Button>
            ) : (
              <p className="mt-2 text-sm text-muted">{t('admin.students.noCv')}</p>
            )}
            {s.profile.hasCv && <p className="mt-2 text-xs text-muted">{t('admin.payments.linkExpires')}</p>}
          </Card>
          <Card>
            <h2 className="text-lg">{t('admin.students.applications')}</h2>
            <ul className="mt-2 space-y-2 text-sm">
              {s.applications.length === 0 && <li className="text-muted">{t('admin.common.none')}</li>}
              {s.applications.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-2">
                  <Link href={`/${locale}/admin/applications/${a.id}`} className="text-primary underline">
                    {locale === 'ar' ? a.course.titleAr : a.course.titleEn}
                  </Link>
                  <StatusBadge status={a.status} locale={locale} />
                </li>
              ))}
            </ul>
          </Card>
          <Card>
            <h2 className="text-lg">{t('admin.common.notes')}</h2>
            <div className="mt-3">
              <Notes notes={s.notes} postUrl={`/admin/students/${s.id}/notes`} />
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

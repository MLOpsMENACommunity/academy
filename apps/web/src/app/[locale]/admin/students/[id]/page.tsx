'use client';

import { hasAdminPermission, type ApplicationStatus, type ProfileDto } from '@academy/shared';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { SpeakerRoleSwitch } from '@/components/admin/SpeakerRoleSwitch';
import { CvCard } from '@/components/admin/CvCard';
import { Notes, type Note } from '@/components/admin/Notes';
import { ProfileView } from '@/components/admin/ProfileView';
import { DeleteAccount, StudentEditor } from '@/components/admin/StudentEditor';
import { StudentPoints } from '@/components/admin/StudentPoints';
import { StatusBadge } from '@/components/applications/StatusBadge';
import { useAuth } from '@/components/auth/AuthProvider';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
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
  role: 'STUDENT' | 'SPEAKER' | 'ADMIN';
  emailVerified: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  profile: ProfileDto;
  applications: { id: string; status: ApplicationStatus; createdAt: string; course: { titleEn: string; titleAr: string } }[];
  notes: Note[];
}

export default function StudentDetail() {
  const { locale, t } = useI18n();
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const [s, setS] = useState<Student | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  // Points and badges are the academic preset's (the API checks it too).
  const academic = hasAdminPermission(useAuth().user, ['ACADEMIC']);
  useEffect(() => {
    api<Student>(`/admin/students/${id}`).then(setS).catch((e: unknown) => setError(errorMessage(e, t)));
  }, [id, t]);

  if (!s) return error ? <Alert tone="danger">{error}</Alert> : <PageSpinner />;
  return (
    <div className="space-y-5">
      <Link href={`/${locale}/admin/students`} className="text-sm text-primary hover:underline">
        <span aria-hidden className="inline-block rtl:rotate-180">←</span> {t('admin.students.title')}
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl break-words">
            {s.profile.fullNameEn ?? s.email}
            {s.role === 'SPEAKER' && (
              <span className="ms-2 inline-block align-middle">
                <Badge tone="info">{t('admin.students.speakerBadge')}</Badge>
              </span>
            )}
          </h1>
          <p className="text-sm break-all text-muted">
            <span className="ltr-embed">{s.email}</span> · {t('admin.students.joined')} {formatDate(s.createdAt, locale)}
          </p>
        </div>
        {/* Admin accounts are never edited here (the API refuses too). */}
        {s.role !== 'ADMIN' && (
          <Button variant={editing ? 'secondary' : 'primary'} onClick={() => setEditing((e) => !e)} aria-pressed={editing}>
            {editing ? t('admin.studentEdit.done') : t('admin.studentEdit.edit')}
          </Button>
        )}
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
      <p role="status" className="text-sm text-success">
        {savedAt ? `✓ ${t('admin.common.saved')}` : ''}
      </p>
      <div className="grid gap-5 lg:grid-cols-[1fr_22rem]">
        <Card>
          {editing ? (
            <StudentEditor
              studentId={s.id}
              profile={s.profile}
              onSaved={(profile) => {
                setS({ ...s, profile });
                setSavedAt(profile.updatedAt);
              }}
            />
          ) : (
            <ProfileView profile={s.profile} />
          )}
        </Card>
        <div className="space-y-5">
          <CvCard studentId={s.id} hasCv={s.profile.hasCv} />
          {s.role === 'STUDENT' && <SpeakerRoleSwitch userId={s.id} />}
          {academic && <StudentPoints studentId={s.id} />}
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
          {s.role !== 'ADMIN' && (
            <Card className="border-danger/40">
              <DeleteAccount studentId={s.id} email={s.email} onDeleted={() => router.push(`/${locale}/admin/students?deleted=1`)} />
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

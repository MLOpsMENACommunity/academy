'use client';

import { useEffect, useState } from 'react';
import { CourseForm } from '@/components/admin/CourseForm';
import { toForm, type AdminCourse } from '@/components/admin/admin-course';
import { SessionsEditor, type SessionRow } from '@/components/admin/CourseTabs';
import { Alert } from '@/components/ui/Alert';
import { useI18n } from '@/i18n/client';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';

/** Teaching → {course} → Details (EDIT_COURSE): the course editor without what stays with the admins. */
export function TeachDetails({ courseId }: { courseId: string }) {
  const { t } = useI18n();
  const [course, setCourse] = useState<AdminCourse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const url = `/teach/courses/${courseId}/details`;

  useEffect(() => {
    api<AdminCourse>(url)
      .then(setCourse)
      .catch((err: unknown) => setError(errorMessage(err, t)));
  }, [url, t, version]);

  if (error) return <Alert tone="danger">{error}</Alert>;
  if (!course) return <p className="text-muted">{t('admin.common.loading')}</p>;
  return <CourseForm key={version} initial={toForm(course)} courseId={course.id} staffEndpoint={url} onSaved={() => setVersion((v) => v + 1)} />;
}

/** Teaching → {course} → Sessions (MANAGE_SESSIONS): dates, live links and materials of every session. */
export function TeachSessions({ courseId, canAttendance }: { courseId: string; canAttendance: boolean }) {
  const { locale, t } = useI18n();
  const [rows, setRows] = useState<SessionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const base = `/teach/courses/${courseId}`;

  useEffect(() => {
    api<SessionRow[]>(`${base}/sessions`)
      .then(setRows)
      .catch((err: unknown) => setError(errorMessage(err, t)));
  }, [base, t]);

  if (error) return <Alert tone="danger">{error}</Alert>;
  if (!rows) return <p className="text-muted">{t('admin.common.loading')}</p>;
  return (
    <SessionsEditor
      courseId={courseId}
      initial={rows}
      apiBase={base}
      attendanceHref={canAttendance ? (sid) => `/${locale}/teach/courses/${courseId}?tab=attendance&session=${encodeURIComponent(sid)}` : null}
    />
  );
}

'use client';

import type { AdminAssessmentRow } from '@academy/shared';
import { useCallback, useEffect, useState } from 'react';
import { AssessmentGradebook } from '@/components/admin/AssessmentGradebook';
import type { AssessmentEndpoints } from '@/components/admin/assessment-endpoints';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { useI18n } from '@/i18n/client';
import { api } from '@/lib/api';
import { downloadViaApi } from '@/lib/download';
import { errorMessage } from '@/lib/errors';

/** My courses → {course} → Gradebook: pick an assessment to see every student and grade; export the whole course. */
export function TeachingGradebook({ courseId, endpoints }: { courseId: string; endpoints: AssessmentEndpoints }) {
  const { t } = useI18n();
  const a = (k: string, v?: Record<string, string | number>) => t(`admin.assessments.${k}`, v);
  const [rows, setRows] = useState<AdminAssessmentRow[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api<AdminAssessmentRow[]>(endpoints.list)
      .then(setRows)
      .catch((err: unknown) => setError(errorMessage(err, t)));
  }, [endpoints, t]);
  useEffect(load, [load]);

  if (open) {
    return (
      <AssessmentGradebook
        assessmentId={open}
        courseId={courseId}
        endpoints={endpoints}
        onBack={() => {
          setOpen(null);
          load();
        }}
      />
    );
  }

  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-sm text-muted">{t('speakerTeaching.gradebook.intro')}</p>
      {error && <Alert tone="danger">{error}</Alert>}
      <Button variant="secondary" onClick={() => downloadViaApi(endpoints.gradebookCsv, 'gradebook.csv').catch((err: unknown) => setError(errorMessage(err, t)))}>
        ⬇ {a('exportGradebook')}
      </Button>
      {rows === null ? (
        <p className="text-muted">{t('admin.common.loading')}</p>
      ) : rows.length === 0 ? (
        <p className="text-muted">{a('none')}</p>
      ) : (
        <ul className="divide-y divide-line rounded-card border border-line bg-card">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="font-semibold break-words text-fg" dir="auto">
                  {r.titleEn}
                </p>
                <div className="mt-1 flex flex-wrap gap-1">
                  <Badge tone={r.type === 'QUIZ' ? 'primary' : 'accent'}>{t(`assessments.type.${r.type}`)}</Badge>
                  <Badge tone={r.status === 'PUBLISHED' ? 'success' : 'warning'}>{a(`status.${r.status}`)}</Badge>
                  <Badge>{a('submittedCount', { count: r.submitted })}</Badge>
                  {r.toGrade > 0 && <Badge tone="danger">{a('toGrade', { count: r.toGrade })}</Badge>}
                </div>
              </div>
              <Button size="sm" onClick={() => setOpen(r.id)} aria-label={`${a('grade')}: ${r.titleEn}`}>
                {a('grade')}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

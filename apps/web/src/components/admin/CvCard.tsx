'use client';

import { useState } from 'react';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useI18n } from '@/i18n/client';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';

/** Table cell: whether the applicant has a CV on file (open it from the application). */
export function CvMark({ hasCv }: { hasCv: boolean }) {
  const { t } = useI18n();
  return hasCv ? (
    <Badge tone="success">{t('admin.apps.hasCv')}</Badge>
  ) : (
    // `relative` keeps the screen-reader text inside the table's scroll box (else it widens the page on phones).
    <span className="relative text-muted">
      <span aria-hidden>—</span>
      <span className="sr-only">{t('admin.apps.cvNone')}</span>
    </span>
  );
}

/**
 * A student's CV for admins: "View CV" opens it through the admin-only CV link
 * (signed for 5 minutes, every view audited), or says there is none.
 */
export function CvCard({ studentId, hasCv, hint }: { studentId: string; hasCv: boolean; hint?: string }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function open() {
    // Open the tab inside the click (popup blockers), then point it at the signed URL.
    const tab = window.open('', '_blank');
    if (tab) tab.opener = null;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ url: string }>(`/admin/students/${studentId}/cv`);
      if (tab) tab.location.href = r.url;
      else window.location.href = r.url;
    } catch (err) {
      tab?.close();
      setError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <h2 className="text-lg">{t('profile.fields.cv')}</h2>
      {hasCv ? (
        <>
          <Button className="mt-3" size="sm" variant="secondary" loading={busy} onClick={open}>
            {t('admin.students.viewCv')}
          </Button>
          <p className="mt-2 text-xs text-muted">{t('admin.payments.linkExpires')}</p>
        </>
      ) : (
        <p className="mt-2 text-sm text-muted">{t('admin.students.noCv')}</p>
      )}
      {hint && <p className="mt-2 text-xs text-muted">{hint}</p>}
      {error && (
        <Alert tone="danger" className="mt-3">
          {error}
        </Alert>
      )}
    </Card>
  );
}

'use client';

import type { CalendarFeedDto } from '@academy/shared';
import { useEffect, useState } from 'react';
import { FeedLinkField } from '@/components/learn/CalendarMenu';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { useI18n } from '@/i18n/client';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';

/** Account tab: see, create or reset the private calendar subscription link. */
export function CalendarFeedPanel() {
  const { locale, t } = useI18n();
  const [feed, setFeed] = useState<CalendarFeedDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  useEffect(() => {
    api<CalendarFeedDto>('/me/calendar-feed')
      .then(setFeed)
      .catch(() => setMsg({ tone: 'danger', text: t('errors.generic') }));
  }, [t]);

  async function save(rotate: boolean) {
    if (rotate && !window.confirm(t('account.calendarResetConfirm'))) return;
    setBusy(true);
    setMsg(null);
    try {
      setFeed(await api<CalendarFeedDto>(`/me/calendar-feed${rotate ? '?rotate=1' : ''}`, { method: 'POST' }));
      if (rotate) setMsg({ tone: 'success', text: t('account.calendarResetDone') });
    } catch {
      setMsg({ tone: 'danger', text: t('errors.generic') });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <p className="text-sm text-muted">{t('account.calendarBody')}</p>
      {feed?.url ? (
        <div className="mt-3 space-y-2">
          <FeedLinkField key={feed.url} url={feed.url} />
          {feed.lastFetchedAt && (
            <p className="text-xs text-muted">{t('account.calendarLastFetched', { date: formatDateTime(feed.lastFetchedAt, locale) })}</p>
          )}
          <Button type="button" variant="secondary" loading={busy} onClick={() => save(true)}>
            {t('account.calendarReset')}
          </Button>
        </div>
      ) : (
        feed && (
          <div className="mt-3">
            <p className="text-sm">{t('account.calendarNone')}</p>
            <Button type="button" variant="secondary" className="mt-3" loading={busy} onClick={() => save(false)}>
              {t('account.calendarCreate')}
            </Button>
          </div>
        )
      )}
      {msg && (
        <Alert tone={msg.tone} className="mt-3">
          {msg.text}
        </Alert>
      )}
    </div>
  );
}

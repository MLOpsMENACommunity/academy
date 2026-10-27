'use client';

import type { TelegramLinkDto, TelegramStatusDto } from '@academy/shared';
import { useCallback, useEffect, useState } from 'react';
import { Alert } from '@/components/ui/Alert';
import { Button, buttonClass } from '@/components/ui/Button';
import { useI18n } from '@/i18n/client';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';

/**
 * Profile → Community: connect the student's Telegram account to the academy's bot, so it lets
 * them into their courses' groups. Hidden when the academy has no bot configured.
 */
export function TelegramConnect() {
  const { locale, t } = useI18n();
  const [status, setStatus] = useState<TelegramStatusDto | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  const load = useCallback(() => {
    api<TelegramStatusDto>('/me/telegram')
      .then((s) => {
        setStatus(s);
        if (s.linked) setLink(null);
      })
      .catch(() => setStatus(null));
  }, []);

  useEffect(() => {
    load();
    // Back from Telegram after pressing Start: show the new state.
    const onFocus = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', onFocus);
    return () => document.removeEventListener('visibilitychange', onFocus);
  }, [load]);

  if (!status?.enabled) return null;

  async function connect() {
    setBusy(true);
    setError(false);
    try {
      setLink((await api<TelegramLinkDto>('/me/telegram/link', { method: 'POST' })).url);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!window.confirm(t('telegram.disconnectConfirm'))) return;
    setBusy(true);
    setError(false);
    try {
      setStatus(await api<TelegramStatusDto>('/me/telegram', { method: 'DELETE' }));
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="telegram-connect" className="mt-6 rounded-card border border-line bg-card p-5 sm:p-8">
      <h2 id="telegram-connect" className="text-xl">
        {t('telegram.title')}
      </h2>
      {status.linked ? (
        <div className="mt-2 space-y-3">
          <p className="text-sm">
            {status.linkedAt ? t('telegram.connectedOn', { date: formatDate(status.linkedAt, locale) }) : t('telegram.connected')}
          </p>
          <p className="text-sm text-muted">{t('telegram.connectedHint')}</p>
          <Button type="button" variant="secondary" loading={busy} onClick={disconnect}>
            {t('telegram.disconnect')}
          </Button>
        </div>
      ) : (
        <div className="mt-2 space-y-3">
          <p className="text-sm text-muted">{t('telegram.connectHint')}</p>
          {link ? (
            <>
              <a href={link} target="_blank" rel="noopener noreferrer" className={buttonClass('primary')}>
                {t('telegram.openTelegram')}
              </a>
              <p className="text-sm text-muted">{t('telegram.pressStart')}</p>
            </>
          ) : (
            <Button type="button" loading={busy} onClick={connect}>
              {t('telegram.connect')}
            </Button>
          )}
        </div>
      )}
      {error && (
        <Alert tone="danger" className="mt-3">
          {t('errors.generic')}
        </Alert>
      )}
    </section>
  );
}

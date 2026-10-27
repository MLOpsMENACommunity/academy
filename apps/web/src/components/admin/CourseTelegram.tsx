'use client';

import type { AdminCourseTelegramDto } from '@academy/shared';
import { useEffect, useState } from 'react';
import { SelectField } from '@/components/forms/fields';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useI18n } from '@/i18n/client';
import { api, ApiError } from '@/lib/api';
import { errorMessage } from '@/lib/errors';

/**
 * Course settings → Telegram group (ACADEMIC): pick one of the groups the bot is an admin of;
 * saving makes a join-request link the bot answers for enrolled students. Hidden when the
 * academy has no bot configured.
 */
export function CourseTelegram({ courseId }: { courseId: string }) {
  const { t } = useI18n();
  const [data, setData] = useState<AdminCourseTelegramDto | null>(null);
  const [chatId, setChatId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  useEffect(() => {
    api<AdminCourseTelegramDto>(`/admin/courses/${courseId}/telegram`)
      .then((d) => {
        setData(d);
        setChatId(d.chat?.id ?? null);
      })
      .catch(() => setData(null));
  }, [courseId]);

  if (!data?.enabled) return null;

  async function save(next: string | null) {
    setBusy(true);
    setMsg(null);
    try {
      const d = await api<AdminCourseTelegramDto>(`/admin/courses/${courseId}/telegram`, { method: 'PUT', json: { chatId: next } });
      setData(d);
      setChatId(d.chat?.id ?? null);
      setMsg({ tone: 'success', text: t(next ? 'telegram.admin.saved' : 'telegram.admin.cleared') });
    } catch (err) {
      const code = err instanceof ApiError ? err.code : undefined;
      setMsg({ tone: 'danger', text: code === 'TELEGRAM_CHAT_NOT_READY' || code === 'TELEGRAM_LINK_FAILED' ? t('telegram.admin.notReady') : errorMessage(err, t) });
    } finally {
      setBusy(false);
    }
  }

  // The current group stays in the list even if the bot lost its rights there since.
  const options = [...data.chats];
  if (data.chat && !options.some((c) => c.id === data.chat!.id)) options.unshift(data.chat);

  return (
    <Card className="mt-6">
      <h2 className="text-xl">{t('telegram.admin.title')}</h2>
      <ol className="mt-2 list-decimal space-y-1 ps-5 text-sm text-muted">
        <li>{t('telegram.admin.step1', { bot: data.botUsername ? `@${data.botUsername}` : t('telegram.admin.theBot') })}</li>
        <li>{t('telegram.admin.step2')}</li>
        <li>{t('telegram.admin.step3')}</li>
      </ol>
      <p className="mt-2 text-sm text-muted">{t('telegram.admin.noRemoval')}</p>
      <div className="mt-4 max-w-md">
        <SelectField
          label={t('telegram.admin.group')}
          value={chatId}
          onChange={setChatId}
          placeholder={t('telegram.admin.none')}
          options={options.map((c) => ({ value: c.id, label: c.title || c.id }))}
        />
        {!options.length && <p className="mt-2 text-sm text-muted">{t('telegram.admin.noGroups')}</p>}
      </div>
      {data.inviteLink && (
        <p className="mt-3 text-sm break-all">
          {t('telegram.admin.link')}{' '}
          <a href={data.inviteLink} target="_blank" rel="noopener noreferrer" className="text-primary underline" dir="ltr">
            {data.inviteLink}
          </a>
        </p>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button type="button" loading={busy} disabled={!chatId || (chatId === data.chat?.id && Boolean(data.inviteLink))} onClick={() => save(chatId)}>
          {t('telegram.admin.save')}
        </Button>
        {data.chat && (
          <Button type="button" variant="secondary" loading={busy} onClick={() => save(null)}>
            {t('telegram.admin.clear')}
          </Button>
        )}
      </div>
      {msg && (
        <Alert tone={msg.tone} className="mt-3">
          {msg.text}
        </Alert>
      )}
    </Card>
  );
}

'use client';

import { TELEGRAM_CONNECT_PATH, type LearnTelegramDto } from '@academy/shared';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { buttonClass } from '@/components/ui/Button';
import { useI18n } from '@/i18n/client';
import { api } from '@/lib/api';

/**
 * The learn page's "Join the course Telegram group": connect Telegram first (the bot then lets
 * enrolled students in), then the course's join-request link. Nothing when the course has no group.
 */
export function TelegramGroup({ slug }: { slug: string }) {
  const { locale, t } = useI18n();
  const [data, setData] = useState<LearnTelegramDto | null>(null);

  useEffect(() => {
    api<LearnTelegramDto>(`/learn/${encodeURIComponent(slug)}/telegram`)
      .then(setData)
      .catch(() => setData(null));
  }, [slug]);

  if (!data?.enabled || !data.hasGroup || !data.inviteLink) return null;

  return (
    <div className="flex flex-col items-start gap-2 border-t border-line pt-3" data-testid="telegram-group">
      <h3 className="text-sm font-semibold">{t('telegram.groupTitle')}</h3>
      {data.linked ? (
        <>
          <p className="text-xs text-muted">{t('telegram.groupHint')}</p>
          <a href={data.inviteLink} target="_blank" rel="noopener noreferrer" className={buttonClass('secondary', 'sm')}>
            {t('telegram.joinGroup')}
          </a>
        </>
      ) : (
        <>
          <p className="text-xs text-muted">{t('telegram.groupConnectFirst')}</p>
          <Link href={`/${locale}${TELEGRAM_CONNECT_PATH}`} className={buttonClass('secondary', 'sm')}>
            {t('telegram.connect')}
          </Link>
        </>
      )}
    </div>
  );
}

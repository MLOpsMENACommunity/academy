'use client';

import { useI18n } from '@/i18n/client';

export function PageSpinner() {
  const { t } = useI18n();
  return (
    <div className="grid min-h-[40vh] place-items-center" role="status">
      <span className="size-8 animate-spin rounded-full border-4 border-line border-t-primary" aria-hidden />
      <span className="sr-only">{t('common.loading')}</span>
    </div>
  );
}

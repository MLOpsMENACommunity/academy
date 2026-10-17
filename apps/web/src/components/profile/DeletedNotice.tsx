'use client';

import { Alert } from '@/components/ui/Alert';
import { Container } from '@/components/ui/Container';
import { useI18n } from '@/i18n/client';
import { useSearchParam } from '@/lib/use-search-param';

/**
 * After "Delete account" the profile sends people to /{locale}?deleted=1: confirm it there.
 * Read on the client only, so the cached homepage HTML stays the same for everyone.
 */
export function DeletedNotice() {
  const { t } = useI18n();
  if (useSearchParam('deleted') !== '1') return null;
  return (
    <Container className="pt-6">
      <Alert tone="success" title={t('account.deletedTitle')}>
        {t('account.deletedBody')}
      </Alert>
    </Container>
  );
}

'use client';

import { hasAdminPermission, type AdminPermission, type MeResponse } from '@academy/shared';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { useI18n } from '@/i18n/client';
import { Alert } from '../ui/Alert';
import { PageSpinner } from '../ui/Spinner';
import { useAuth } from './AuthProvider';

/**
 * Client-side gate for private pages (the API enforces access; this only
 * avoids flashing an empty page and sends visitors to login with returnTo).
 * `permissions`: an admin page for these presets (or SUPER); other admins see a "no access" note.
 */
export function RequireAuth({
  children,
  role,
  permissions,
}: {
  children: (user: MeResponse) => ReactNode;
  role?: 'ADMIN';
  permissions?: readonly AdminPermission[];
}) {
  const { user, loading } = useAuth();
  const { locale, t } = useI18n();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      // Keep the #section too (e.g. #reminders from an email), so login lands on the same spot.
      const here = pathname + (typeof window !== 'undefined' ? window.location.search + window.location.hash : '');
      router.replace(`/${locale}/login?returnTo=${encodeURIComponent(here)}`);
    } else if (role && user.role !== role) {
      router.replace(`/${locale}/dashboard`);
    }
  }, [loading, user, role, router, locale, pathname]);

  if (loading || !user || (role && user.role !== role)) return <PageSpinner />;
  if (permissions && !hasAdminPermission(user, permissions)) {
    return (
      <Alert tone="warning" title={t('admin.noAccess.title')}>
        {t('admin.noAccess.body')}
      </Alert>
    );
  }
  return <>{children(user)}</>;
}

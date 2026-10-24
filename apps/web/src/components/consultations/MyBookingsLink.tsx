'use client';

import Link from 'next/link';
import { useAuth } from '@/components/auth/AuthProvider';
import { useI18n } from '@/i18n/client';

/** "My bookings", for signed-in visitors only (the page above it is the same for everyone). */
export function MyBookingsLink({ className = '' }: { className?: string }) {
  const { locale, t } = useI18n();
  const { user } = useAuth();
  if (!user) return null;
  return (
    <Link href={`/${locale}/consultations/bookings`} className={`font-medium text-primary hover:underline ${className}`}>
      {t('consultations.mine.title')}
    </Link>
  );
}

import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ReservedSpace } from '@/components/ui/Spinner';
import { Unsubscribe } from './Unsubscribe';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { robots: { index: false, follow: false } };

/** The per-course "stop these emails" link in feedback emails (works without signing in). */
export default function UnsubscribePage() {
  return (
    <Suspense fallback={<ReservedSpace className="min-h-[24rem]" />}>
      <Unsubscribe />
    </Suspense>
  );
}

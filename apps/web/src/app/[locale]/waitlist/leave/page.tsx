import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ReservedSpace } from '@/components/ui/Spinner';
import { LeaveWaitlist } from './LeaveWaitlist';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { robots: { index: false, follow: false } };

/** The link in every waiting-list email. */
export default function LeaveWaitlistPage() {
  return (
    <Suspense fallback={<ReservedSpace className="min-h-[24rem]" />}>
      <LeaveWaitlist />
    </Suspense>
  );
}

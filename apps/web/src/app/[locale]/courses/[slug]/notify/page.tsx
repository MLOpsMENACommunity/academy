import type { Metadata } from 'next';
import { Suspense } from 'react';
import { NotifyIntent } from './NotifyIntent';
import { PageSpinner } from '@/components/ui/Spinner';

export const metadata: Metadata = { robots: { index: false } };

/**
 * "Notify me" for someone who wasn't signed in: like /apply, this is the returnTo of sign-up
 * and sign-in (kept through onboarding and the email confirmation link), and joins the
 * waiting list once they are back with a confirmed account.
 */
export default function NotifyPage() {
  return (
    <Suspense fallback={<PageSpinner />}>
      <NotifyIntent />
    </Suspense>
  );
}

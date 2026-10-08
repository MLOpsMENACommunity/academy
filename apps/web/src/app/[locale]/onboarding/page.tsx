import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Onboarding } from './Onboarding';
import { PageSpinner } from '@/components/ui/Spinner';

export const metadata: Metadata = { robots: { index: false } };

export default function OnboardingPage() {
  return (
    <Suspense fallback={<PageSpinner />}>
      <Onboarding />
    </Suspense>
  );
}

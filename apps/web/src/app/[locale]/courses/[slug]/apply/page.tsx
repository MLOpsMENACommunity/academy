import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ApplyForm } from './ApplyForm';
import { PageSpinner } from '@/components/ui/Spinner';

export const metadata: Metadata = { robots: { index: false } };

export default function ApplyPage() {
  return (
    <Suspense fallback={<PageSpinner />}>
      <ApplyForm />
    </Suspense>
  );
}

import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ApplyForm } from './ApplyForm';

export const metadata: Metadata = { robots: { index: false } };

export default function ApplyPage() {
  return (
    <Suspense>
      <ApplyForm />
    </Suspense>
  );
}

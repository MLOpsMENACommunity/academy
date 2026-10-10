import type { Metadata } from 'next';
import { AssessmentPage } from '@/components/learn/AssessmentPage';

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function Page() {
  return <AssessmentPage />;
}

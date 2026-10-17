import type { Metadata } from 'next';
import { TeachHome } from '@/components/teach/TeachHome';

export const metadata: Metadata = { robots: { index: false } };

/** Teaching: the courses I'm on the staff of (any account role). */
export default function TeachPage() {
  return <TeachHome />;
}

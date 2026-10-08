import type { Metadata } from 'next';
import { LearnPage } from './LearnPage';

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function Page() {
  return <LearnPage />;
}

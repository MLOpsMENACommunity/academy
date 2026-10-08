import type { Metadata } from 'next';
import { ApplicationDetail } from './ApplicationDetail';

export const metadata: Metadata = { robots: { index: false } };

export default function Page() {
  return <ApplicationDetail />;
}

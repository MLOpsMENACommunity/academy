import type { Metadata } from 'next';
import { SpeakerPortal } from '@/components/speakers/SpeakerPortal';

export const metadata: Metadata = { robots: { index: false } };

export default function SpeakerPortalPage() {
  return <SpeakerPortal />;
}

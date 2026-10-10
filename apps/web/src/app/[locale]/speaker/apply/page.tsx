import type { Metadata } from 'next';
import { SpeakerApply } from './SpeakerApply';

export const metadata: Metadata = { robots: { index: false } };

export default function SpeakerApplyPage() {
  return <SpeakerApply />;
}

import type { Metadata } from 'next';
import { Suspense } from 'react';
import { TeachingCourse } from '@/components/speakers/teaching/TeachingCourse';

export const metadata: Metadata = { robots: { index: false } };

export default async function SpeakerCoursePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense>
      <TeachingCourse courseId={id} />
    </Suspense>
  );
}

import type { Metadata } from 'next';
import { Suspense } from 'react';
import { TeachCourse } from '@/components/teach/TeachCourse';

export const metadata: Metadata = { robots: { index: false } };

export default async function TeachCoursePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense>
      <TeachCourse courseId={id} />
    </Suspense>
  );
}

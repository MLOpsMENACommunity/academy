'use client';

import { useEffect } from 'react';
import { trackFunnel } from '@/lib/funnel';

/** Records one COURSE_VIEW per page load (no cookies; see lib/funnel). */
export function CourseViewTracker({ slug }: { slug: string }) {
  useEffect(() => {
    trackFunnel(slug, 'COURSE_VIEW');
  }, [slug]);
  return null;
}

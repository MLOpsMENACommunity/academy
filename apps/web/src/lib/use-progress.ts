'use client';

import type { LearnCourseDto, MyApplicationDto } from '@academy/shared';
import { useEffect, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { api } from './api';

/** A signed-in student's own standing in one course, from their application and the course's session progress. */
export interface CourseProgress {
  slug: string;
  course: MyApplicationDto['course'];
  applicationId: string;
  status: MyApplicationDto['status'];
  enrolled: boolean;
  /** Sessions marked attended/watched out of all sessions; null when not enrolled. */
  progress: LearnCourseDto['progress'] | null;
  /** The first session not marked done yet (for "Resume"), by order. */
  nextSession: { order: number; titleEn: string; titleAr: string } | null;
}

export const isCompleted = (p: CourseProgress) => Boolean(p.progress && p.progress.total > 0 && p.progress.completed === p.progress.total);

/**
 * My applications, with session progress for the courses I'm enrolled in. Loaded in the
 * browser after the page (public pages stay the same for everyone): null while loading
 * or when signed out, so callers show nothing personal rather than a guess.
 */
export function useMyCourses(): { items: CourseProgress[] | null; error: boolean } {
  const { user } = useAuth();
  const [items, setItems] = useState<CourseProgress[] | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!user) {
      setItems(null);
      return;
    }
    let live = true;
    (async () => {
      const apps = await api<MyApplicationDto[]>('/me/applications');
      const rows = await Promise.all(
        apps.map(async (a): Promise<CourseProgress> => {
          const base = { slug: a.course.slug, course: a.course, applicationId: a.id, status: a.status, enrolled: a.enrolled, progress: null, nextSession: null };
          if (!a.enrolled) return base;
          try {
            const c = await api<LearnCourseDto>(`/learn/${a.course.slug}`);
            const next = [...c.sessions].sort((x, y) => x.order - y.order).find((s) => !s.completed);
            return { ...base, progress: c.progress, nextSession: next ? { order: next.order, titleEn: next.titleEn, titleAr: next.titleAr } : null };
          } catch {
            return base;
          }
        }),
      );
      if (live) setItems(rows);
    })().catch(() => live && setError(true));
    return () => {
      live = false;
    };
  }, [user]);
  return { items, error };
}

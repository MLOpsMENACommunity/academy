import { redirect } from 'next/navigation';

/** The speaker portal's course pages moved to Teaching (/teach/courses/{id}), for every kind of course staff. */
export default async function SpeakerCoursePage({ params, searchParams }: { params: Promise<{ locale: string; id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ locale, id }, query] = await Promise.all([params, searchParams]);
  const keep = new URLSearchParams();
  for (const k of ['tab', 'session']) {
    const v = query[k];
    if (typeof v === 'string') keep.set(k, v);
  }
  const qs = keep.toString();
  redirect(`/${locale}/teach/courses/${encodeURIComponent(id)}${qs ? `?${qs}` : ''}`);
}

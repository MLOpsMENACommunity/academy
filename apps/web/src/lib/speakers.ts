import 'server-only';
import type { PublicSpeakerDto } from '@academy/shared';
import { serverGetOr } from './server-api';

/**
 * Public speakers with their sessions and courses, the most active first (sessions
 * given plus courses taught). Optional page content: an empty list if the API is down.
 */
export async function loadSpeakers(limit = 24): Promise<PublicSpeakerDto[]> {
  const slugs = await serverGetOr<{ slug: string }[]>('/speakers', [], 300);
  const all = await Promise.all(
    slugs
      .filter((s) => /^[a-z0-9-]{1,80}$/.test(s.slug))
      .slice(0, 60)
      .map((s) => serverGetOr<PublicSpeakerDto | null>(`/speakers/${s.slug}`, null, 300)),
  );
  return all
    .filter((s): s is PublicSpeakerDto => s !== null)
    .sort((a, b) => b.events.length + b.courses.length - (a.events.length + a.courses.length) || a.name.localeCompare(b.name))
    .slice(0, limit);
}

import { z } from 'zod';
import type { AttendanceStatus, CourseType, DeliveryPlatform, RecordingsPlatform } from './enums';
import type { Material } from './course-content';
import { googleCalendarLink } from './calendar';

export type RecordingKind = 'youtube' | 'drive' | 'link';

/** YouTube video id from watch, youtu.be, embed, live and shorts URLs. */
export function youtubeId(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\.|^m\./, '');
    if (host === 'youtu.be') return u.pathname.slice(1).split('/')[0] || null;
    if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
      if (u.searchParams.get('v')) return u.searchParams.get('v');
      const m = u.pathname.match(/^\/(?:embed|live|shorts|v)\/([\w-]{6,})/);
      return m?.[1] ?? null;
    }
  } catch {
    // not a URL
  }
  return null;
}

export function recordingKind(url: string): RecordingKind {
  if (youtubeId(url)) return 'youtube';
  try {
    if (new URL(url).hostname.endsWith('drive.google.com')) return 'drive';
  } catch {
    // fall through
  }
  return 'link';
}

export type SessionPhase = 'upcoming' | 'live' | 'ended';

export function sessionPhase(startsAt: Date, durationMin: number, now = new Date()): SessionPhase {
  const start = startsAt.getTime();
  if (now.getTime() < start) return 'upcoming';
  if (now.getTime() <= start + durationMin * 60_000) return 'live';
  return 'ended';
}

/** The live link is shown from `revealMinutes` before the start until 30 minutes after the end. */
export function liveLinkVisible(startsAt: Date, durationMin: number, revealMinutes: number, now = new Date()): boolean {
  const t = now.getTime();
  const start = startsAt.getTime();
  return t >= start - revealMinutes * 60_000 && t <= start + (durationMin + 30) * 60_000;
}

export interface LearnSessionDto {
  id: string;
  order: number;
  titleEn: string;
  titleAr: string;
  descriptionEn: string | null;
  descriptionAr: string | null;
  startsAt: string;
  durationMin: number;
  phase: SessionPhase;
  /** When the live link becomes visible (ISO). */
  liveLinkAt: string;
  /** Only present inside the reveal window. */
  liveUrl: string | null;
  recording: { url: string; kind: RecordingKind; youtubeId: string | null } | null;
  materials: Material[];
  assignmentUrl: string | null;
  completed: boolean;
  /** Their attendance from the Meet file (or set by the team); null until it is recorded. */
  attendance: { status: AttendanceStatus; minutes: number; percent: number } | null;
  myFeedback: { rating: number; comment: string | null } | null;
}

export interface LearnCourseDto {
  slug: string;
  titleEn: string;
  titleAr: string;
  type: CourseType;
  deliveryPlatform: DeliveryPlatform;
  recordingsPlatform: RecordingsPlatform;
  youtubePlaylistUrl: string | null;
  /** Paid Drive courses: the folder shared with the student's Google account. */
  driveFolderUrl: string | null;
  googleEmail: string | null;
  /** v1 sharing is manual: false until an admin ticks "Drive access granted". */
  driveAccessGranted: boolean;
  liveLinkRevealMinutes: number;
  emailReminders: boolean;
  progress: { completed: number; total: number; percent: number };
  courseFeedback: { rating: number; comment: string | null } | null;
  sessions: LearnSessionDto[];
  /**
   * Messages from the course team, newest first. Arabic falls back to English. `fromEn`/`fromAr`
   * name the speaker who sent it (null when the team did).
   */
  announcements: { id: string; at: string; subjectEn: string; subjectAr: string; bodyEn: string; bodyAr: string; fromEn: string | null; fromAr: string | null }[];
}

export interface NextSessionDto {
  courseSlug: string;
  courseTitleEn: string;
  courseTitleAr: string;
  sessionId: string;
  titleEn: string;
  titleAr: string;
  startsAt: string;
  durationMin: number;
}

/**
 * The dashboard's "Rate your last session" card: per course, the latest session that ended in
 * the last 14 days and that the student hasn't rated. `courseFeedbackDue`: it was the course's
 * last session and the course itself isn't rated yet either.
 */
export interface FeedbackDueDto {
  courseSlug: string;
  courseTitleEn: string;
  courseTitleAr: string;
  sessionId: string;
  order: number;
  titleEn: string;
  titleAr: string;
  startsAt: string;
  courseFeedbackDue: boolean;
}

/** The learn page's deep links: #session-3 opens session 3, #session-3-feedback also scrolls to its rating form. */
export function parseSessionHash(hash: string): { order: number; feedback: boolean } | null {
  const m = /^#session-(\d{1,4})(-feedback)?$/.exec(hash);
  return m ? { order: Number(m[1]), feedback: Boolean(m[2]) } : null;
}

/** Hashes that survive a sign-in redirect onto the learn page (see useReturnTo). */
export function isCarriedHash(hash: string): boolean {
  return parseSessionHash(hash) !== null || hash === '#course-feedback' || hash === '#reminders';
}

export const progressSchema = z.object({ completed: z.boolean() });
export const feedbackSchema = z.object({
  /** Null/absent for end-of-course feedback. */
  sessionId: z.string().min(1).max(40).nullish(),
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(2000).nullish(),
});
export type FeedbackInput = z.infer<typeof feedbackSchema>;
export const reminderPreferenceSchema = z.object({ emailReminders: z.boolean() });

/** Google Calendar "add event" link (no live link inside: it points at the course page). */
export function googleCalendarUrl(e: { title: string; startsAt: string; durationMin: number; details: string }): string {
  const start = new Date(e.startsAt);
  return googleCalendarLink({ title: e.title, start, end: new Date(start.getTime() + e.durationMin * 60_000), details: e.details });
}

/**
 * The student's private calendar subscription link (GET/POST /me/calendar-feed).
 * `url` is the https feed; calendar apps subscribe to its webcal:// form.
 */
export interface CalendarFeedDto {
  exists: boolean;
  url: string | null;
  createdAt: string | null;
  lastFetchedAt: string | null;
}

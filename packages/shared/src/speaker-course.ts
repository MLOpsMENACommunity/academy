import { topicSchema } from './archive';
import { legacyCourseLevel, levelsFromLegacy } from './course';
import type { Included, LocalizedList, LocalizedText, OutlineModule } from './course-content';
import type { AudienceLevel, CourseLanguage, CourseLevel } from './enums';
import type { DetailLevel, SpeakerDetailsDto } from './speaker-details';

/**
 * A speaker's COURSE booking becomes a DRAFT course the team finishes and publishes from
 * Admin → Courses. This is what the booking fills in; the rest keeps the course defaults.
 * Arabic texts stay empty (the editor asks for them before the course goes public), except
 * the outline's module titles, which the editor requires on every save: they start as the
 * English titles, to translate.
 */
export interface CourseDraftSource {
  title: string;
  abstract: string;
  details: SpeakerDetailsDto;
  /** The application's language, when the booking doesn't say. */
  language: CourseLanguage;
  /** The booked slot: the course's start date. */
  startsAt: Date;
}

export interface CourseDraftFields {
  titleEn: string;
  titleAr: string;
  shortDescriptionEn: string;
  shortDescriptionAr: string;
  longDescriptionEn: string;
  longDescriptionAr: string;
  type: 'FREE';
  price: 0;
  status: 'DRAFT';
  levels: AudienceLevel[];
  level: CourseLevel;
  language: CourseLanguage;
  startDate: Date;
  durationWeeks: number | null;
  hoursPerWeek: number | null;
  targetAudience: LocalizedText;
  notFor: LocalizedText;
  preparation: LocalizedText;
  learningOutcomes: LocalizedList;
  prerequisites: LocalizedList;
  outline: OutlineModule[];
  faq: [];
  included: Included;
  topics: string[];
}

/** A course's short description holds 400 characters: longer text is cut at a word, with "…". */
export function shortDescription(text: string, max = 400): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const atWord = cut.lastIndexOf(' ');
  return `${(atWord > max / 2 ? cut.slice(0, atWord) : cut).replace(/[\s.,;:!?-]+$/, '')}…`;
}

/** "Python\n- Docker basics" → ["Python", "Docker basics"]: one prerequisite per line, bullets dropped. */
export function prerequisiteList(text: string | undefined): string[] {
  return (text ?? '')
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:[-*•·]|\d+[.)])\s*/, '').trim())
    .filter(Boolean);
}

/** The speaker's "level" (beginner, intermediate, advanced) as the course's audience levels. */
const LEVELS: Record<DetailLevel, CourseLevel> = { BEGINNER: 'BEGINNER', INTERMEDIATE: 'INTERMEDIATE', ADVANCED: 'ADVANCED' };

export function courseDraftFromBooking(b: CourseDraftSource): CourseDraftFields {
  const d = b.details;
  const c = d.course ?? {};
  const levels = d.level ? levelsFromLegacy(LEVELS[d.level]) : [];
  const topics = Array.from(
    new Set((d.tags ?? []).map((tag) => topicSchema.safeParse(tag)).flatMap((r) => (r.success ? [r.data] : []))),
  ).slice(0, 12);
  return {
    titleEn: b.title,
    titleAr: '',
    shortDescriptionEn: shortDescription(b.abstract),
    shortDescriptionAr: '',
    longDescriptionEn: b.abstract,
    longDescriptionAr: '',
    type: 'FREE',
    price: 0,
    status: 'DRAFT',
    levels,
    level: legacyCourseLevel(levels),
    language: d.language ?? b.language,
    startDate: b.startsAt,
    durationWeeks: c.durationWeeks ?? null,
    // Whole hours on the course (1–60); the speaker may have said "1.5".
    hoursPerWeek: c.weeklyHours ? Math.min(60, Math.max(1, Math.round(c.weeklyHours))) : null,
    targetAudience: { en: d.audience ?? '', ar: '' },
    notFor: { en: '', ar: '' },
    preparation: { en: c.materialsUrl ? `Course materials: ${c.materialsUrl}` : '', ar: '' },
    learningOutcomes: { en: d.outcomes ?? [], ar: [] },
    prerequisites: { en: prerequisiteList(d.prerequisites), ar: [] },
    outline: (c.modules ?? []).map((m, i) => {
      const title = m.title || `Module ${i + 1}`;
      return { titleEn: title, titleAr: title, ...(m.description ? { descriptionEn: m.description } : {}) };
    }),
    faq: [],
    included: { liveSessions: true, recordings: true, assignments: false, finalProject: false, certificate: false },
    topics,
  };
}

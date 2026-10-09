import { z } from 'zod';
import type { CourseAvailability, EventSpeakerRole, EventStatus } from './enums';
import type { Localized } from './labels';

// ------------------------------------------------------------------ topics

/** A filter tag: lowercase words joined by dashes, e.g. "ci-cd", "model-serving". */
export const topicSchema = z
  .string()
  .trim()
  .toLowerCase()
  .transform((s) => s.replace(/[\s_/]+/g, '-'))
  .pipe(z.string().regex(/^[a-z0-9]+(?:[-.][a-z0-9]+)*$/, 'Lowercase letters, digits and dashes only').max(40));

/** Up to 12 distinct tags, in the order given. */
export const topicsSchema = z
  .array(topicSchema)
  .max(12)
  .transform((list) => [...new Set(list)]);

/**
 * Labels for the tags the archive uses. Any other tag still works: it is shown
 * as typed (tags are short and mostly tool names, which stay English in Arabic).
 */
export const TOPIC_LABELS: Record<string, Localized> = {
  python: { en: 'Python', ar: 'Python' },
  fastapi: { en: 'FastAPI', ar: 'FastAPI' },
  docker: { en: 'Docker', ar: 'Docker' },
  kubernetes: { en: 'Kubernetes', ar: 'Kubernetes' },
  'ci-cd': { en: 'CI/CD', ar: 'CI/CD' },
  'experiment-tracking': { en: 'Experiment tracking', ar: 'تتبّع التجارب' },
  'model-serving': { en: 'Model serving', ar: 'خدمة النماذج' },
  deployment: { en: 'Deployment strategies', ar: 'استراتيجيات النشر' },
  observability: { en: 'Observability', ar: 'المراقبة' },
  'model-optimization': { en: 'Model optimization', ar: 'تحسين النماذج' },
  llmops: { en: 'LLMOps', ar: 'LLMOps' },
  'on-prem': { en: 'On-prem', ar: 'البنية المحلية (On-prem)' },
  mlops: { en: 'MLOps', ar: 'MLOps' },
};

export function topicLabel(tag: string, locale: 'en' | 'ar'): string {
  return TOPIC_LABELS[tag]?.[locale] ?? tag;
}

// ------------------------------------------------------------------ search

/**
 * How people spell tools and topics when they search in Arabic (or in short), mapped to the
 * English word the recordings use. Searching "دوكر" also finds "Docker".
 */
export const SEARCH_ALIASES: Record<string, string[]> = {
  docker: ['دوكر', 'دوكير', 'داكر', 'دوكار'],
  kubernetes: [
    'كوبرنيتيس',
    'كوبرنيتس',
    'كوبيرنيتيس',
    'كوبيرنيتس',
    'كوبرنتس',
    'كيوبرنيتيس',
    'كيوبرنيتس',
    'k8s',
  ],
  python: ['بايثون', 'بايتون', 'بيثون'],
  fastapi: ['فاست اي بي اي', 'فاست ابي', 'فاستapi', 'فاست api'],
  'ci/cd': ['cicd', 'ci-cd', 'ci cd', 'سي اي سي دي', 'التكامل المستمر', 'النشر المستمر'],
  'github actions': ['جيت هاب اكشنز', 'جيتهاب اكشنز', 'جيت هب اكشنز'],
  mlops: ['ام ال اوبس', 'ام ال أوبس', 'إم إل أوبس'],
  llmops: ['ال ال ام اوبس', 'إل إل إم أوبس'],
  llm: ['ال ال ام', 'نماذج اللغة الكبيرة', 'النماذج اللغوية'],
  prometheus: ['بروميثيوس', 'بروميثيس'],
  grafana: ['جرافانا', 'غرافانا', 'جرافنا'],
  redis: ['ريديس', 'رديس'],
  uv: ['يو في'],
  ruff: ['راف'],
  vllm: ['في ال ال ام'],
  'on-prem': ['on prem', 'اون بريم', 'أون بريم'],
};

/**
 * Text folded for search: lower case, Arabic without diacritics or tatweel, one form of
 * alef, yaa and taa marbuta, and "عبد ال…" written as one word, as names are spelled both ways.
 */
export function foldSearch(text: string): string {
  return text
    .toLocaleLowerCase('en')
    .normalize('NFKC')
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/[إأآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/عبد\s+ال/g, 'عبدال')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * What a search looks for: the folded text, plus the same text with each Arabic or short
 * spelling of a tool replaced by its English name. Null for an empty search.
 */
export function searchTerms(query: string): string[] | null {
  const q = foldSearch(query);
  if (!q) return null;
  const terms = new Set([q]);
  for (const [word, aliases] of Object.entries(SEARCH_ALIASES)) {
    for (const alias of aliases.map(foldSearch)) {
      if (q.includes(alias)) terms.add(q.split(alias).join(word));
    }
  }
  return [...terms];
}

/** Comma-separated text from an admin field -> tags (invalid ones dropped). */
export function parseTopics(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/[,،\n]/)) {
    const r = topicSchema.safeParse(raw);
    if (r.success && r.data && !out.includes(r.data)) out.push(r.data);
  }
  return out.slice(0, 12);
}

// ------------------------------------------------------------------ speakers

/** "Eng. Sameh Amin" -> "eng-sameh-amin". Empty when the name has no Latin letters or digits. */
export function slugify(text: string, max = 60): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/, '');
}

/** Enough to name and link a speaker next to a session or a course. */
export interface SpeakerRefDto {
  /** Null when the person has no public page (free-text speaker on a session). */
  slug: string | null;
  name: string;
  nameAr: string | null;
  titleEn: string | null;
  titleAr: string | null;
  photoUrl: string | null;
}

/** One session on a speaker's page. */
export interface SpeakerEventDto {
  slug: string;
  status: EventStatus;
  titleEn: string;
  titleAr: string;
  startsAt: string;
  durationMin: number;
  past: boolean;
  recordingUrl: string | null;
  topics: string[];
  /** Null when they were the session's main speaker; otherwise what they did (host, guest). */
  role: EventSpeakerRole | null;
}

/** One course on a speaker's page. */
export interface SpeakerCourseDto {
  slug: string;
  titleEn: string;
  titleAr: string;
  availability: CourseAvailability;
  completed: boolean;
  cohortNumber: number | null;
  startDate: string | null;
  endDate: string | null;
}

export interface PublicSpeakerDto {
  slug: string;
  name: string;
  nameAr: string | null;
  titleEn: string;
  titleAr: string | null;
  bioEn: string;
  bioAr: string | null;
  photoUrl: string | null;
  linkedinUrl: string | null;
  githubUrl: string | null;
  /** Newest first. */
  events: SpeakerEventDto[];
  courses: SpeakerCourseDto[];
  updatedAt: string;
}

// ------------------------------------------------------------------ recordings library

export const recordingsQuerySchema = z.object({
  topic: topicSchema.optional().or(z.literal('').transform(() => undefined)),
  q: z.string().trim().max(100).optional(),
});
export type RecordingsQuery = z.infer<typeof recordingsQuerySchema>;

/** A past live session or a course lesson with a public recording. */
export interface RecordingDto {
  /** Stable key: "event:{slug}" or "course:{courseSlug}:{order}". */
  id: string;
  kind: 'event' | 'course';
  /** Page on this site, without the locale: /sessions/{slug} or /courses/{slug}. */
  path: string;
  titleEn: string;
  titleAr: string;
  /** Course lessons: the course and the lesson number. */
  course: { slug: string; titleEn: string; titleAr: string; order: number } | null;
  startsAt: string;
  durationMin: number;
  topics: string[];
  recordingUrl: string;
  /** Set for YouTube recordings (played in place); other links open in a new tab. */
  youtubeId: string | null;
  speakers: SpeakerRefDto[];
}

/** GET /recordings/search: ids of the matching recordings, newest first. */
export interface RecordingSearchDto {
  ids: string[];
}

export interface RecordingsDto {
  /** Newest first. */
  items: RecordingDto[];
  /** Every tag in the library with its count (ignores the current filter, so the chips stay put). */
  topics: { tag: string; count: number }[];
}

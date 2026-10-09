import type { CourseAvailability, CourseSummaryDto, Locale, RecordingDto, SpeakerRefDto } from '@academy/shared';
import { pick } from './sessions';

/**
 * Learning paths: ordered routes through academy courses and free recordings.
 * Edit this list to add a path or change its steps. A step points at a real course
 * (by slug) or a past live session with a recording (by its session slug); a step
 * whose course or recording isn't public is left out, so a path never links to a
 * page that doesn't exist.
 */
export type PathStepRef = { kind: 'course'; slug: string } | { kind: 'recording'; slug: string };

export interface LearningPath {
  slug: string;
  title: { en: string; ar: string };
  /** One line for menus and cards. */
  tagline: { en: string; ar: string };
  /** The path page's introduction. */
  summary: { en: string; ar: string };
  steps: PathStepRef[];
}

export const LEARNING_PATHS: readonly LearningPath[] = [
  {
    slug: 'mlops-engineer',
    title: { en: 'MLOps Engineer path', ar: 'مسار مهندس MLOps' },
    tagline: { en: 'From containers to operating LLMs', ar: 'من الحاويات إلى تشغيل النماذج اللغوية الكبيرة' },
    summary: {
      en: 'Containers, CI/CD, production ML, Kubernetes and LLMOps, in that order: academy courses and free recordings, one step at a time.',
      ar: 'الحاويات ثم CI/CD ثم تعلم الآلة في بيئة الإنتاج ثم Kubernetes ثم LLMOps، بهذا الترتيب: دورات الأكاديمية وتسجيلات مجانية، خطوة بخطوة.',
    },
    steps: [
      { kind: 'recording', slug: 'docker-deep-dive' },
      { kind: 'recording', slug: 'hands-on-cicd-github-actions' },
      { kind: 'course', slug: 'mlops-practitioner' },
      { kind: 'course', slug: 'kubernetes' },
      { kind: 'course', slug: 'llmops' },
    ],
  },
  {
    slug: 'kubernetes-for-ml',
    title: { en: 'Kubernetes for ML path', ar: 'مسار Kubernetes لتعلم الآلة' },
    tagline: { en: 'Containers to safe model releases', ar: 'من الحاويات إلى إطلاق النماذج بأمان' },
    summary: {
      en: 'Start with Docker, learn the deployment strategies teams use to release models safely, then run ML workloads on Kubernetes.',
      ar: 'ابدأ بـ Docker، وتعلّم استراتيجيات النشر التي تستخدمها الفرق لإطلاق النماذج بأمان، ثم شغّل أحمال تعلم الآلة على Kubernetes.',
    },
    steps: [
      { kind: 'recording', slug: 'docker-deep-dive' },
      { kind: 'recording', slug: 'kubernetes-deployment-strategies-part-1' },
      { kind: 'recording', slug: 'kubernetes-deployment-strategies-part-2' },
      { kind: 'course', slug: 'kubernetes' },
    ],
  },
  {
    slug: 'production-python',
    title: { en: 'Production Python for MLOps path', ar: 'مسار Python للإنتاج في MLOps' },
    tagline: { en: 'Tooling, APIs and caching for ML services', ar: 'الأدوات والواجهات البرمجية والتخزين المؤقت لخدمات تعلم الآلة' },
    summary: {
      en: 'Modern Python tooling, a clean codebase in CI, then the backend pieces most ML services need: an API and a cache.',
      ar: 'أدوات Python الحديثة، وشيفرة نظيفة في CI، ثم المكوّنات الخلفية التي تحتاجها معظم خدمات تعلم الآلة: واجهة برمجية وذاكرة تخزين مؤقت.',
    },
    steps: [
      { kind: 'recording', slug: 'uv-for-legacy-python-projects' },
      { kind: 'recording', slug: 'ruff-python-linting-formatting-ci' },
      { kind: 'recording', slug: 'hands-on-fastapi-backend-for-mlops' },
      { kind: 'recording', slug: 'redis-for-semantic-caching' },
    ],
  },
];

export function findPath(slug: string): LearningPath | undefined {
  return LEARNING_PATHS.find((p) => p.slug === slug);
}

/** Where a step stands for everyone (not per student). */
export type StepStatus = 'open' | 'upcoming' | 'completed' | 'closed' | 'recording';

export interface ResolvedStep {
  kind: 'course' | 'recording';
  slug: string;
  /** Page on this site, without the locale. */
  path: string;
  title: string;
  description: string | null;
  status: StepStatus;
  /** Course instructors or the recording's speakers, by name. */
  people: string[];
  /** Recordings: when it was recorded and how long it is. */
  date: string | null;
  durationMin: number | null;
}

export function courseStatus(c: Pick<CourseSummaryDto, 'completed' | 'availability'>): StepStatus {
  if (c.completed) return 'completed';
  const map: Record<CourseAvailability, StepStatus> = { OPEN: 'open', UPCOMING: 'upcoming', CLOSED: 'closed' };
  return map[c.availability];
}

const speakerNames = (locale: Locale, speakers: SpeakerRefDto[]) => speakers.map((s) => pick(locale, s.name, s.nameAr));

/** The path's steps that exist on the site, in order. */
export function resolveSteps(path: LearningPath, courses: CourseSummaryDto[], recordings: RecordingDto[], locale: Locale): ResolvedStep[] {
  return path.steps.flatMap((ref): ResolvedStep[] => {
    if (ref.kind === 'course') {
      const c = courses.find((x) => x.slug === ref.slug);
      if (!c) return [];
      return [
        {
          kind: 'course',
          slug: c.slug,
          path: `/courses/${c.slug}`,
          title: pick(locale, c.titleEn, c.titleAr),
          description: pick(locale, c.shortDescriptionEn, c.shortDescriptionAr) || null,
          status: courseStatus(c),
          people: c.instructorNames,
          date: null,
          durationMin: null,
        },
      ];
    }
    const r = recordings.find((x) => x.kind === 'event' && x.id === `event:${ref.slug}`);
    if (!r) return [];
    return [
      {
        kind: 'recording',
        slug: ref.slug,
        path: r.path,
        title: pick(locale, r.titleEn, r.titleAr),
        description: null,
        status: 'recording',
        people: speakerNames(locale, r.speakers),
        date: r.startsAt,
        durationMin: r.durationMin,
      },
    ];
  });
}

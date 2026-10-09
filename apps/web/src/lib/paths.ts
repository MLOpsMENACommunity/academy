import type { CourseAvailability, CourseSummaryDto, Locale, RecordingDto, SpeakerRefDto } from '@academy/shared';
import { pick } from './sessions';

/**
 * Learning paths: ordered routes through academy courses and free recordings.
 * Edit this list to add a path or change its steps. A step points at a real course
 * (by slug), a past live session with a recording (by its session slug), a lesson of a
 * course with public recordings, or a YouTube video. A course or session step that
 * isn't public is left out, so a path never links to a page that doesn't exist; a
 * session or lesson step with a `youtube` fallback links to the video instead.
 */
export type StepFormat = 'live' | 'video';
export type StepLink = { kind: 'slides' | 'code'; url: string };
type Text = { en: string; ar: string };
/** Optional details shown on the path page (override the archive's when set). */
export interface StepDetails {
  /** As published on YouTube; English titles are used in both languages unless `ar` is given. */
  title?: { en: string; ar?: string };
  format?: StepFormat;
  /**
   * Speaker slugs; [] for none. Names (and their speaker pages) come from the speaker
   * records the API returns with the recordings, so a rename flows through.
   */
  speakers?: string[];
  description?: Text;
  /** Public slides and code only (never invite links, forms or spreadsheets). */
  links?: StepLink[];
  /** The video, for a step with no page on this site. */
  youtube?: string;
}
export type PathStepRef = (
  | { kind: 'course'; slug: string }
  | { kind: 'recording'; slug: string }
  | { kind: 'lesson'; course: string; order: number }
  | { kind: 'video' }
) &
  StepDetails;

export interface LearningPath {
  slug: string;
  title: { en: string; ar: string };
  /** One line for menus and cards. */
  tagline: { en: string; ar: string };
  /** The path page's introduction. */
  summary: { en: string; ar: string };
  steps: PathStepRef[];
  /** false: steps show no recording date (the order isn't chronological). */
  showDates?: boolean;
}

const AYA = 'aya-nasser-salama';
const COURSE_REPO = 'https://github.com/MLOpsMENACommunity/mlops_practitioner_course';

/**
 * The MLOps Engineer path, in the owner's order (9 Oct 2026; not release order, and no dates shown).
 * Left out on purpose: LLM Inference Engines, From DevOps to MLOps, uv, Ruff, Redis, and
 * MLOps #5 (not public). Order is pinned by a test (paths.test.ts).
 */
const MLOPS_ENGINEER_STEPS: PathStepRef[] = [
  {
    kind: 'video',
    title: { en: 'MLOps Course Guide' },
    format: 'video',
    speakers: [],
    description: {
      en: 'How The MLOps Practitioner works: timeline, commitment and certificates, prerequisites, the two project tracks (Arabic sentiment analysis and Arabic legal RAG) and the submission timeline.',
      ar: 'كيف تسير دورة The MLOps Practitioner: الجدول الزمني والالتزام والشهادات، والمتطلبات المسبقة، ومساري المشروع (تحليل المشاعر بالعربية وRAG للنصوص القانونية العربية)، ومواعيد التسليم.',
    },
    links: [{ kind: 'slides', url: 'https://docs.google.com/presentation/d/1idFAhLYHVRDu89PK7SvQP95HJmxZgFYBJOkM8BTbnuk/edit?usp=sharing' }],
    youtube: 'https://www.youtube.com/watch?v=n0dv6KZHq9M',
  },
  {
    kind: 'lesson',
    course: 'mlops-practitioner',
    order: 1,
    title: { en: 'MLOps #1: From Notebook to Production-Ready ML Code' },
    format: 'live',
    speakers: [AYA],
    description: {
      en: 'Turn notebook code into a tested, containerised ML API: packaging, FastAPI and Pydantic, serialisation formats, Docker multi-stage builds and Compose, structured logging and pytest.',
      ar: 'حوّل كود الـ Notebook إلى واجهة API لنموذج مختبرة وداخل حاوية: حزم المشروع، وFastAPI وPydantic، وصيغ حفظ النماذج، وبناء Docker متعدد المراحل وCompose، والسجلات المنظمة، وpytest.',
    },
    links: [
      { kind: 'slides', url: 'https://docs.google.com/presentation/d/1ZPqFlrnJuruHvWlt4HG--zixQPQLMBlx2LLGSop8W70/edit?usp=sharing' },
      { kind: 'code', url: COURSE_REPO },
    ],
    youtube: 'https://www.youtube.com/watch?v=rJFIn83w0Dc',
  },
  {
    kind: 'recording',
    slug: 'hands-on-fastapi-backend-for-mlops',
    title: { en: 'Hands-on FastAPI and backend for MLOps' },
    format: 'video',
    speakers: ['mohamed-samy'],
    description: {
      en: 'API fundamentals for AI engineers: Pydantic, FastAPI with SQLAlchemy, async and dependency injection, rate limiting and auth, streaming LLM responses, FastAPI with vLLM, and Docker with PostgreSQL.',
      ar: 'أساسيات الواجهات البرمجية لمهندسي الذكاء الاصطناعي: Pydantic، وFastAPI مع SQLAlchemy، والبرمجة غير المتزامنة وحقن الاعتماديات، وتحديد المعدّل والمصادقة، وبثّ ردود النماذج اللغوية، وFastAPI مع vLLM، وDocker مع PostgreSQL.',
    },
    links: [
      { kind: 'slides', url: 'https://docs.google.com/presentation/d/14hZoknPEi1yFTUX_tzYtMeqSmvoAwwjMBuTr6vOR88c/edit?usp=sharing' },
      { kind: 'code', url: 'https://github.com/MohamedSamy853/Hands-on-FastAPI-and-backend-ForMLOps/tree/master' },
    ],
    youtube: 'https://www.youtube.com/watch?v=asIGEjkUQCI',
  },
  {
    kind: 'recording',
    slug: 'docker-deep-dive',
    title: { en: 'Hands-on Docker' },
    format: 'video',
    speakers: ['mahmoud-sharif'],
    description: {
      en: 'Hands-on Docker for building ML systems: containers and images, networking and volumes, Dockerfile best practices and security, and Docker Compose.',
      ar: 'Docker عمليًا لبناء أنظمة تعلّم الآلة: الحاويات والصور، والشبكات ووحدات التخزين، وأفضل ممارسات Dockerfile والأمان، وDocker Compose.',
    },
    youtube: 'https://www.youtube.com/watch?v=AFcoKDtyhec',
  },
  {
    kind: 'lesson',
    course: 'mlops-practitioner',
    order: 2,
    title: { en: 'MLOps #2: MLflow, DVC & GitHub Actions' },
    format: 'live',
    speakers: [AYA],
    description: {
      en: 'Experiment tracking and the model registry with MLflow, data and model versioning with DVC, and a GitHub Actions pipeline from training to a pushed image, with continuous training.',
      ar: 'تتبّع التجارب وسجلّ النماذج باستخدام MLflow، وإدارة نسخ البيانات والنماذج باستخدام DVC، وخط GitHub Actions من التدريب حتى رفع الصورة، مع التدريب المستمر.',
    },
    links: [
      { kind: 'slides', url: 'https://docs.google.com/presentation/d/1xXunVxrgzirYkoO7f3PTvEnqrNkq8sl3PGCe8n5Nb_M/edit?usp=sharing' },
      { kind: 'code', url: `${COURSE_REPO}/tree/main/session_2` },
    ],
    youtube: 'https://www.youtube.com/watch?v=slxkWpCAqI8',
  },
  {
    kind: 'recording',
    slug: 'hands-on-cicd-github-actions',
    title: { en: 'Hands-on CI/CD pipelines' },
    format: 'video',
    speakers: ['abdallah-almalawany'],
    description: {
      en: 'Build a working GitHub Actions workflow step by step: triggers, jobs, matrices, runners, caching, secrets and approval gates, with supply-chain security in mind.',
      ar: 'ابنِ workflow يعمل على GitHub Actions خطوة بخطوة: المشغّلات والمهام والـ matrix والـ runners والتخزين المؤقت والأسرار وبوابات الموافقة، مع مراعاة أمن سلسلة التوريد.',
    },
    youtube: 'https://www.youtube.com/watch?v=pkZcMjF1znU',
  },
  {
    kind: 'lesson',
    course: 'mlops-practitioner',
    order: 3,
    title: { en: 'MLOps #3: Model Serving at Scale' },
    format: 'video',
    speakers: [AYA],
    description: {
      en: 'Inference patterns and the serving stack: Airflow orchestration, batch and streaming, BentoML, Triton and TensorRT, ONNX Runtime and OpenVINO, vLLM, load testing, and canary and shadow releases.',
      ar: 'أنماط الاستدلال ومنظومة تقديم النماذج: التنسيق بـ Airflow، والمعالجة الدفعية والمتدفقة، وBentoML وTriton وTensorRT، وONNX Runtime وOpenVINO، وvLLM، واختبار الحِمل، والإصدار التدريجي (Canary) وShadow.',
    },
    links: [
      { kind: 'slides', url: 'https://docs.google.com/presentation/d/1AU9q6sHmLBuU5VSbPexlI23PzwfbUwCzVrZUrXdvFg/edit?usp=sharing' },
      { kind: 'code', url: `${COURSE_REPO}/tree/main/session_3` },
    ],
    youtube: 'https://www.youtube.com/watch?v=Gnro52bcUsg',
  },
  {
    kind: 'recording',
    slug: 'kubernetes-deployment-strategies-part-1',
    title: { en: 'Kubernetes Deployment Strategies Part 1: Recreate, Rolling Update, Blue-Green' },
    format: 'video',
    speakers: [],
    description: {
      en: 'Recreate, Rolling Update and Blue-Green: when each fits, and how each one moves traffic from the old version to the new.',
      ar: 'Recreate وRolling Update وBlue-Green: متى تناسب كل طريقة، وكيف تنقل كلٌّ منها الحركة من النسخة القديمة إلى الجديدة.',
    },
    links: [{ kind: 'slides', url: 'https://docs.google.com/presentation/d/1KyEEb5cQp9vQOV2mVLGCnlm61HbgytSU8tCAPY9RkT8/edit' }],
    youtube: 'https://www.youtube.com/watch?v=43MGkzT5bYQ',
  },
  {
    kind: 'recording',
    slug: 'kubernetes-deployment-strategies-part-2',
    title: { en: 'Kubernetes Deployment Strategies Part 2: Canary, A/B Routing, Shadow Traffic' },
    format: 'video',
    speakers: [],
    description: {
      en: 'Canary releases, A/B routing to user groups, and mirroring shadow traffic to a new version.',
      ar: 'الإصدار التدريجي (Canary)، وتوجيه A/B لمجموعات المستخدمين، ونسخ الحركة (Shadow Traffic) إلى النسخة الجديدة.',
    },
    links: [{ kind: 'slides', url: 'https://docs.google.com/presentation/d/1KyEEb5cQp9vQOV2mVLGCnlm61HbgytSU8tCAPY9RkT8/edit' }],
    youtube: 'https://www.youtube.com/watch?v=Wx9RfYuO3WY',
  },
  {
    kind: 'lesson',
    course: 'mlops-practitioner',
    order: 4,
    title: { en: 'MLOps #4: Observability and Drift Detection' },
    format: 'live',
    speakers: [AYA],
    description: {
      en: 'Why models fail quietly: data, concept, prediction and label drift; Prometheus, Grafana and Evidently AI; real production incidents; Langfuse tracing and RAGAS evaluation.',
      ar: 'لماذا تفشل النماذج بصمت: انحراف البيانات والمفاهيم والتنبؤات والتسميات؛ وPrometheus وGrafana وEvidently AI؛ وحوادث إنتاج حقيقية؛ والتتبّع بـ Langfuse والتقييم بـ RAGAS.',
    },
    links: [
      { kind: 'slides', url: 'https://docs.google.com/presentation/d/1Ks0-0fyQ7fYVTAtn2sGyMj5xocNymrQSrpfB4hM-dI/edit?usp=sharing' },
      { kind: 'code', url: COURSE_REPO },
    ],
    youtube: 'https://www.youtube.com/watch?v=g79F3WLZKSQ',
  },
  {
    kind: 'recording',
    slug: 'prometheus-grafana-monitoring-stack-part-1',
    title: { en: 'Prometheus & Grafana Monitoring Stack: Architecture, Metrics & PromQL (Part 1)' },
    format: 'video',
    speakers: ['mahmoud-sharif'],
    description: {
      en: 'Monitoring foundations: metrics, logs and traces; the Prometheus pull model, discovery and storage; metric types and exporters; and PromQL.',
      ar: 'أسس المراقبة: المقاييس والسجلات والتتبّعات؛ ونموذج السحب في Prometheus واكتشاف الأهداف والتخزين؛ وأنواع المقاييس والـ exporters؛ وPromQL.',
    },
    links: [
      { kind: 'slides', url: 'https://drive.google.com/file/d/1yum5d7mPu3Vk0elZfz_pwm5JcNfTOTFF/view' },
      { kind: 'code', url: 'https://github.com/mahmoudSh58/prometheus_session' },
    ],
    youtube: 'https://www.youtube.com/watch?v=n9iphdrNfr8',
  },
  {
    kind: 'video',
    title: { en: 'MLOps Practitioner Course: Final project submission' },
    format: 'video',
    speakers: [],
    description: {
      en: 'How to submit your final project for The MLOps Practitioner.',
      ar: 'كيف تسلّم مشروعك النهائي في دورة The MLOps Practitioner.',
    },
    youtube: 'https://www.youtube.com/watch?v=s2TxWGGYHbQ',
  },
];

export const LEARNING_PATHS: readonly LearningPath[] = [
  {
    slug: 'mlops-engineer',
    title: { en: 'MLOps Engineer path', ar: 'مسار مهندس MLOps' },
    tagline: { en: 'The MLOps Practitioner and its hands-on sessions', ar: 'دورة The MLOps Practitioner وجلساتها العملية' },
    summary: {
      en: 'The MLOps Practitioner course and the hands-on community sessions around it, in the order to take them: from notebook code to serving, Kubernetes releases and monitoring.',
      ar: 'دورة The MLOps Practitioner والجلسات العملية للمجتمع حولها، بالترتيب المقترح لمتابعتها: من كود الـ Notebook إلى تقديم النماذج وإصدارات Kubernetes والمراقبة.',
    },
    steps: MLOPS_ENGINEER_STEPS,
    showDates: false,
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
  /** 'video': no page on this site, `path` is the YouTube URL. */
  kind: 'course' | 'recording' | 'lesson' | 'video';
  /** Unique within a path (React keys, progress lookups for courses). */
  slug: string;
  /** Page on this site without the locale (may end in #lesson-N), or an absolute URL when `external`. */
  path: string;
  external: boolean;
  title: string;
  description: string | null;
  status: StepStatus;
  /** Course instructors or the recording's speakers, by name. */
  people: string[];
  /** The same people with their speaker page slug, when they have one. */
  speakers: { slug: string | null; name: string }[];
  /** Recordings: when it was recorded (or released) and how long it is. */
  date: string | null;
  durationMin: number | null;
  /** "Live" or "Video" badge, when the path says. */
  format: StepFormat | null;
  links: StepLink[];
}

/** A step's link for this locale: the site page, or the external video as is. */
export const stepHref = (s: Pick<ResolvedStep, 'path' | 'external'>, locale: Locale) => (s.external ? s.path : `/${locale}${s.path}`);

export function courseStatus(c: Pick<CourseSummaryDto, 'completed' | 'availability'>): StepStatus {
  if (c.completed) return 'completed';
  const map: Record<CourseAvailability, StepStatus> = { OPEN: 'open', UPCOMING: 'upcoming', CLOSED: 'closed' };
  return map[c.availability];
}

const speakerNames = (locale: Locale, speakers: SpeakerRefDto[]) => speakers.map((s) => pick(locale, s.name, s.nameAr));

/** The path's steps that exist on the site (or on YouTube, for steps with a video fallback), in order. */
export function resolveSteps(path: LearningPath, courses: CourseSummaryDto[], recordings: RecordingDto[], locale: Locale): ResolvedStep[] {
  // Every speaker the API knows, by slug: the same records the speaker pages show.
  const known = new Map(recordings.flatMap((r) => r.speakers).flatMap((sp) => (sp.slug ? [[sp.slug, sp] as const] : [])));
  const named = (list: SpeakerRefDto[]) => list.map((sp) => ({ slug: sp.slug, name: pick(locale, sp.name, sp.nameAr) }));
  return path.steps.flatMap((ref, i): ResolvedStep[] => {
    const title = ref.title ? (locale === 'ar' && ref.title.ar ? ref.title.ar : ref.title.en) : null;
    const details = {
      description: ref.description?.[locale] ?? null,
      format: ref.format ?? null,
      links: ref.links ?? [],
    };
    // A slug the API doesn't return (not imported yet, API down) is left out rather than guessed.
    const listed = ref.speakers && named(ref.speakers.flatMap((slug) => known.get(slug) ?? []));
    const people = listed?.map((sp) => sp.name);
    if (ref.kind === 'course') {
      const c = courses.find((x) => x.slug === ref.slug);
      if (!c) return [];
      return [
        {
          kind: 'course',
          slug: c.slug,
          path: `/courses/${c.slug}`,
          external: false,
          title: title ?? pick(locale, c.titleEn, c.titleAr),
          status: courseStatus(c),
          people: people ?? c.instructorNames,
          speakers: listed ?? c.instructorNames.map((name) => ({ slug: null, name })),
          date: null,
          durationMin: null,
          ...details,
          description: details.description ?? (pick(locale, c.shortDescriptionEn, c.shortDescriptionAr) || null),
        },
      ];
    }
    const r =
      ref.kind === 'recording'
        ? recordings.find((x) => x.kind === 'event' && x.id === `event:${ref.slug}`)
        : ref.kind === 'lesson'
          ? recordings.find((x) => x.kind === 'course' && x.id === `course:${ref.course}:${ref.order}`)
          : undefined;
    if (r) {
      return [
        {
          kind: ref.kind === 'lesson' ? 'lesson' : 'recording',
          slug: ref.kind === 'lesson' ? `${ref.course}:${ref.order}` : r.id.slice('event:'.length),
          path: r.course ? `${r.path}#lesson-${r.course.order}` : r.path,
          external: false,
          title: title ?? pick(locale, r.titleEn, r.titleAr),
          status: 'recording',
          people: people ?? speakerNames(locale, r.speakers),
          speakers: listed ?? named(r.speakers),
          date: path.showDates === false ? null : r.startsAt,
          durationMin: r.durationMin,
          ...details,
        },
      ];
    }
    // Not on this site (or not public): the YouTube video, if the path gives one.
    if (!ref.youtube || !title) return [];
    return [
      {
        kind: 'video',
        slug: `video:${i + 1}`,
        path: ref.youtube,
        external: true,
        title,
        status: 'recording',
        people: people ?? [],
        speakers: listed ?? [],
        date: null,
        durationMin: null,
        ...details,
      },
    ];
  });
}

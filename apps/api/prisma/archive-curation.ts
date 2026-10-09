/**
 * Hand-curated input to archive-convert.ts: Arabic copy, and the corrections the
 * community website's data needed. The website's English data stays the source;
 * everything here is either Arabic or a fact checked against the YouTube channel
 * (October 2026), with the reason next to it.
 *
 * Arabic marked REVIEW in a comment was written for the archive (no Arabic existed on
 * the website); the rest is copied from the website's Arabic edition
 * (src/lib/content-i18n.ts).
 */

/** A person's part in a session besides its main speaker (from the owner's list of past sessions). */
export interface CuratedCoSpeaker {
  name: string;
  role: 'HOST' | 'GUEST' | 'SPEAKER';
}

/**
 * What the owner's list of past sessions (9 Oct 2026) says a session taught, why to attend
 * and what you needed. It replaces the website's topic list in the description.
 */
export interface SessionDetails {
  learnEn: string[];
  learnAr: string[];
  /** One item: a paragraph. Several: a list. */
  whyEn: string[];
  whyAr: string[];
  requirementsEn?: string[];
  requirementsAr?: string[];
}

export interface CuratedSession {
  /** Corrects the website's date (the owner's list is authoritative for dates). */
  startsAt?: string;
  coSpeakers?: CuratedCoSpeaker[];
  details?: SessionDetails;
  titleAr?: string;
  /** Replaces the subtitle as the first paragraph. */
  summaryEn?: string;
  summaryAr?: string;
  noteAr?: string;
  topicsAr?: string[];
  /** Filter tags. */
  tags: string[];
  /** YouTube id of the recording when the website has none (with the reason). */
  youtubeId?: string;
  youtubeIdReason?: string;
}

/** A YouTube video with no session on the website, imported as a past session. */
export interface CuratedVideo {
  slug: string;
  titleEn: string;
  titleAr: string;
  descriptionEn: string;
  descriptionAr: string;
  tags: string[];
  /** A speaker with a page (by name; see speakerProfiles). */
  speaker?: string;
  coSpeakers?: CuratedCoSpeaker[];
  details?: SessionDetails;
  /** The session's date when it isn't the upload time (the owner's list is authoritative for dates). */
  startsAt?: string;
  /** A one-off speaker without a page. */
  speakerName?: string;
  speakerNameAr?: string;
  speakerLinkedinUrl?: string;
}

/** A past session that is neither on the website nor on YouTube yet, from the owner's list. */
export interface CuratedExtraSession {
  slug: string;
  titleEn: string;
  titleAr: string;
  speaker: string;
  coSpeakers: CuratedCoSpeaker[];
  startsAt: string;
  durationMin: number;
  tags: string[];
  details: SessionDetails;
}

export interface CuratedLesson {
  /** Lesson number in the course. */
  n: number;
  /** The syllabus week it teaches (data/mlops-practitioner.ts `outline`). */
  week: number;
  titleEn: string;
  titleAr: string;
  airsAt: string;
  /** Null when there is no public recording. */
  youtubeId: string | null;
  tags: string[];
  /** Arabic for the week's lesson list, in the same order. */
  topicsAr: string[];
}

// ------------------------------------------------------------------ speakers

/**
 * Speaker profiles: Arabic, plus English the website lacks. Roles and bios are short
 * factual lines from the owner's list of past sessions (9 Oct 2026); nothing is made up,
 * and a field we don't know stays empty (pages hide it). Arabic names: REVIEW.
 */
export interface SpeakerProfile {
  nameAr?: string;
  /** Replaces the website's role. */
  titleEn?: string;
  titleAr?: string;
  /** For people without a bio on the website's team page. */
  bioEn?: string;
  bioAr?: string;
}

export const speakerProfiles: Record<string, SpeakerProfile> = {
  'Aya Nasser Salama': {
    nameAr: 'آية ناصر سلامة',
    titleAr: 'مؤسِّسة مجتمع MLOps MENA ومهندسة MLOps أولى',
    bioAr:
      'مهندسة MLOps وLLMOps أولى بخبرة تتجاوز 6 سنوات في الذكاء الاصطناعي. في Unifonic هي المرجع المركزي لدعم MLOps/LLMOps عبر فرق الذكاء الاصطناعي — منتجات وكيلة باستخدام LangGraph وMCP، وتقييم ومراقبة النماذج اللغوية، وخدمة نماذج تتجاوز 30 مليار معامل على Kubernetes. صمّمت وتدرّس مادة «Production ML Engineering» في ITI، وبنت أول نظام RAG إنتاجي في Valeo.',
  },
  // The website said "Instructor · 3+ years experience"; the owner's list says with whom.
  'Mahmoud Sharif': {
    nameAr: 'محمود شريف',
    titleEn: 'Instructor with eYouth and Mindset',
    titleAr: 'مدرّب مع eYouth وMindset',
    bioEn: '3+ years instructing with eYouth and Mindset.',
    bioAr: 'أكثر من 3 سنوات في التدريب مع eYouth وMindset.',
  },
  'Abdallah Almalawany': {
    nameAr: 'عبدالله الملواني',
    titleEn: 'DevOps Engineer',
    titleAr: 'مهندس DevOps',
  },
  'Mohamed Rashad': {
    nameAr: 'محمد رشاد',
    titleEn: 'Co-Founder and CTO, DevisionX',
    titleAr: 'شريك مؤسس ومدير تقني، DevisionX',
    bioEn:
      "Co-Founder and CTO of DevisionX. His on-prem Llama-2 work was featured on Meta's Engineering Blog.",
    bioAr:
      'شريك مؤسس ومدير تقني في DevisionX. عُرض عمله على تشغيل Llama-2 داخل المؤسسة (On-Prem) في مدونة Meta الهندسية.',
  },
  // The owner's list gives no role for Mohamed Samy: the page shows his name only.
  'Mohamed Samy': { nameAr: 'محمد سامي' },
  // Bio and LinkedIn from the website's team page; the role from the owner's list.
  'Mariam Qotob': {
    nameAr: 'مريم قطب',
    titleEn: 'AI Engineer',
    titleAr: 'مهندسة ذكاء اصطناعي',
    bioAr:
      'مهندسة ذكاء اصطناعي وتعلّم آلة، حاصلة على ماجستير مهني في الذكاء الاصطناعي من جامعة Queen’s، وتعمل عبر مسار تعلّم الآلة كاملًا مع خبرة تطبيقية في النماذج اللغوية الكبيرة (LLMs) وRAG. تعمل حاليًا مساعدة تدريس في مبادرة Digilians.',
  },
};

// ------------------------------------------------------------------ free sessions (data/sessions.ts)

export const sessions: Record<string, CuratedSession> = {
  'docker-deep-dive': {
    // The website had 20:00 Cairo; the owner's list: Saturday 22 Aug, 4:00 PM UTC (7:00 PM Cairo).
    startsAt: '2026-08-22T19:00:00+03:00',
    coSpeakers: [
      { name: 'Aya Nasser Salama', role: 'HOST' },
      { name: 'Mariam Qotob', role: 'GUEST' },
    ],
    details: {
      learnEn: [
        'Virtualization vs containerization, and Docker architecture.',
        'Docker images and containers in practice.',
        'Docker networking and storage/volumes.',
        'Writing a Dockerfile with best practices, plus Docker security.',
        'Docker Compose for multi-container setups.',
      ],
      learnAr: [
        'المحاكاة الافتراضية مقابل الحاويات، ومعمارية Docker.',
        'صور Docker وحاوياته عمليًا.',
        'الشبكات والتخزين ووحدات التخزين (Volumes) في Docker.',
        'كتابة Dockerfile بأفضل الممارسات، وأمان Docker.',
        'Docker Compose لتشغيل عدة حاويات معًا.',
      ],
      whyEn: [
        "Deeper hands-on Docker for anyone whose Docker part of the MLOps course isn't solid yet, focused on what you need when building ML systems. Delivered by Mahmoud Sharif (3+ years instructing with eYouth and Mindset). Live on Google Meet; MLOps Practitioner students could ask directly.",
      ],
      whyAr: [
        'تعمّق عملي في Docker لكل من لم يتمكّن بعد من جزء Docker في دورة MLOps، مع التركيز على ما تحتاجه عند بناء أنظمة تعلّم الآلة. قدّمها محمود شريف (أكثر من 3 سنوات في التدريب مع eYouth وMindset). بثّ مباشر على Google Meet، وكان بإمكان طلاب MLOps Practitioner طرح أسئلتهم مباشرة.',
      ],
      // The list's "Google Meet limited to 150 engineers (join early)" was for the live session only.
      requirementsEn: [
        'Docker installed (recommended).',
        'Basic terminal familiarity (nice to have).',
        'No prior Docker or Kubernetes background needed.',
      ],
      requirementsAr: [
        'Docker مثبّت على جهازك (يُنصح به).',
        'إلمام أساسي بالطرفية (Terminal) (ميزة إضافية).',
        'لا تحتاج خبرة سابقة في Docker أو Kubernetes.',
      ],
    },
    titleAr: 'تعمّق في Docker', // REVIEW
    summaryAr: 'Docker: أساس البناء لـ MLOps — اليوم الأول',
    noteAr: 'لا متطلبات سابقة — لا تحتاج خبرة مسبقة بـ Docker أو Kubernetes.',
    topicsAr: [
      'المحاكاة الافتراضية مقابل الحاويات',
      'معمارية Docker',
      'الصور والحاويات',
      'الشبكات',
      'التخزين ووحدات التخزين',
      'كتابة ملف Dockerfile',
      'الأمان',
      'Docker Compose',
    ],
    tags: ['docker', 'mlops'],
  },
  'hands-on-cicd-github-actions': {
    coSpeakers: [{ name: 'Aya Nasser Salama', role: 'HOST' }],
    details: {
      learnEn: [
        'Writing a workflow from scratch: `.github/workflows/ci.yml`, triggers with `on:`, jobs from `run:` and `uses:`.',
        'Ordering and parallelism: `needs:` and `strategy: matrix`.',
        'Choosing runners: GitHub-hosted vs self-hosted, and `container:` jobs.',
        'Artifacts, `actions/cache`, repository secrets and scoped `GITHUB_TOKEN` permissions.',
        'Controlling execution: `if:` conditions, environment approval gates, PR checks, schedules, `continue-on-error`.',
      ],
      learnAr: [
        'كتابة workflow من الصفر: ملف `.github/workflows/ci.yml`، والتشغيل عبر `on:`، والمهام عبر `run:` و`uses:`.',
        'الترتيب والتوازي: `needs:` و`strategy: matrix`.',
        'اختيار الـ runners: المستضافة على GitHub مقابل المستضافة ذاتيًا، ومهام `container:`.',
        'الملفات الناتجة (Artifacts)، و`actions/cache`، وأسرار المستودع، وصلاحيات `GITHUB_TOKEN` محددة النطاق.',
        'التحكم في التنفيذ: شروط `if:`، وبوابات الموافقة على البيئات، وفحوص الـ PR، والجدولة، و`continue-on-error`.',
      ],
      whyEn: [
        'Build a working `ci.yml` incrementally.',
        'Understand why workflows are correct, not just green.',
        'Real trade-offs: runners, caching, approval gates.',
        'Supply-chain security: pin actions to SHAs, least-privilege permissions, `pull_request_target` risks.',
        'Ruff + pre-commit enforced both locally and in CI.',
        'Live Q&A.',
      ],
      whyAr: [
        'بناء ملف `ci.yml` يعمل خطوة بخطوة.',
        'فهم لماذا يكون الـ workflow صحيحًا، لا مجرد ناجح بعلامة خضراء.',
        'موازنات حقيقية: الـ runners والتخزين المؤقت وبوابات الموافقة.',
        'أمن سلسلة التوريد: تثبيت الـ actions على SHA، وأقل الصلاحيات اللازمة، ومخاطر `pull_request_target`.',
        'فرض Ruff وpre-commit محليًا وفي CI.',
        'أسئلة وأجوبة مباشرة.',
      ],
      requirementsEn: [
        'Git fundamentals (branching, commits, merge requests).',
        'Linux command line and Bash basics.',
        'Docker basics (build, tag, push images).',
      ],
      requirementsAr: [
        'أساسيات Git (الفروع والـ commits وطلبات الدمج).',
        'سطر أوامر Linux وأساسيات Bash.',
        'أساسيات Docker (بناء الصور ووسمها ورفعها).',
      ],
    },
    titleAr: 'CI/CD وGitHub Actions عمليًا', // REVIEW
    summaryAr: 'اخرج بملف workflow جاهز تضعه في مستودعك في نفس اليوم، لا بمجرد ملاحظات',
    noteAr: 'يفترض معرفتك بفروع Git وأساسيات Bash وبناء صورة Docker ورفعها.',
    topicsAr: [
      'كتابة ci.yml من الصفر',
      'المشغّلات والمهام والخطوات',
      'needs: وبناء المصفوفات',
      'المشغّلات المستضافة مقابل الذاتية',
      'الملفات الوسيطة والتخزين المؤقت',
      'الأسرار ونطاق GITHUB_TOKEN',
      'الشروط وبوابات الموافقة',
      'تثبيت الإجراءات على SHA',
      'Ruff وpre-commit',
    ],
    tags: ['ci-cd'],
    // The website has no recording for this session. The channel's "Hands on CI CD pipelines"
    // (3 h, uploaded 31 Aug, two days after the session) is taken to be it. CONFIRM.
    youtubeId: 'pkZcMjF1znU',
    youtubeIdReason: 'matched by title and date (uploaded two days after the session)',
  },
  'on-prem-mlops-playbook': {
    coSpeakers: [{ name: 'Aya Nasser Salama', role: 'HOST' }],
    details: {
      learnEn: [
        'Partitioning and scheduling a fixed GPU pool across training, inference and experimentation.',
        'Managing CUDA/driver versions without breaking running jobs.',
        'Monitoring utilization to catch idle or contended hardware.',
        'Designing around power, cooling and bandwidth.',
        'When on-prem is mandatory: data residency, air-gapped environments, regulation.',
      ],
      learnAr: [
        'تقسيم مجموعة ثابتة من وحدات GPU وجدولتها بين التدريب والاستدلال والتجارب.',
        'إدارة إصدارات CUDA والتعريفات دون تعطيل المهام الجارية.',
        'مراقبة الاستخدام لاكتشاف العتاد الخامل أو المتنازَع عليه.',
        'التصميم في حدود الطاقة والتبريد وعرض النطاق.',
        'متى يكون التشغيل داخل المؤسسة إلزاميًا: توطين البيانات، والبيئات المعزولة (Air-gapped)، والمتطلبات التنظيمية.',
      ],
      whyEn: [
        'In MENA, on-prem is the default for banks, telecoms, government and healthcare due to data-residency rules, while most MLOps content assumes the cloud. A production playbook from regulated deployments, plus Q&A with a CTO. For MLOps/DevOps engineers moving into AI workloads, ML engineers, and tech leads weighing cloud vs on-prem. Hosted by MLOps MENA Community in partnership with DevisionX.',
      ],
      whyAr: [
        'في منطقة الشرق الأوسط وشمال أفريقيا، التشغيل داخل المؤسسة (On-Prem) هو الأصل في البنوك وشركات الاتصالات والجهات الحكومية والقطاع الصحي بسبب قواعد توطين البيانات، بينما يفترض معظم محتوى MLOps وجود السحابة. دليل عملي للإنتاج مستخلص من بيئات خاضعة للتنظيم، مع أسئلة وأجوبة مع مدير تقني. لمهندسي MLOps وDevOps المنتقلين إلى أحمال الذكاء الاصطناعي، ومهندسي تعلّم الآلة، والقادة التقنيين الذين يوازنون بين السحابة والتشغيل داخل المؤسسة. بالشراكة بين مجتمع MLOps MENA وDevisionX.',
      ],
    },
    titleAr: 'دليل MLOps داخل المؤسسة (On-Prem)', // REVIEW
    summaryAr: 'الجسر بين DevOps التقليدي وأحمال الذكاء الاصطناعي الخاصة',
    // The website has no description; this follows the recording's YouTube description.
    summaryEn:
      'Bridging traditional DevOps and private AI workloads. Banks, manufacturers and government environments run every inference on hardware they physically control: no elastic GPU clusters, no managed scheduling, one fixed pool of GPUs shared by training, inference and experimentation. Most MLOps content quietly assumes the cloud; this session covers what changes when that assumption disappears, from GPU partitioning and scheduling to CUDA and driver versioning.',
    // REVIEW
    noteAr:
      'البنوك والمصانع والجهات الحكومية تشغّل كل عملية استدلال على عتاد تملكه فعليًا: لا عناقيد GPU مرنة ولا جدولة مُدارة، بل مجموعة ثابتة من وحدات GPU يتقاسمها التدريب والاستدلال والتجارب. معظم محتوى MLOps يفترض السحابة ضمنيًا؛ وهذه الجلسة تتناول ما يتغيّر حين يغيب هذا الافتراض، من تقسيم وحدات GPU وجدولتها إلى إدارة إصدارات CUDA والتعريفات.',
    tags: ['on-prem', 'mlops'],
  },
};

/**
 * Website sessions that are lessons of a course: imported with the course, not as a live session.
 * (The website lists lesson 3 of The MLOps Practitioner as a free session too.)
 */
export const lessonSessions: Record<string, { course: string; lesson: number }> = {
  'mlops-practitioner-3-inference-serving': { course: 'mlops-practitioner', lesson: 3 },
};

// ------------------------------------------------------------------ YouTube channel (data/generated/youtube.json)

/** Channel videos that are not sessions, with the reason. */
export const skipVideos: Record<string, string> = {
  cScwFf5q36Q:
    'Same recording as "The On-Prem MLOps Playbook" (0ta-roIGJWc, identical length to the second), re-uploaded as "From DevOps To MLOps".',
  s2TxWGGYHbQ: 'A short how-to for submitting the MLOps Practitioner final project, not a session.',
};

/** Channel videos with no session on the website: imported as past sessions, dated by their upload. */
export const videos: Record<string, CuratedVideo> = {
  '43MGkzT5bYQ': {
    slug: 'kubernetes-deployment-strategies-part-1',
    titleEn: 'Kubernetes Deployment Strategies, Part 1: Recreate, Rolling Update, Blue-Green',
    titleAr: 'استراتيجيات النشر في Kubernetes (الجزء الأول): Recreate وRolling Update وBlue-Green', // REVIEW
    descriptionEn:
      // A/B routing is Part 2; Part 1 is Recreate, Rolling Update and Blue-Green (the video's title).
      'Three Kubernetes deployment approaches: Recreate, Rolling Update and Blue-Green. When each one fits, how Recreate replaces the old version completely, how rolling updates reduce downtime during a release, and how Blue-Green runs the new version alongside the old one and switches traffic over once it is ready. Canary, A/B routing and shadow traffic follow in Part 2.\n\n[Session slides](https://docs.google.com/presentation/d/1KyEEb5cQp9vQOV2mVLGCnlm61HbgytSU8tCAPY9RkT8/edit)',
    descriptionAr:
      'ثلاث طرق للنشر في Kubernetes: Recreate وRolling Update وBlue-Green. متى تناسب كل طريقة، وكيف يستبدل Recreate النسخة القديمة بالكامل، وكيف يقلّل Rolling Update التوقف أثناء الإصدار، وكيف يشغّل Blue-Green النسخة الجديدة بجانب القديمة ثم يحوّل الحركة إليها حين تجهز. أما Canary وتوجيه A/B وShadow Traffic ففي الجزء الثاني.\n\n[شرائح الجلسة](https://docs.google.com/presentation/d/1KyEEb5cQp9vQOV2mVLGCnlm61HbgytSU8tCAPY9RkT8/edit)', // REVIEW
    tags: ['kubernetes', 'deployment'],
  },
  Wx9RfYuO3WY: {
    slug: 'kubernetes-deployment-strategies-part-2',
    titleEn: 'Kubernetes Deployment Strategies, Part 2: Canary, A/B Routing, Shadow Traffic',
    titleAr: 'استراتيجيات النشر في Kubernetes (الجزء الثاني): Canary وتوجيه A/B وShadow Traffic', // REVIEW
    descriptionEn:
      'Sending a small share of production traffic to a new version with canary releases, routing specific user groups to different versions, and mirroring traffic to a shadow deployment to test it safely.\n\n[Session slides](https://docs.google.com/presentation/d/1KyEEb5cQp9vQOV2mVLGCnlm61HbgytSU8tCAPY9RkT8/edit)',
    descriptionAr:
      'توجيه نسبة صغيرة من حركة الإنتاج إلى نسخة جديدة عبر إصدارات Canary، وتوجيه مجموعات محددة من المستخدمين إلى نسخ مختلفة، ونسخ الحركة إلى نشر ظلّي (Shadow) لاختباره بأمان.\n\n[شرائح الجلسة](https://docs.google.com/presentation/d/1KyEEb5cQp9vQOV2mVLGCnlm61HbgytSU8tCAPY9RkT8/edit)', // REVIEW
    tags: ['kubernetes', 'deployment'],
  },
  asIGEjkUQCI: {
    slug: 'hands-on-fastapi-backend-for-mlops',
    titleEn: 'Hands-on FastAPI and Backend for MLOps',
    titleAr: 'FastAPI والـ Backend لمهندسي MLOps عمليًا', // REVIEW
    descriptionEn:
      'A practical, code-heavy session on the backend skills every AI/ML engineer needs, from HTTP and API fundamentals to serving LLMs in production with FastAPI and vLLM: Pydantic validation for model inputs and outputs, FastAPI project structure with SQLAlchemy, dependency injection, async and concurrency, and rate limiting, middleware, auth and error handling.',
    descriptionAr:
      'جلسة عملية مليئة بالكود عن مهارات الـ Backend التي يحتاجها كل مهندس ذكاء اصطناعي وتعلّم آلي، من أساسيات HTTP وواجهات API إلى تقديم النماذج اللغوية في الإنتاج باستخدام FastAPI وvLLM: التحقق من مدخلات النماذج ومخرجاتها بـ Pydantic، وهيكلة مشروع FastAPI مع SQLAlchemy، وحقن الاعتماديات، والبرمجة غير المتزامنة والتزامن، وتحديد معدل الطلبات والـ middleware والمصادقة ومعالجة الأخطاء.', // REVIEW
    tags: ['fastapi', 'python', 'model-serving'],
    // Uploaded 13 Sep; the session ran Saturday 12 Sep, 4:00 PM UTC (7:00 PM Cairo) (owner's list).
    startsAt: '2026-09-12T19:00:00+03:00',
    speaker: 'Mohamed Samy',
    coSpeakers: [
      { name: 'Aya Nasser Salama', role: 'HOST' },
      { name: 'Mariam Qotob', role: 'GUEST' },
    ],
    details: {
      learnEn: [
        'Backend basics and how APIs work.',
        'HTTP methods.',
        'Databases and ORM with FastAPI.',
        'Streaming responses with WebSocket and SSE.',
        'Authentication, authorization and rate limiting.',
      ],
      learnAr: [
        'أساسيات الـ Backend وكيف تعمل واجهات API.',
        'طرق HTTP ‏(HTTP methods).',
        'قواعد البيانات والـ ORM مع FastAPI.',
        'بث الردود عبر WebSocket وSSE.',
        'المصادقة والتفويض وتحديد معدل الطلبات (Rate Limiting).',
      ],
      whyEn: ['Learn how to build a backend service for your AI project.'],
      whyAr: ['تعلّم كيف تبني خدمة Backend لمشروع الذكاء الاصطناعي الخاص بك.'],
      requirementsEn: ['Basic Python.', 'Basic command-line skills.', 'Basic database knowledge.'],
      requirementsAr: [
        'أساسيات Python.',
        'مهارات أساسية في سطر الأوامر.',
        'معرفة أساسية بقواعد البيانات.',
      ],
    },
  },
  n9iphdrNfr8: {
    slug: 'prometheus-grafana-monitoring-stack-part-1',
    titleEn: 'Prometheus & Grafana Monitoring Stack, Part 1: Architecture, Metrics & PromQL',
    titleAr: 'منظومة المراقبة بـ Prometheus وGrafana (الجزء الأول): المعمارية والمقاييس وPromQL', // REVIEW
    descriptionEn:
      'The foundations of a metrics-driven monitoring stack, built from the ground up: the observability loop and how metrics, logs and traces differ, the health signals worth watching, how Prometheus pulls and discovers targets, and querying metrics with PromQL.',
    descriptionAr:
      'أسس منظومة مراقبة قائمة على المقاييس، تُبنى من الصفر: حلقة المراقبة والفرق بين المقاييس والسجلّات والتتبّعات، وإشارات الصحة التي تستحق المتابعة، وكيف يسحب Prometheus البيانات ويكتشف الأهداف، والاستعلام عن المقاييس بـ PromQL.', // REVIEW
    tags: ['observability'],
  },
  W2xsdMvvvHI: {
    slug: 'redis-for-semantic-caching',
    titleEn: 'Redis for Semantic Caching',
    titleAr: 'Redis للتخزين المؤقت الدلالي (Semantic Caching)', // REVIEW
    descriptionEn:
      'Caching LLM responses by meaning rather than exact text with Redis, so similar questions reuse an earlier answer instead of paying for a new completion.\n\n- [Slides](https://drive.google.com/drive/folders/1SAqjHhoeetTCvhcHFRSVvXdYDPNzDYcE)\n- [Code](https://github.com/MLOpsMENACommunity/Redis_Semantic_Caching_MLOpsMENA)',
    descriptionAr:
      'تخزين ردود النماذج اللغوية مؤقتًا حسب المعنى لا النص الحرفي باستخدام Redis، لتعيد الأسئلة المتشابهة استخدام إجابة سابقة بدل دفع تكلفة توليد جديد.\n\n- [الشرائح](https://drive.google.com/drive/folders/1SAqjHhoeetTCvhcHFRSVvXdYDPNzDYcE)\n- [الكود](https://github.com/MLOpsMENACommunity/Redis_Semantic_Caching_MLOpsMENA)', // REVIEW
    tags: ['llmops'],
    // From the video description ("Eng Omar Linkedin"); the full name follows the LinkedIn address. CONFIRM.
    speakerName: 'Omar Khalil',
    speakerNameAr: 'عمر خليل', // REVIEW
    speakerLinkedinUrl: 'https://www.linkedin.com/in/omar-khalil-10om01/',
  },
  PXR2zcjaqWQ: {
    slug: 'ruff-python-linting-formatting-ci',
    titleEn: 'Ruff: Python Linting, Formatting & CI Automation',
    titleAr: 'فحص كود Python وتنسيقه وأتمتته في CI باستخدام Ruff', // REVIEW
    descriptionEn:
      'Keeping Python projects clean and consistent with Ruff: linting and formatting basics, automatic fixes, configuration in `pyproject.toml`, local automation with pre-commit, and a GitHub Actions workflow that checks the code on every push and pull request.',
    descriptionAr:
      'الحفاظ على مشاريع Python نظيفة ومتّسقة باستخدام Ruff: أساسيات الفحص والتنسيق، والإصلاحات التلقائية، والإعداد في `pyproject.toml`، والأتمتة المحلية بـ pre-commit، وworkflow على GitHub Actions يفحص الكود مع كل push وpull request.', // REVIEW
    tags: ['python', 'ci-cd'],
  },
  AzZy4wqDEWI: {
    slug: 'uv-for-legacy-python-projects',
    titleEn: 'uv for Legacy Python Code and Security',
    titleAr: 'uv لتحديث مشاريع Python القديمة وتأمينها', // REVIEW
    descriptionEn:
      'Modernising and securing existing Python projects with uv: migrating projects built on venv and requirements.txt (or with no dependency management at all), discovering dependencies with `uv pipreqs`, moving them into `pyproject.toml`, managing environments and lock files, and checking dependencies for vulnerabilities.',
    descriptionAr:
      'تحديث مشاريع Python القائمة وتأمينها باستخدام uv: ترحيل المشاريع المبنية على venv وrequirements.txt (أو التي لا تدير اعتمادياتها أصلًا)، واكتشاف الاعتماديات بـ `uv pipreqs`، ونقلها إلى `pyproject.toml`، وإدارة البيئات وملفات القفل، وفحص الاعتماديات بحثًا عن الثغرات.', // REVIEW
    tags: ['python'],
  },
};

/** Past sessions from the owner's list (9 Oct 2026) that are on neither the website nor YouTube yet. */
export const extraSessions: CuratedExtraSession[] = [
  {
    slug: 'introduction-to-llm-inference-engines',
    titleEn: 'Introduction to LLM Inference Engines',
    titleAr: 'مقدمة في محركات الاستدلال للنماذج اللغوية الكبيرة',
    speaker: 'Mohamed Rashad',
    coSpeakers: [{ name: 'Aya Nasser Salama', role: 'HOST' }],
    // Thursday 8 Oct 2026, 5:00 PM UTC (8:00 PM Cairo), 1 h 30 min. The recording isn't uploaded yet.
    startsAt: '2026-10-08T20:00:00+03:00',
    durationMin: 90,
    tags: ['llmops', 'model-serving'],
    details: {
      whyEn: [
        'How inference engines turn a trained LLM into a fast, cheap, scalable and reliable service: token generation, memory, batching, scheduling, caching, quantization and hardware execution.',
      ],
      whyAr: [
        'كيف تحوّل محركات الاستدلال نموذجًا لغويًا كبيرًا مُدرَّبًا إلى خدمة سريعة ومنخفضة التكلفة وقابلة للتوسع وموثوقة: توليد الـ tokens، والذاكرة، والتجميع (Batching)، والجدولة، والتخزين المؤقت، والتكميم (Quantization)، والتنفيذ على العتاد.',
      ],
      learnEn: [
        'Where an inference engine sits between model weights and the application.',
        'Architectures of vLLM, TensorRT-LLM, SGLang, llama.cpp and others compared.',
        'KV cache management, continuous batching, speculative decoding, tensor parallelism and quantization.',
        'Choosing and configuring the right engine, from a single local GPU to high-throughput production clusters.',
      ],
      learnAr: [
        'أين يقع محرك الاستدلال بين أوزان النموذج والتطبيق.',
        'مقارنة بين معماريات vLLM وTensorRT-LLM وSGLang وllama.cpp وغيرها.',
        'إدارة KV cache، والتجميع المستمر (Continuous Batching)، وفك الترميز التخميني (Speculative Decoding)، وتوازي الموترات (Tensor Parallelism)، والتكميم.',
        'اختيار المحرك المناسب وضبطه، من وحدة GPU محلية واحدة إلى عناقيد إنتاج عالية الإنتاجية.',
      ],
    },
  },
];

// ------------------------------------------------------------------ The MLOps Practitioner (data/mlops-practitioner.ts)

/**
 * The course's lessons as they ran. The website's `recordings` list is out of date:
 * - its lesson 3, 4 and 5 links are unavailable or private on YouTube;
 * - lesson 3 is on the channel as "MLOps #3 | Model Serving at Scale" (Gnro52bcUsg, 6 Sep);
 * - "MLOps #4 | Observability and Drift Detection" (g79F3WLZKSQ) streamed live on 13 Sep and calls
 *   itself "Session 4", so Observability was lesson 4 and Model Optimization moved to lesson 5;
 * - Model Optimization has no public recording.
 */
export const practitionerLessons: CuratedLesson[] = [
  {
    n: 1,
    week: 1,
    titleEn: 'From Notebook to Production-Ready Code',
    titleAr: 'من الـ Notebook إلى كود جاهز للإنتاج', // REVIEW
    airsAt: '2026-08-16T19:00:00+03:00',
    youtubeId: 'rJFIn83w0Dc',
    tags: ['python', 'fastapi', 'docker'],
    // REVIEW
    topicsAr: [
      'نموذج نضج MLOps',
      'حزم Python وهيكلة المشروع',
      'بناء واجهات API للنماذج (FastAPI مقابل Litestar)',
      'صيغ حفظ النماذج (Serialization)',
      'Docker والحاويات',
      'السجلّات المنظّمة (Structured Logging)',
      'اختبار كود التعلّم الآلي باستخدام pytest',
    ],
  },
  {
    n: 2,
    week: 2,
    titleEn: 'MLOps Core: Experiment Tracking, Versioning & Automation',
    titleAr: 'أساسيات MLOps: تتبّع التجارب وإدارة النسخ والأتمتة', // REVIEW
    airsAt: '2026-08-23T19:00:00+03:00',
    youtubeId: 'slxkWpCAqI8',
    tags: ['experiment-tracking', 'ci-cd', 'mlops'],
    // REVIEW
    topicsAr: [
      'تتبّع التجارب باستخدام MLflow',
      'سجلّ النماذج في MLflow',
      'التدريب المستمر باستخدام MLflow',
      'إدارة نسخ البيانات باستخدام DVC',
      'CI/CD باستخدام GitHub Actions',
      'البنية التحتية ككود باستخدام Terraform',
    ],
  },
  {
    n: 3,
    week: 4,
    titleEn: 'Inference, Serving & Release Strategies',
    titleAr: 'الاستدلال والتقديم واستراتيجيات الإصدار',
    airsAt: '2026-09-06T19:00:00+03:00',
    youtubeId: 'Gnro52bcUsg',
    tags: ['model-serving', 'deployment'],
    topicsAr: [
      'التنسيق باستخدام Apache Airflow',
      'لماذا تهمّ أنماط الاستدلال',
      'أنماط الاستدلال الثلاثة',
      'ما هو تقديم النماذج',
      'FastAPI',
      'BentoML',
      'TensorRT + Triton',
      'ONNX Runtime + OpenVINO',
      'vLLM',
      'اختبار الحِمل باستخدام Locust',
      'استراتيجيات الإصدار',
    ],
  },
  {
    n: 4,
    week: 6,
    titleEn: 'Observability & Drift Detection',
    titleAr: 'المراقبة ورصد الانحراف', // REVIEW
    airsAt: '2026-09-13T19:00:00+03:00',
    youtubeId: 'g79F3WLZKSQ',
    tags: ['observability'],
    // REVIEW
    topicsAr: [
      'لماذا يتراجع أداء النماذج في الإنتاج',
      'أنواع الانحراف',
      'طرق الرصد الإحصائية',
      'Evidently AI',
      'Page-Hinkley وADWIN',
      'انحراف التسميات والتنبؤات',
      'انحراف التضمينات (Embeddings)',
      'Prometheus + Grafana',
      'Langfuse',
      'RAGAS',
      'مراقبة التكلفة واستهلاك الـ tokens',
      'الضوابط (Guardrails)',
    ],
  },
  {
    n: 5,
    week: 5,
    titleEn: 'Model Optimization: Faster, Smaller, Cheaper',
    titleAr: 'تحسين النماذج: أسرع وأصغر وأرخص', // REVIEW
    airsAt: '2026-09-20T19:00:00+03:00',
    youtubeId: null,
    tags: ['model-optimization'],
    // REVIEW
    topicsAr: [
      'لماذا يهمّ تحسين النماذج',
      'التقليم (Pruning)',
      'التكميم بعد التدريب (PTQ)',
      'التدريب المراعي للتكميم (QAT)',
      'تقطير المعرفة',
      'TensorRT',
      'ONNX Runtime',
      'OpenVINO',
      'النشر على الأجهزة الطرفية',
      'تكميم النماذج اللغوية (AWQ وGPTQ)',
      'قياس الأداء واتخاذ قرار التحسين',
    ],
  },
];

/**
 * When the cohort ran: its live lessons, 16 Aug to 20 Sep 2026 (the website said 15 Aug to
 * 2 Oct). Six calendar weeks of lessons; the final project followed.
 */
export const practitionerDates = { start: '2026-08-16', end: '2026-09-20', weeks: 6 };

/** The syllabus weeks in the order they were taught: Observability (week 6) came before Optimization (week 5). */
export const practitionerWeekOrder = [1, 2, 3, 4, 6, 5, 7];

/** Arabic for the syllabus weeks. Titles REVIEW except weeks 3 and 7; projects from the website. */
export const practitionerWeeksAr: Record<number, { title: string; description?: string }> = {
  1: {
    title: 'من الـ Notebook إلى كود جاهز للإنتاج',
    description: 'واجهة API لنموذج تعلّم آلي داخل حاوية بالكامل، مع مجموعة اختبارات وسجلّات منظّمة وملف README من ثلاثة أوامر.',
  },
  2: {
    title: 'أساسيات MLOps: تتبّع التجارب وإدارة النسخ والأتمتة',
    description:
      'مسار مؤتمت بالكامل تُطلقه GitHub Actions — يدرّب ويقيّم مقابل نسخة الإنتاج ولا يرقّي إلا إذا تحسّنت المؤشرات، ثم يبني صورة Docker. كل تشغيل في MLflow، وكل إصدار بيانات في DVC.',
  },
  3: {
    title: 'النصف الأول من المشروع (تنفيذ ومراجعة)',
    description: 'لا محاضرة. ابدأ العمل على مشروعك المختار وطبّق المبادئ من المحاضرتين الأوليين.',
  },
  4: {
    title: 'الاستدلال والتقديم واستراتيجيات الإصدار',
    description:
      'قدّم نموذج مدة الرحلة بثلاث طرق، واختبر الحِمل حتى 100 مستخدم متزامن، ووثّق عنق الزجاجة، ثم انشر إصدارًا جديدًا عبر نشر تدريجي مع تراجع تلقائي.',
  },
  5: { title: 'تحسين النماذج: أسرع وأصغر وأرخص دون خسارة الدقة' },
  6: { title: 'المراقبة ورصد الانحراف: اعرف قبل أن يعرف مستخدموك' },
  7: {
    title: 'المشروع النهائي',
    description: 'أنجز المشروع من طرفه إلى طرفه، واعرضه على المجتمع، واحصل على مراجعة للمستودع.',
  },
};

/** Arabic for the course page (from the website's Arabic edition unless marked). */
export const practitionerAr = {
  // REVIEW
  shortDescription:
    'انقل نموذج تعلّم آلي من الـ notebook إلى الإنتاج: الحزم وواجهات API، وتتبّع التجارب وCI/CD، وخدمة النماذج على نطاق واسع، ورصد الانحراف وتحسين النماذج. أُقيمت الدفعة الأولى بين أغسطس وسبتمبر 2026، وأربعة من دروسها الخمسة مسجّلة.',
  summary:
    'بنهاية هذه الدورة سينقل الدارس نموذج تعلّم آلي من الـ notebook إلى الإنتاج — ببناء مسارات CI/CD آلية، وتتبّع للتجارب، وإعادة تدريب مجدولة. وسيقدّم التنبؤات على نطاق واسع باستخدام FastAPI وBentoML وTriton وvLLM، ويرصد الانحراف قبل أن يلاحظه المستخدمون، ويحسّن النماذج لوحدات GPU وCPU والأجهزة الطرفية. وسيفكّر ويعمل كمهندس تعلّم آلي إنتاجي.',
  hook: 'معظم مهندسي التعلّم الآلي يعرفون كيف يدرّبون نموذجًا. وقليلون جدًا يعرفون كيف يشغّلونه في الإنتاج.',
  body: 'تسدّ هذه الدورة الفجوة بين علم البيانات وهندسة الإنتاج. ستأخذ نموذج تعلّم آلي من دفتر بحثي وصولًا إلى نظام إنتاجي حيّ ومراقَب ويعيد تدريب نفسه تلقائيًا — خطوة بخطوة، بكود حقيقي وأدوات حقيقية تستخدمها شركات مثل Uber وSpotify وMeta وNetflix.',
  outro: 'كل جلسة تنتهي بمشروع قابل للنشر يبني على ما قبله. وبنهاية الدورة سيكون لديك ملف أعمال MLOps كامل يثبت مهارات هندسة إنتاج حقيقية.',
  // REVIEW
  cohortHeading: 'الدفعة الأولى',
  cohortBody:
    'أُقيمت دروس الدفعة الأولى الخمسة مباشرةً على YouTube Live من 16 أغسطس إلى 20 سبتمبر 2026، مع أسبوع للمشروع ومشروع نهائي. الدروس من 1 إلى 4 مسجّلة؛ أما الدرس 5 (تحسين النماذج، 20 سبتمبر) فليس له تسجيل منشور.',
  materialsHeading: 'مواد الدورة',
  repo: { label: 'مستودع الدورة', desc: 'كل الأكواد والدفاتر ومشاريع الوحدات.' },
  slides: { label: 'شرائح كل الجلسات', desc: 'مجلد Google Drive.' },
  objectives: [
    'هيكلة مشاريع التعلّم الآلي باحتراف باستخدام حزم Python والبرمجة الكائنية وتلميحات الأنواع، وبناء واجهات REST بمستوى إنتاجي عبر FastAPI أو Litestar — داخل حاويات Docker ومختبرة بـ pytest',
    'تتبّع التجارب وإصدار نسخ البيانات وإدارة دورة حياة النموذج عبر MLflow وDVC — وأتمتة مسار التدريب ← الاختبار ← البناء ← الرفع بالكامل عبر GitHub Actions وTerraform',
    'بناء مسارات تدريب مستمر تعيد التدريب والتقييم وترقّي النماذج إلى الإنتاج تلقائيًا عند انحراف البيانات أو تراجع الأداء — من دون تدخّل بشري',
    'اختيار نمط الاستدلال المناسب وخدمة النماذج في الإنتاج عبر المنظومة الكاملة: FastAPI ← BentoML ← TensorRT/Triton لوحدات GPU ← ONNX Runtime/OpenVINO لوحدات CPU ← vLLM للنماذج اللغوية',
    'إطلاق النماذج بأمان عبر النشر التدريجي واختبار A/B والنشر الأزرق/الأخضر ووضع الظل — مع تراجع تلقائي عند تدهور المؤشرات',
    'رصد انحراف البيانات والمفهوم والتسميات والتضمينات عبر PSI واختبار KS وPage-Hinkley وMMD — ومراقبة أنظمة الإنتاج بـ Prometheus وGrafana وLangfuse وRAGAS',
    'تحسين النماذج المدرَّبة عبر التقليم والتكميم (PTQ وQAT) وتقطير المعرفة وTensorRT وOpenVINO وTFLite — مع قياس المفاضلة بين الدقة والزمن والحجم في كل خطوة',
  ],
  requirements: [
    'معرفة أساسية ببرمجة Python — أن تكون مرتاحًا في كتابة الدوال والأصناف والعمل مع مكتبات مثل pandas وscikit-learn',
    'إلمام بمفاهيم التعلّم الآلي — أن تكون قد درّبت نموذجًا واحدًا على الأقل من قبل (انحدار خطي، تصنيف، إلخ)',
    'حاسوب محمول عليه Docker وذاكرة 8 جيجابايت على الأقل — وكل الأدوات المستخدمة مجانية ومفتوحة المصدر',
  ],
  audience: [
    'مهندسو التعلّم الآلي وعلماء البيانات القادرون على تدريب النماذج لكنهم يتعثّرون في نشرها وصيانتها في الإنتاج',
    'مهندسو البرمجيات ومهندسو DevOps المنتقلون إلى MLOps أو أدوار بنية الذكاء الاصطناعي، الباحثون عن مسار منظّم وعملي',
    'القادة التقنيون والمعماريون الذين يحتاجون فهم منظومة الإنتاج كاملة لاتخاذ قرارات أفضل بشأن الأدوات والبنية التحتية',
  ],
  learnIntro: 'عبر 5 جلسات ستتعلّم كيف:',
  learn: [
    'تحزّم كود التعلّم الآلي باحتراف وتبني واجهات REST بـ FastAPI وLitestar — داخل حاويات Docker ومختبرة بـ pytest',
    'تتبّع التجارب بـ MLflow، وتصدر نسخ البيانات بـ DVC، وتؤتمت مسارك بالكامل عبر GitHub Actions وTerraform',
    'تنسّق إعادة التدريب بـ Apache Airflow، وتخدم النماذج على نطاق واسع عبر BentoML وTriton وvLLM، وتطلقها بأمان عبر النشر التدريجي ووضع الظل',
    'تراقب نماذج الإنتاج بحثًا عن انحراف البيانات والمفهوم والتضمينات عبر Evidently AI وPrometheus وGrafana وLangfuse',
    'تحسّن النماذج سرعةً وحجمًا عبر التقليم والتكميم وتقطير المعرفة وTensorRT وOpenVINO — وتقيس كل مفاضلة',
  ],
};

/** "Coming soon" courses from data/offerings.ts. All REVIEW. */
export const upcomingAr: Record<string, { title: string; summary: string; topics: string[] }> = {
  llmops: {
    title: 'LLMOps',
    summary: 'تقديم أنظمة النماذج اللغوية الكبيرة وتقييمها وتشغيلها في الإنتاج — الجانب التشغيلي من الذكاء الاصطناعي التوليدي الذي لا يكاد أحد يدرّسه.',
    topics: [
      'تقديم عالي الإنتاجية باستخدام vLLM',
      'معمارية RAG وجودة الاسترجاع',
      'التقييم دون إجابات مرجعية (ground truth)',
      'التتبّع والمراقبة باستخدام Langfuse',
      'ميزانيات تكلفة الـ tokens وزمن الاستجابة',
      'الضوابط (Guardrails) وتصفية المحتوى غير الآمن',
    ],
  },
};

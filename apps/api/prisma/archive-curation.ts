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

export interface CuratedSession {
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
  speakerName?: string;
  speakerLinkedinUrl?: string;
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

export const speakersAr: Record<string, { titleAr?: string; bioAr?: string }> = {
  'Aya Nasser Salama': {
    titleAr: 'مؤسِّسة مجتمع MLOps MENA ومهندسة MLOps أولى',
    bioAr:
      'مهندسة MLOps وLLMOps أولى بخبرة تتجاوز 6 سنوات في الذكاء الاصطناعي. في Unifonic هي المرجع المركزي لدعم MLOps/LLMOps عبر فرق الذكاء الاصطناعي — منتجات وكيلة باستخدام LangGraph وMCP، وتقييم ومراقبة النماذج اللغوية، وخدمة نماذج تتجاوز 30 مليار معامل على Kubernetes. صمّمت وتدرّس مادة «Production ML Engineering» في ITI، وبنت أول نظام RAG إنتاجي في Valeo.',
  },
  'Mahmoud Sharif': { titleAr: 'مدرّب · خبرة أكثر من 3 سنوات' },
  'Abdallah Almalawany': { titleAr: 'مهندس DevOps' },
  'Mohamed Rashad': { titleAr: 'شريك مؤسس ومدير تقني، DevisionX' },
};

// ------------------------------------------------------------------ free sessions (data/sessions.ts)

export const sessions: Record<string, CuratedSession> = {
  'docker-deep-dive': {
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
      'Three Kubernetes deployment approaches: Recreate, Rolling Update and A/B routing. When each one fits, how rolling updates reduce downtime during a release, how Recreate replaces the old version completely, and how A/B routing sends users to different versions by routing rules.\n\n[Session slides](https://docs.google.com/presentation/d/1KyEEb5cQp9vQOV2mVLGCnlm61HbgytSU8tCAPY9RkT8/edit)',
    descriptionAr:
      'ثلاث طرق للنشر في Kubernetes: Recreate وRolling Update وتوجيه A/B. متى تناسب كل طريقة، وكيف يقلّل Rolling Update التوقف أثناء الإصدار، وكيف يستبدل Recreate النسخة القديمة بالكامل، وكيف يوجّه A/B المستخدمين إلى نسخ مختلفة وفق قواعد التوجيه.\n\n[شرائح الجلسة](https://docs.google.com/presentation/d/1KyEEb5cQp9vQOV2mVLGCnlm61HbgytSU8tCAPY9RkT8/edit)', // REVIEW
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
    'انقل نموذج تعلّم آلي من الـ notebook إلى الإنتاج: الحزم وواجهات API، وتتبّع التجارب وCI/CD، وخدمة النماذج على نطاق واسع، ورصد الانحراف وتحسين النماذج. أُقيمت الدفعة الأولى بين أغسطس وأكتوبر 2026، وكل دروسها مسجّلة.',
  summary:
    'بنهاية هذه الدورة سينقل الدارس نموذج تعلّم آلي من الـ notebook إلى الإنتاج — ببناء مسارات CI/CD آلية، وتتبّع للتجارب، وإعادة تدريب مجدولة. وسيقدّم التنبؤات على نطاق واسع باستخدام FastAPI وBentoML وTriton وvLLM، ويرصد الانحراف قبل أن يلاحظه المستخدمون، ويحسّن النماذج لوحدات GPU وCPU والأجهزة الطرفية. وسيفكّر ويعمل كمهندس تعلّم آلي إنتاجي.',
  hook: 'معظم مهندسي التعلّم الآلي يعرفون كيف يدرّبون نموذجًا. وقليلون جدًا يعرفون كيف يشغّلونه في الإنتاج.',
  body: 'تسدّ هذه الدورة الفجوة بين علم البيانات وهندسة الإنتاج. ستأخذ نموذج تعلّم آلي من دفتر بحثي وصولًا إلى نظام إنتاجي حيّ ومراقَب ويعيد تدريب نفسه تلقائيًا — خطوة بخطوة، بكود حقيقي وأدوات حقيقية تستخدمها شركات مثل Uber وSpotify وMeta وNetflix.',
  outro: 'كل جلسة تنتهي بمشروع قابل للنشر يبني على ما قبله. وبنهاية الدورة سيكون لديك ملف أعمال MLOps كامل يثبت مهارات هندسة إنتاج حقيقية.',
  // REVIEW
  cohortHeading: 'الدفعة الأولى',
  cohortBody: (platformLink: string) =>
    `أُقيمت الدفعة الأولى من 15 أغسطس إلى 2 أكتوبر 2026 على ${platformLink}: خمسة دروس مباشرة على YouTube Live، وأسبوعان للمشروع، ومشروع نهائي.`,
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

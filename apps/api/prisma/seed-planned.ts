import { legacyCourseLevel } from '@academy/shared';
import type { FaqItem, Included } from '@academy/shared';
import type { SeedCourse } from './seed-data';

/**
 * Planned courses (coming soon), seeded after the launch catalog in seed-data.ts and with the
 * same rules (see seed-catalog.ts): each is created once, by slug, and never overwrites a course
 * that already exists or that an admin renamed or deleted.
 */

/*
 * Content from the owner's planning doc (Oct 2026). Prices, dates and sessions aren't decided:
 * each page shows "Will be announced soon" and the waiting list ("Notify me"). No instructor
 * record is seeded: the owner's existing speaker profile is linked in the admin, so the seed
 * never creates a duplicate instructor.
 */

/** One FAQ entry. */
const qa = (questionEn: string, questionAr: string, answerEn: string, answerAr: string): FaqItem => ({
  questionEn,
  questionAr,
  answerEn,
  answerAr,
});

/** Shared by every course: dates and price aren't decided; community members get a discount (amount not stated). */
const FAQ_WHEN = qa(
  'When does it start, and how much does it cost?',
  'متى تبدأ الدورة، وكم تكلفتها؟',
  "The dates and the price will be announced soon. Click **Notify me when it opens** and we'll email you as soon as applications open.",
  'سيُعلَن عن المواعيد والسعر قريبًا. اضغط **أبلغني عند فتح التسجيل** وسنراسلك بالبريد الإلكتروني فور فتح باب التقديم.',
);
const FAQ_DISCOUNT = qa(
  'Is there a discount for community members?',
  'هل يوجد خصم لأعضاء المجتمع؟',
  'Yes. MLOps MENA community members get a discount, announced together with the price.',
  'نعم. يحصل أعضاء مجتمع MLOps MENA على خصم، ويُعلَن عنه مع السعر.',
);

/** How every recorded cohort runs (owner's common format). */
function recordedCohortFaq(followUps: number): FaqItem[] {
  return [
    qa(
      'How does a recorded cohort work?',
      'كيف تسير الدفعة المسجّلة؟',
      'Each cohort has a fixed start date and moves through the course together. Short videos (8–15 minutes each) are released every week, with one graded lab per week that you submit in GitHub. You watch and work at your own pace within the week.',
      'لكل دفعة تاريخ بدء محدد، ويتقدم المشاركون فيها معًا. تُنشر كل أسبوع فيديوهات قصيرة (من 8 إلى 15 دقيقة لكل منها)، مع مختبر واحد مُقيَّم أسبوعيًا تسلّمه على GitHub. تشاهد وتعمل بالسرعة التي تناسبك خلال الأسبوع.',
    ),
    qa(
      'Are there any live sessions?',
      'هل توجد جلسات مباشرة؟',
      `Yes: a 90-minute follow-up with the instructor every two weeks (${followUps} in total) for questions, lab reviews and discussion. Each one is recorded, so you can catch up if you miss it.`,
      `نعم: جلسة متابعة مع المدرب مدتها 90 دقيقة كل أسبوعين (عددها الإجمالي ${followUps}) للأسئلة ومراجعة المختبرات والنقاش. تُسجَّل كل جلسة، فتستطيع متابعتها إن فاتتك.`,
    ),
    qa(
      'Where do I ask questions between follow-ups?',
      'أين أطرح أسئلتي بين جلسات المتابعة؟',
      "In the cohort's Q&A channel. A teaching assistant answers within 48 hours.",
      'في قناة الأسئلة والأجوبة الخاصة بالدفعة، ويجيب مساعد التدريس خلال 48 ساعة.',
    ),
    qa(
      'What happens in week 1?',
      'ماذا يحدث في الأسبوع الأول؟',
      'A short kickoff task: set up your environment and your course repository, so you are ready for the first lab.',
      'مهمة انطلاق قصيرة: تجهّز بيئة العمل ومستودع الدورة الخاص بك، لتكون مستعدًا للمختبر الأول.',
    ),
    qa(
      'Do I get a certificate?',
      'هل أحصل على شهادة؟',
      'Yes. Your final project is reviewed, and you receive a certificate once it passes.',
      'نعم. يُراجَع مشروعك النهائي، وتحصل على الشهادة عند اجتيازه.',
    ),
    FAQ_DISCOUNT,
    FAQ_WHEN,
  ];
}

/** What a recorded cohort includes: videos, labs and follow-ups are described in the note. */
function recordedIncluded(en: string, ar: string): Included {
  return {
    liveSessions: false,
    recordings: false,
    assignments: true,
    finalProject: true,
    certificate: true,
    notesEn: `${en} Async Q&A answered by a teaching assistant within 48 hours, a project review and a certificate.`,
    notesAr: `${ar} وأسئلة وأجوبة غير متزامنة يجيب عنها مساعد التدريس خلال 48 ساعة، ومراجعة للمشروع، وشهادة.`,
  };
}

/** Course fields every planned course shares: no price, dates or schedule yet. */
const comingSoonBase = {
  // The price isn't decided: shown as "Price to be announced", never as free.
  type: 'PAID',
  price: 0,
  currency: 'EGP',
  requiresApproval: true,
  capacity: null,
  status: 'COMING_SOON',
  startDate: null,
  applicationsOpenAt: null,
  applicationDeadline: null,
  hoursPerWeek: null,
  driveFolderUrl: null,
  youtubePlaylistUrl: null,
  coverImageUrl: null,
  // Coming-soon pages show "Will be announced soon" for the language and format.
  language: 'BILINGUAL',
  deliveryPlatform: 'GOOGLE_MEET',
  recordingsPlatform: 'GOOGLE_DRIVE',
  notFor: { en: '', ar: '' },
  preparation: { en: '', ar: '' },
} as const;

// ---- The MLOps Practitioner, Complete Edition (recorded cohort)

/** The live course's syllabus (archive: data/mlops-practitioner.ts), as a recorded edition. */
const practitionerRecorded: SeedCourse = {
  course: {
    ...comingSoonBase,
    slug: 'mlops-practitioner-recorded',
    titleEn: 'The MLOps Practitioner — Complete Edition (recorded cohort)',
    titleAr: 'The MLOps Practitioner — النسخة الكاملة (دفعة مسجّلة)',
    shortDescriptionEn:
      'The MLOps course already taught live to 1,200+ students, as a recorded cohort: take an ML model from notebook to production, with weekly labs, instructor follow-ups, guest practitioners and a reviewed final project.',
    shortDescriptionAr:
      'دورة MLOps التي دُرّست مباشرةً لأكثر من 1,200 طالب، في دفعة مسجّلة: انقل نموذج تعلّم آلي من الـ notebook إلى الإنتاج، مع مختبرات أسبوعية وجلسات متابعة مع المدربة وممارسين ضيوف ومشروع نهائي يُراجَع.',
    longDescriptionEn: `Most ML engineers know how to train a model. Very few know how to run it in production.

This is the complete, recorded edition of **The MLOps Practitioner**, the course already taught live to more than 1,200 students. You take an ML model from a research notebook to a live, monitored production system, step by step, with real code and the tools used in industry. It adds guest sessions from practitioners who run ML in production.

## How it works

- About **6 weeks**, including a project week
- About **40 short videos** (8–15 minutes each), roughly 10 hours in total, released weekly
- About **15 hours of hands-on labs**: one graded lab per week in GitHub
- A **90-minute follow-up** with the instructor every two weeks (3 in total), recorded
- A **final project**, reviewed, and a **certificate**
- Taught in **Arabic**, with an English option

## What you'll build

Every week ends with a deployable piece that builds on the one before: a containerised, tested ML API; an automated training pipeline that only promotes a model when its metrics improve; a model served and load-tested with a safe rollout; and monitoring that catches drift before your users do. By the end you have a complete MLOps portfolio.

## Instructor

Taught by Aya Nasser, founder of the MLOps MENA Community and Senior MLOps Engineer, with guest practitioners.`,
    longDescriptionAr: `معظم مهندسي التعلّم الآلي يعرفون كيف يدرّبون نموذجًا، وقليلون جدًا يعرفون كيف يشغّلونه في الإنتاج.

هذه هي النسخة الكاملة المسجّلة من **The MLOps Practitioner**، الدورة التي دُرّست مباشرةً لأكثر من 1,200 طالب. ستأخذ نموذج تعلّم آلي من دفتر بحثي إلى نظام إنتاجي حيّ ومراقَب، خطوة بخطوة، بكود حقيقي وبالأدوات المستخدمة في الصناعة. وتضيف هذه النسخة جلسات مع ممارسين ضيوف يشغّلون التعلّم الآلي في الإنتاج.

## كيف تسير الدورة

- نحو **6 أسابيع**، منها أسبوع للمشروع
- نحو **40 فيديو قصيرًا** (من 8 إلى 15 دقيقة لكل منها)، قرابة 10 ساعات إجمالًا، تُنشر أسبوعيًا
- نحو **15 ساعة من المختبرات العملية**: مختبر واحد مُقيَّم أسبوعيًا على GitHub
- **جلسة متابعة مدتها 90 دقيقة** مع المدربة كل أسبوعين (3 جلسات إجمالًا)، مسجّلة
- **مشروع نهائي** يُراجَع، و**شهادة**
- تُدرَّس **بالعربية**، مع خيار باللغة الإنجليزية

## ما الذي ستبنيه

ينتهي كل أسبوع بجزء قابل للنشر يبني على ما قبله: واجهة API لنموذج تعلّم آلي داخل حاوية ومختبرة؛ ومسار تدريب مؤتمت لا يرقّي النموذج إلا إذا تحسّنت مؤشراته؛ ونموذج يُقدَّم ويُختبر تحت الحِمل مع إصدار آمن؛ ومراقبة ترصد الانحراف قبل أن يلاحظه مستخدموك. وبنهاية الدورة يكون لديك ملف أعمال MLOps متكامل.

## المدربة

تقدّمها آية ناصر، مؤسِّسة مجتمع MLOps MENA ومهندسة MLOps أولى، مع ممارسين ضيوف.`,
    durationWeeks: 6,
    levels: ['JUNIOR', 'MID'],
    level: legacyCourseLevel(['JUNIOR', 'MID']),
    topics: ['mlops', 'docker', 'ci-cd', 'model-serving', 'observability', 'model-optimization'],
    targetAudience: {
      en: `- ML engineers and data scientists who can train models but struggle to deploy and maintain them in production
- Software and DevOps engineers moving into MLOps or AI infrastructure roles who want a structured, hands-on path
- Anyone who missed the live cohorts and wants the complete course at their own pace within a dated cohort`,
      ar: `- مهندسو التعلّم الآلي وعلماء البيانات القادرون على تدريب النماذج لكنهم يتعثّرون في نشرها وصيانتها في الإنتاج
- مهندسو البرمجيات وDevOps المنتقلون إلى MLOps أو أدوار البنية التحتية للذكاء الاصطناعي، الباحثون عن مسار منظّم وعملي
- كل من فاتته الدفعات المباشرة ويريد الدورة كاملة بالسرعة التي تناسبه داخل دفعة لها مواعيد محددة`,
    },
    learningOutcomes: {
      en: [
        'Structure ML projects professionally and build production-grade REST APIs with FastAPI, containerised with Docker and tested with pytest',
        'Track experiments and manage the model lifecycle with MLflow, version data with DVC, and automate train → test → build → push with GitHub Actions',
        'Choose the right inference pattern and serve models with FastAPI, BentoML, Triton and vLLM, then load-test them',
        'Release models safely with canary, blue/green and shadow deployments, with automatic rollback',
        'Detect data, concept and embedding drift and monitor production systems with Prometheus, Grafana and Langfuse',
        'Optimise models with pruning, quantisation and knowledge distillation, measuring the accuracy, latency and size trade-off',
      ],
      ar: [
        'هيكلة مشاريع التعلّم الآلي باحتراف، وبناء واجهات REST بمستوى إنتاجي عبر FastAPI، داخل حاويات Docker ومختبرة بـ pytest',
        'تتبّع التجارب وإدارة دورة حياة النموذج عبر MLflow، وإصدار نسخ البيانات عبر DVC، وأتمتة مسار التدريب ← الاختبار ← البناء ← الرفع عبر GitHub Actions',
        'اختيار نمط الاستدلال المناسب وتقديم النماذج عبر FastAPI وBentoML وTriton وvLLM، ثم اختبارها تحت الحِمل',
        'إطلاق النماذج بأمان عبر النشر التدريجي (Canary) والأزرق/الأخضر ووضع الظل، مع تراجع تلقائي',
        'رصد انحراف البيانات والمفهوم والتضمينات، ومراقبة أنظمة الإنتاج بـ Prometheus وGrafana وLangfuse',
        'تحسين النماذج بالتقليم والتكميم وتقطير المعرفة، مع قياس المفاضلة بين الدقة والزمن والحجم',
      ],
    },
    prerequisites: {
      en: [
        'Basic Python: comfortable writing functions and classes, and working with pandas and scikit-learn',
        'Familiarity with machine learning: you have trained at least one model before',
        'A laptop with Docker installed and at least 8 GB of RAM (all tools used are free and open source)',
        'A GitHub account for the weekly labs',
      ],
      ar: [
        'أساسيات Python: الارتياح لكتابة الدوال والأصناف، والعمل مع pandas وscikit-learn',
        'إلمام بالتعلّم الآلي: أن تكون قد درّبت نموذجًا واحدًا على الأقل من قبل',
        'حاسوب محمول عليه Docker وذاكرة 8 جيجابايت على الأقل (كل الأدوات المستخدمة مجانية ومفتوحة المصدر)',
        'حساب على GitHub للمختبرات الأسبوعية',
      ],
    },
    outline: [
      {
        titleEn: 'Week 1 · From Notebook to Production-Ready Code',
        titleAr: 'الأسبوع 1 · من الـ Notebook إلى كود جاهز للإنتاج',
        descriptionEn:
          'Project structure and packaging, a model API with FastAPI, serialisation, Docker, structured logging and pytest. Lab: a fully containerised ML API with tests and a 3-command README.',
        descriptionAr:
          'هيكلة المشروع والحزم، وواجهة API للنموذج بـ FastAPI، وصيغ حفظ النماذج، وDocker، والسجلّات المنظّمة، وpytest. المختبر: واجهة API لنموذج تعلّم آلي داخل حاوية بالكامل، مع اختبارات وملف README من ثلاثة أوامر.',
      },
      {
        titleEn: 'Week 2 · Experiment Tracking, Versioning & CI/CD for ML',
        titleAr: 'الأسبوع 2 · تتبّع التجارب وإدارة النسخ وCI/CD لأنظمة التعلّم الآلي',
        descriptionEn:
          'MLflow tracking and model registry, data versioning with DVC, CI/CD with GitHub Actions. Lab: a pipeline that trains, evaluates against production and promotes only if metrics improve.',
        descriptionAr:
          'التتبّع وسجلّ النماذج في MLflow، وإدارة نسخ البيانات بـ DVC، وCI/CD عبر GitHub Actions. المختبر: مسار يدرّب ويقيّم مقابل نسخة الإنتاج ولا يرقّي إلا إذا تحسّنت المؤشرات.',
      },
      {
        titleEn: 'Week 3 · Serving & Release Strategies',
        titleAr: 'الأسبوع 3 · تقديم النماذج واستراتيجيات الإصدار',
        descriptionEn:
          'Inference patterns, orchestration with Airflow, serving with FastAPI, BentoML, Triton and vLLM, load testing with Locust, canary and shadow releases. Lab: serve a model three ways and roll out a new version with automatic rollback.',
        descriptionAr:
          'أنماط الاستدلال، والتنسيق بـ Airflow، والتقديم عبر FastAPI وBentoML وTriton وvLLM، واختبار الحِمل بـ Locust، والإصدار التدريجي ووضع الظل. المختبر: قدّم نموذجًا بثلاث طرق وانشر إصدارًا جديدًا مع تراجع تلقائي.',
      },
      {
        titleEn: 'Week 4 · Monitoring & Drift Detection',
        titleAr: 'الأسبوع 4 · المراقبة ورصد الانحراف',
        descriptionEn:
          'Why models degrade in production, types of drift, statistical detection, Evidently AI, Prometheus and Grafana, Langfuse for LLM apps. Lab: detect drift and alert on it.',
        descriptionAr:
          'لماذا يتراجع أداء النماذج في الإنتاج، وأنواع الانحراف، وطرق الرصد الإحصائية، وEvidently AI، وPrometheus وGrafana، وLangfuse لتطبيقات النماذج اللغوية. المختبر: ارصد الانحراف وأطلق تنبيهًا عند حدوثه.',
      },
      {
        titleEn: 'Week 5 · Model Optimisation',
        titleAr: 'الأسبوع 5 · تحسين النماذج',
        descriptionEn:
          'Pruning, quantisation (PTQ, QAT), knowledge distillation, ONNX Runtime, OpenVINO and TensorRT, plus guest sessions from practitioners. Lab: make a model faster and smaller and measure what it cost.',
        descriptionAr:
          'التقليم، والتكميم (PTQ وQAT)، وتقطير المعرفة، وONNX Runtime وOpenVINO وTensorRT، مع جلسات لممارسين ضيوف. المختبر: اجعل نموذجًا أسرع وأصغر وقِس ثمن ذلك.',
      },
      {
        titleEn: 'Week 6 · Project Week',
        titleAr: 'الأسبوع 6 · أسبوع المشروع',
        descriptionEn: 'Ship your project end to end, submit the repository for review and earn your certificate.',
        descriptionAr: 'أنجز مشروعك من طرفه إلى طرفه، وسلّم المستودع للمراجعة، واحصل على شهادتك.',
      },
    ],
    faq: [
      qa(
        'How is this different from the live course?',
        'ما الفرق بينها وبين الدورة المباشرة؟',
        'It covers the same syllabus, re-recorded as short videos, with weekly graded labs, instructor follow-ups every two weeks and guest sessions from practitioners. You keep a fixed cohort schedule but watch at your own pace within each week.',
        'تغطي المنهج نفسه، مسجّلًا من جديد في فيديوهات قصيرة، مع مختبرات أسبوعية مُقيَّمة وجلسات متابعة مع المدربة كل أسبوعين وجلسات لممارسين ضيوف. تلتزم بجدول الدفعة، لكنك تشاهد بالسرعة التي تناسبك خلال كل أسبوع.',
      ),
      qa(
        'Which language is it taught in?',
        'بأي لغة تُدرَّس الدورة؟',
        'Arabic, with an English option.',
        'بالعربية، مع خيار باللغة الإنجليزية.',
      ),
      ...recordedCohortFaq(3),
    ],
    included: recordedIncluded(
      'About 40 short videos (about 10 hours), about 15 hours of graded labs in GitHub, 3 recorded 90-minute follow-ups with the instructor, guest sessions from practitioners.',
      'نحو 40 فيديو قصيرًا (قرابة 10 ساعات)، ونحو 15 ساعة من المختبرات المُقيَّمة على GitHub، و3 جلسات متابعة مسجّلة مع المدربة مدة كل منها 90 دقيقة، وجلسات لممارسين ضيوف.',
    ),
  },
  questions: [],
  sessions: [],
};

// ---- FinOps for AI

const finops: SeedCourse = {
  course: {
    ...comingSoonBase,
    slug: 'finops-for-ai',
    titleEn: 'FinOps for AI — practical edition',
    titleAr: 'FinOps للذكاء الاصطناعي — النسخة العملية',
    shortDescriptionEn:
      'Price, size and control the cost of AI work: GPUs, tokens, API vs self-hosted break-even, cloud cost control and pricing AI proposals, built on real (anonymised) projects, with spreadsheet templates you keep.',
    shortDescriptionAr:
      'سعّر مشاريع الذكاء الاصطناعي وقدّر حجمها وتحكّم في تكلفتها: وحدات GPU والـ tokens، ونقطة التعادل بين الـ API والاستضافة الذاتية، وضبط تكلفة السحابة، وتسعير العروض الفنية، مبنية على مشاريع حقيقية (مجهولة الهوية)، مع قوالب جداول بيانات تحتفظ بها.',
    longDescriptionEn: `AI projects win or lose money long before the first model is deployed: in the GPU sizing, the token estimate, the API-or-self-host decision and the price written into the proposal.

This course teaches you to answer, with numbers, the questions every client and finance team asks: *How much will it cost to run? When does self-hosting pay off? What should we charge, and how much buffer do we need?* It is built on real (anonymised) projects and proposals, and every week gives you a spreadsheet template you keep and reuse.

## How it works

- About **5 weeks**, including a project week
- About **25 short videos** (about 6 hours), released weekly
- About **10 hours of hands-on labs** with Excel templates
- A **90-minute follow-up** with the instructor every two weeks, recorded
- A **final project** (price a real AI project end to end), reviewed, and a **certificate**
- Optional add-on: a **1:1 review** of your own AI proposal or cloud bill

## Templates you keep

- GPU sizing & monthly cost calculator
- Token cost model and API vs self-hosted break-even sheet
- Cost allocation & commitment planner
- Proposal pricing template and a sample proposal

## Instructor

Taught by Aya Nasser, founder of the MLOps MENA Community and Senior MLOps Engineer.`,
    longDescriptionAr: `تربح مشاريع الذكاء الاصطناعي أو تخسر قبل نشر أول نموذج بوقت طويل: في تقدير وحدات GPU، وتقدير الـ tokens، وقرار استخدام API أو الاستضافة الذاتية، والسعر المكتوب في العرض الفني.

تعلّمك هذه الدورة أن تجيب بالأرقام عن الأسئلة التي يطرحها كل عميل وكل فريق مالي: *كم سيكلّف التشغيل؟ متى تصبح الاستضافة الذاتية مجدية؟ كم نطلب، وكم هامش الأمان الذي نحتاجه؟* الدورة مبنية على مشاريع وعروض حقيقية (مجهولة الهوية)، ويمنحك كل أسبوع قالب جدول بيانات تحتفظ به وتعيد استخدامه.

## كيف تسير الدورة

- نحو **5 أسابيع**، منها أسبوع للمشروع
- نحو **25 فيديو قصيرًا** (قرابة 6 ساعات)، تُنشر أسبوعيًا
- نحو **10 ساعات من المختبرات العملية** بقوالب Excel
- **جلسة متابعة مدتها 90 دقيقة** مع المدربة كل أسبوعين، مسجّلة
- **مشروع نهائي** (تسعير مشروع ذكاء اصطناعي حقيقي من البداية إلى النهاية) يُراجَع، و**شهادة**
- إضافة اختيارية: **مراجعة فردية** لعرضك الفني أو فاتورتك السحابية

## قوالب تحتفظ بها

- حاسبة تقدير وحدات GPU والتكلفة الشهرية
- نموذج تكلفة الـ tokens وجدول نقطة التعادل بين الـ API والاستضافة الذاتية
- مخطِّط توزيع التكاليف والالتزامات (Commitments)
- قالب تسعير العروض الفنية وعرض نموذجي

## المدربة

تقدّمها آية ناصر، مؤسِّسة مجتمع MLOps MENA ومهندسة MLOps أولى.`,
    durationWeeks: 5,
    levels: ['MID', 'SENIOR', 'LEAD'],
    level: legacyCourseLevel(['MID', 'SENIOR', 'LEAD']),
    topics: ['finops', 'cloud-cost', 'gpu', 'llm', 'pricing'],
    targetAudience: {
      en: `- Founders and CTOs who need to know what their AI product costs to build and run
- Solution architects who size GPUs, choose between APIs and self-hosting, and defend the numbers
- Presales engineers and consultants who write and price AI proposals
- Engineering managers responsible for an AI cloud budget`,
      ar: `- المؤسسون والمديرون التقنيون (CTOs) الذين يحتاجون إلى معرفة تكلفة بناء منتجهم القائم على الذكاء الاصطناعي وتشغيله
- معماريو الحلول الذين يقدّرون وحدات GPU، ويختارون بين الـ APIs والاستضافة الذاتية، ويدافعون عن أرقامهم
- مهندسو ما قبل البيع (Presales) والاستشاريون الذين يكتبون عروض مشاريع الذكاء الاصطناعي ويسعّرونها
- مديرو الفرق الهندسية المسؤولون عن ميزانية سحابية للذكاء الاصطناعي`,
    },
    learningOutcomes: {
      en: [
        'Break down the full cost of an AI system: GPUs, tokens, storage, egress and people',
        'Calculate the break-even point between an LLM API and self-hosting, and the unit cost per conversation or document',
        'Control cloud costs with tagging, showback, commitments, spot capacity, autoscaling, budgets and alerts',
        'Price an AI project and write the proposal: margins, risk buffers and run-cost estimates',
        'Leave with reusable spreadsheet templates for sizing, break-even, allocation and pricing',
      ],
      ar: [
        'تفكيك التكلفة الكاملة لنظام ذكاء اصطناعي: وحدات GPU والـ tokens والتخزين ونقل البيانات للخارج (Egress) والفريق',
        'حساب نقطة التعادل بين استخدام API لنموذج لغوي والاستضافة الذاتية، وتكلفة الوحدة لكل محادثة أو مستند',
        'ضبط تكلفة السحابة بالوسوم (Tagging) وعرض التكاليف على الفرق (Showback) والالتزامات وسعة Spot والتوسع التلقائي والميزانيات والتنبيهات',
        'تسعير مشروع ذكاء اصطناعي وكتابة العرض الفني: الهوامش وهوامش المخاطر وتقديرات تكلفة التشغيل',
        'الخروج بقوالب جداول بيانات قابلة لإعادة الاستخدام للتقدير ونقطة التعادل وتوزيع التكاليف والتسعير',
      ],
    },
    prerequisites: {
      en: [
        'A general understanding of how AI applications are built and deployed (no coding required)',
        'Basic familiarity with a cloud provider (AWS, Azure or GCP) and its bill',
        'Comfortable working in Excel or Google Sheets',
      ],
      ar: [
        'فهم عام لكيفية بناء تطبيقات الذكاء الاصطناعي ونشرها (لا يلزم كتابة كود)',
        'إلمام أساسي بأحد مزودي السحابة (AWS أو Azure أو GCP) وفاتورته',
        'الارتياح للعمل على Excel أو Google Sheets',
      ],
    },
    outline: [
      {
        titleEn: 'Week 1 · The anatomy of AI cost',
        titleAr: 'الأسبوع 1 · تشريح تكلفة الذكاء الاصطناعي',
        descriptionEn: 'GPUs, tokens, storage, egress and people. Template: GPU sizing & monthly cost calculator.',
        descriptionAr: 'وحدات GPU والـ tokens والتخزين ونقل البيانات للخارج والفريق. القالب: حاسبة تقدير وحدات GPU والتكلفة الشهرية.',
      },
      {
        titleEn: 'Week 2 · API vs self-hosted',
        titleAr: 'الأسبوع 2 · الـ API مقابل الاستضافة الذاتية',
        descriptionEn:
          'Break-even analysis and unit economics: the cost per conversation or per document. Template: token cost model + break-even sheet.',
        descriptionAr:
          'تحليل نقطة التعادل واقتصاديات الوحدة: التكلفة لكل محادثة أو لكل مستند. القالب: نموذج تكلفة الـ tokens وجدول نقطة التعادل.',
      },
      {
        titleEn: 'Week 3 · Cloud cost control',
        titleAr: 'الأسبوع 3 · ضبط تكلفة السحابة',
        descriptionEn:
          'Tagging, showback, commitments, spot, autoscaling, budgets and alerts. Template: cost allocation & commitment planner.',
        descriptionAr:
          'الوسوم، وعرض التكاليف على الفرق (Showback)، والالتزامات، وسعة Spot، والتوسع التلقائي، والميزانيات والتنبيهات. القالب: مخطِّط توزيع التكاليف والالتزامات.',
      },
      {
        titleEn: 'Week 4 · Pricing AI projects',
        titleAr: 'الأسبوع 4 · تسعير مشاريع الذكاء الاصطناعي',
        descriptionEn:
          'Writing the proposal: margins, risk buffers and run-cost estimates. Template: proposal pricing template + a sample proposal.',
        descriptionAr:
          'كتابة العرض الفني: الهوامش وهوامش المخاطر وتقديرات تكلفة التشغيل. القالب: قالب تسعير العروض وعرض نموذجي.',
      },
      {
        titleEn: 'Week 5 · Project Week',
        titleAr: 'الأسبوع 5 · أسبوع المشروع',
        descriptionEn: 'Size, cost and price a real AI project end to end, and submit it for review.',
        descriptionAr: 'قدّر حجم مشروع ذكاء اصطناعي حقيقي وتكلفته وسعّره من البداية إلى النهاية، وسلّمه للمراجعة.',
      },
    ],
    faq: [
      qa(
        'Do I need to write code?',
        'هل أحتاج إلى كتابة كود؟',
        'No. The labs are spreadsheet models and pricing exercises built on real (anonymised) projects.',
        'لا. المختبرات نماذج على جداول البيانات وتمارين تسعير مبنية على مشاريع حقيقية (مجهولة الهوية).',
      ),
      qa(
        'Do I keep the templates?',
        'هل أحتفظ بالقوالب؟',
        'Yes. Every Excel template from the course is yours to keep and reuse in your own work.',
        'نعم. كل قوالب Excel في الدورة لك، تحتفظ بها وتعيد استخدامها في عملك.',
      ),
      qa(
        'Can I get feedback on my own proposal or cloud bill?',
        'هل يمكنني الحصول على ملاحظات على عرضي الفني أو فاتورتي السحابية؟',
        'Yes, as an optional add-on: a 1:1 review of your own AI proposal or cloud bill.',
        'نعم، كإضافة اختيارية: مراجعة فردية لعرضك الفني لمشروع ذكاء اصطناعي أو لفاتورتك السحابية.',
      ),
      ...recordedCohortFaq(2),
    ],
    included: recordedIncluded(
      'About 25 short videos (about 6 hours), about 10 hours of labs, Excel templates you keep, recorded 90-minute follow-ups with the instructor every two weeks.',
      'نحو 25 فيديو قصيرًا (قرابة 6 ساعات)، ونحو 10 ساعات من المختبرات، وقوالب Excel تحتفظ بها، وجلسات متابعة مسجّلة مع المدربة مدة كل منها 90 دقيقة كل أسبوعين.',
    ),
  },
  questions: [],
  sessions: [],
};

// ---- LLM Evaluation, Drift Detection & Monitoring (free live edition)

const llmEval: SeedCourse = {
  course: {
    ...comingSoonBase,
    slug: 'llm-evaluation-monitoring',
    titleEn: 'LLM Evaluation, Drift Detection & Monitoring (with Opseval)',
    titleAr: 'تقييم النماذج اللغوية الكبيرة ورصد الانحراف والمراقبة (مع Opseval)',
    shortDescriptionEn:
      'Six free live sessions in Arabic on YouTube: catch the silent failures of RAG apps and agents with golden sets, LLM-as-judge, Opseval, drift detection and Langfuse monitoring. Optional certificate and project review.',
    shortDescriptionAr:
      'ست جلسات مباشرة مجانية بالعربية على YouTube: اكتشف الأعطال الصامتة في تطبيقات RAG والوكلاء عبر المجموعات المرجعية (Golden Sets) وLLM-as-judge وOpseval ورصد الانحراف والمراقبة بـ Langfuse. مع شهادة ومراجعة للمشروع اختياريتين.',
    longDescriptionEn: `LLM applications rarely crash. They get quietly worse: the documents change, the users ask new things, the provider updates the model, someone edits the prompt. Nothing alerts, and the answers drift.

This course shows you how to catch that. You build evaluation sets for a RAG app and an agent, score them with LLM-as-judge, gate pull requests on the score with **Opseval**, detect drift after a model or prompt change, and send everything into **Langfuse** dashboards and alerts. The last session compares the main evaluation tools on the same app.

## How it works

- **6 live sessions**, free, in Arabic on YouTube Live; the recordings stay on YouTube
- A **GitHub repository** with Opseval and the code for every session
- An optional academy **certificate and project review** for those who build the capstone
- A paid English edition will follow later

## Tools

Opseval · Langfuse · DeepEval · Arize Phoenix · RAGAS · promptfoo · LangSmith · Kubernetes

## Instructor

Taught by Aya Nasser, founder of the MLOps MENA Community and Senior MLOps Engineer.`,
    longDescriptionAr: `نادرًا ما تتعطل تطبيقات النماذج اللغوية الكبيرة تعطلًا صريحًا؛ بل تسوء بصمت: تتغير المستندات، ويسأل المستخدمون أسئلة جديدة، ويحدّث المزوّد النموذج، ويعدّل أحدهم الـ prompt. لا يُطلَق أي تنبيه، وتنحرف الإجابات.

تعلّمك هذه الدورة كيف تكتشف ذلك. ستبني مجموعات تقييم لتطبيق RAG ولوكيل (Agent)، وتقيّمها بـ LLM-as-judge، وتربط قبول الـ pull requests بالنتيجة عبر **Opseval**، وترصد الانحراف بعد تغيير النموذج أو الـ prompt، وترسل كل ذلك إلى لوحات **Langfuse** وتنبيهاته. وتقارن الجلسة الأخيرة أهم أدوات التقييم على التطبيق نفسه.

## كيف تسير الدورة

- **6 جلسات مباشرة** مجانية بالعربية على YouTube Live، وتبقى التسجيلات على YouTube
- **مستودع على GitHub** فيه Opseval وكود كل جلسة
- **شهادة ومراجعة للمشروع** من الأكاديمية، اختياريتان لمن ينجز المشروع الختامي
- نسخة إنجليزية مدفوعة لاحقًا

## الأدوات

Opseval · Langfuse · DeepEval · Arize Phoenix · RAGAS · promptfoo · LangSmith · Kubernetes

## المدربة

تقدّمها آية ناصر، مؤسِّسة مجتمع MLOps MENA ومهندسة MLOps أولى.`,
    // The live edition is free on YouTube; the optional certificate is priced separately.
    type: 'FREE',
    language: 'AR',
    deliveryPlatform: 'YOUTUBE_LIVE',
    recordingsPlatform: 'YOUTUBE',
    durationWeeks: null,
    levels: ['MID', 'SENIOR'],
    level: legacyCourseLevel(['MID', 'SENIOR']),
    topics: ['llmops', 'llm-evaluation', 'observability', 'rag', 'agents', 'langfuse'],
    targetAudience: {
      en: `- AI and ML engineers who ship RAG apps or agents and need to know when they get worse
- MLOps and platform engineers responsible for monitoring LLM applications in production
- Tech leads who want evaluation gates in CI before prompt or model changes go live`,
      ar: `- مهندسو الذكاء الاصطناعي وتعلّم الآلة الذين يطلقون تطبيقات RAG أو وكلاء ويحتاجون إلى معرفة متى يتراجع أداؤها
- مهندسو MLOps والمنصات المسؤولون عن مراقبة تطبيقات النماذج اللغوية في الإنتاج
- القادة التقنيون الذين يريدون بوابات تقييم في CI قبل أن تصل تغييرات الـ prompt أو النموذج إلى الإنتاج`,
    },
    learningOutcomes: {
      en: [
        'Explain the ways LLM apps fail silently: input, retrieval, embedding, provider, prompt and tool drift',
        'Build golden sets and synthetic tests, and score RAG apps and agents with LLM-as-judge and standard metrics',
        'Run Opseval with persona simulation and gate pull requests on the evaluation score in CI',
        'Detect drift with baselines, embedding distribution shift, query clustering and judge-score trends',
        'Monitor LLM apps with Langfuse traces, scores, online evals and cost/latency dashboards, self-hosted on Kubernetes',
        'Choose between Opseval, DeepEval, Arize Phoenix, RAGAS, Langfuse, promptfoo and LangSmith',
      ],
      ar: [
        'شرح الطرق التي تتعطل بها تطبيقات النماذج اللغوية بصمت: انحراف المدخلات والاسترجاع والتضمينات والمزوّد والـ prompt والأدوات',
        'بناء مجموعات مرجعية واختبارات اصطناعية، وتقييم تطبيقات RAG والوكلاء بـ LLM-as-judge والمقاييس المعيارية',
        'تشغيل Opseval مع محاكاة الشخصيات (Personas) وربط قبول الـ pull requests بنتيجة التقييم في CI',
        'رصد الانحراف عبر خطوط الأساس، وتحوّل توزيع التضمينات، وتجميع الاستعلامات، واتجاهات نتائج المُقيِّم',
        'مراقبة تطبيقات النماذج اللغوية عبر Langfuse: التتبّعات والنتائج والتقييمات المباشرة ولوحات التكلفة وزمن الاستجابة، مستضافة ذاتيًا على Kubernetes',
        'المفاضلة بين Opseval وDeepEval وArize Phoenix وRAGAS وLangfuse وpromptfoo وLangSmith',
      ],
    },
    prerequisites: {
      en: [
        'Python: comfortable reading and running Python projects',
        'You have built or worked on a RAG app or an LLM agent',
        'Docker basics; Kubernetes basics help for the self-hosting part',
        'An LLM API key (or a local model) for the hands-on parts',
      ],
      ar: [
        'Python: الارتياح لقراءة مشاريع Python وتشغيلها',
        'أن تكون قد بنيت تطبيق RAG أو وكيلًا قائمًا على نموذج لغوي أو عملت عليه',
        'أساسيات Docker، وتفيدك أساسيات Kubernetes في جزء الاستضافة الذاتية',
        'مفتاح API لنموذج لغوي (أو نموذج محلي) للأجزاء العملية',
      ],
    },
    outline: [
      {
        titleEn: 'Session 1 · Why LLM apps fail silently',
        titleAr: 'الجلسة 1 · لماذا تتعطل تطبيقات النماذج اللغوية بصمت',
        descriptionEn:
          'Input drift, retrieval/corpus drift, embedding-model changes, provider model updates, prompt drift, agent tool/API drift. Hands-on: break a working RAG app five ways and watch nothing alert.',
        descriptionAr:
          'انحراف المدخلات، وانحراف الاسترجاع ومجموعة المستندات، وتغيير نموذج التضمين، وتحديثات نموذج المزوّد، وانحراف الـ prompt، وانحراف أدوات الوكيل وواجهاتها. عمليًا: عطّل تطبيق RAG يعمل بخمس طرق ولاحظ أن شيئًا لا يُطلق تنبيهًا.',
      },
      {
        titleEn: 'Session 2 · Evaluation foundations',
        titleAr: 'الجلسة 2 · أسس التقييم',
        descriptionEn:
          'Golden sets, synthetic test generation, LLM-as-judge; RAG metrics (faithfulness, context precision/recall, answer relevance); agent metrics (task success, tool-call accuracy, trajectory, steps, cost). Hands-on: build a golden set for a RAG app and an agent.',
        descriptionAr:
          'المجموعات المرجعية، وتوليد الاختبارات الاصطناعية، وLLM-as-judge؛ ومقاييس RAG (الأمانة للمصدر، ودقة السياق واستدعاؤه، وملاءمة الإجابة)؛ ومقاييس الوكلاء (نجاح المهمة، ودقة استدعاء الأدوات، والمسار، وعدد الخطوات، والتكلفة). عمليًا: ابنِ مجموعة مرجعية لتطبيق RAG ولوكيل.',
      },
      {
        titleEn: 'Session 3 · Opseval',
        titleAr: 'الجلسة 3 · Opseval',
        descriptionEn:
          'Persona simulation, scoring, conversation recording, LLM-as-judge and running in CI. Hands-on: evaluate the agent and gate a pull request on the score.',
        descriptionAr:
          'محاكاة الشخصيات، والتقييم، وتسجيل المحادثات، وLLM-as-judge، والتشغيل في CI. عمليًا: قيّم الوكيل واربط قبول pull request بالنتيجة.',
      },
      {
        titleEn: 'Session 4 · Drift detection in practice',
        titleAr: 'الجلسة 4 · رصد الانحراف عمليًا',
        descriptionEn:
          'Baselines, embedding distribution shift, topic clustering of queries, judge-score trends, alert thresholds, evaluation on every model or prompt update. Hands-on: detect drift after swapping the model version.',
        descriptionAr:
          'خطوط الأساس، وتحوّل توزيع التضمينات، وتجميع الاستعلامات حسب الموضوع، واتجاهات نتائج المُقيِّم، وحدود التنبيه، والتقييم مع كل تحديث للنموذج أو الـ prompt. عمليًا: ارصد الانحراف بعد تبديل إصدار النموذج.',
      },
      {
        titleEn: 'Session 5 · Monitoring with Langfuse',
        titleAr: 'الجلسة 5 · المراقبة بـ Langfuse',
        descriptionEn:
          'Traces, sessions, scores, datasets, online evals, cost and latency dashboards, self-hosting on Kubernetes. Hands-on: send Opseval scores into Langfuse and alert on drops.',
        descriptionAr:
          'التتبّعات والجلسات والنتائج ومجموعات البيانات والتقييمات المباشرة ولوحات التكلفة وزمن الاستجابة، والاستضافة الذاتية على Kubernetes. عمليًا: أرسل نتائج Opseval إلى Langfuse وأطلق تنبيهًا عند انخفاضها.',
      },
      {
        titleEn: 'Session 6 · Tool comparison + capstone',
        titleAr: 'الجلسة 6 · مقارنة الأدوات والمشروع الختامي',
        descriptionEn:
          'The same app evaluated with Opseval, DeepEval, Arize Phoenix, RAGAS, Langfuse, promptfoo and LangSmith. Capstone: a full evaluation, drift and monitoring setup for one app.',
        descriptionAr:
          'التطبيق نفسه مُقيَّمًا بـ Opseval وDeepEval وArize Phoenix وRAGAS وLangfuse وpromptfoo وLangSmith. المشروع الختامي: منظومة كاملة للتقييم ورصد الانحراف والمراقبة لتطبيق واحد.',
      },
    ],
    faq: [
      qa(
        'Is it really free?',
        'هل الدورة مجانية فعلًا؟',
        'Yes. The six live sessions are free on YouTube in Arabic, and the recordings stay there. The academy certificate and project review are optional and are priced separately.',
        'نعم. الجلسات المباشرة الست مجانية على YouTube بالعربية، وتبقى تسجيلاتها هناك. أما شهادة الأكاديمية ومراجعة المشروع فاختياريتان ولهما سعر منفصل.',
      ),
      qa(
        'Where is the code?',
        'أين أجد الكود؟',
        'In a GitHub repository with Opseval and the code for every session.',
        'في مستودع على GitHub فيه Opseval وكود كل جلسة.',
      ),
      qa(
        'Is there an English edition?',
        'هل توجد نسخة باللغة الإنجليزية؟',
        'A paid English edition is planned for later.',
        'من المخطط إصدار نسخة إنجليزية مدفوعة لاحقًا.',
      ),
      qa(
        'How do I get the certificate?',
        'كيف أحصل على الشهادة؟',
        'Build the capstone (a full evaluation, drift and monitoring setup for one app) and submit it for review. The certificate is issued once it passes.',
        'أنجز المشروع الختامي (منظومة كاملة للتقييم ورصد الانحراف والمراقبة لتطبيق واحد) وسلّمه للمراجعة، وتصدر الشهادة عند اجتيازه.',
      ),
      qa(
        'When does it start?',
        'متى تبدأ الدورة؟',
        "The dates will be announced soon. Click **Notify me when it opens** and we'll email you when they are set.",
        'سيُعلَن عن المواعيد قريبًا. اضغط **أبلغني عند فتح التسجيل** وسنراسلك بالبريد الإلكتروني عند تحديدها.',
      ),
    ],
    included: {
      liveSessions: true,
      recordings: true,
      assignments: false,
      finalProject: true,
      certificate: true,
      notesEn:
        'Six free live sessions with public recordings, and a GitHub repository with Opseval and the code for every session. The certificate and project review are optional and priced separately.',
      notesAr:
        'ست جلسات مباشرة مجانية بتسجيلات عامة، ومستودع على GitHub فيه Opseval وكود كل جلسة. الشهادة ومراجعة المشروع اختياريتان ولهما سعر منفصل.',
    },
  },
  questions: [],
  sessions: [],
};

// ---- TensorRT & TensorRT-LLM Optimization

const tensorrt: SeedCourse = {
  course: {
    ...comingSoonBase,
    slug: 'tensorrt-optimization',
    titleEn: 'TensorRT & TensorRT-LLM Optimization',
    titleAr: 'تحسين النماذج بـ TensorRT وTensorRT-LLM',
    shortDescriptionEn:
      'Take real PyTorch models (such as YOLO and Llama 8B) to FP16, INT8 and FP8 engines with TensorRT and TensorRT-LLM, and prove the speedup with benchmarks and an accuracy report.',
    shortDescriptionAr:
      'انقل نماذج PyTorch حقيقية (مثل YOLO وLlama 8B) إلى محركات FP16 وINT8 وFP8 باستخدام TensorRT وTensorRT-LLM، وأثبت التسريع بقياسات أداء وتقرير للدقة.',
    longDescriptionEn: `"We made it faster" means nothing without numbers. In this course you take real PyTorch models, a vision model such as YOLO and an LLM such as Llama 8B, and turn them into optimised TensorRT and TensorRT-LLM engines in FP16, INT8 and FP8. Then you prove it: FPS, latency, tokens per second and time to first token before and after, plus an accuracy report (for example mAP before and after quantisation).

## How it works

- About **6 weeks**, including a project week
- About **35 short videos** (about 9 hours), released weekly
- About **20 hours of hands-on labs** on NVIDIA GPUs
- **3 recorded follow-ups** of 90 minutes with the instructor
- A **final project** (an optimised, benchmarked model of your choice), reviewed, and a **certificate**
- A **founding cohort** limited to 15 seats

## What you'll deliver

For each model: an engine, a benchmark report (throughput, latency, memory) and an accuracy report, so you can show exactly what the optimisation gained and what it cost.

## Tools

PyTorch · ONNX · TensorRT · TensorRT-LLM · Nsight Systems · trtexec · Triton Inference Server

## Instructor

Taught by Aya Nasser, founder of the MLOps MENA Community and Senior MLOps Engineer.`,
    longDescriptionAr: `عبارة «جعلناه أسرع» لا تعني شيئًا من دون أرقام. في هذه الدورة تأخذ نماذج PyTorch حقيقية، نموذج رؤية مثل YOLO ونموذجًا لغويًا مثل Llama 8B، وتحوّلها إلى محركات TensorRT وTensorRT-LLM محسّنة بدقة FP16 وINT8 وFP8. ثم تثبت ذلك: عدد الإطارات في الثانية (FPS)، وزمن الاستجابة، وعدد الـ tokens في الثانية، والزمن حتى أول token، قبل التحسين وبعده، مع تقرير للدقة (مثل mAP قبل التكميم وبعده).

## كيف تسير الدورة

- نحو **6 أسابيع**، منها أسبوع للمشروع
- نحو **35 فيديو قصيرًا** (قرابة 9 ساعات)، تُنشر أسبوعيًا
- نحو **20 ساعة من المختبرات العملية** على وحدات NVIDIA GPU
- **3 جلسات متابعة مسجّلة** مع المدربة مدة كل منها 90 دقيقة
- **مشروع نهائي** (نموذج من اختيارك، محسَّن ومقيس الأداء) يُراجَع، و**شهادة**
- **دفعة تأسيسية** تقتصر على 15 مقعدًا

## ما الذي ستسلّمه

لكل نموذج: محرك (Engine)، وتقرير أداء (الإنتاجية وزمن الاستجابة والذاكرة)، وتقرير للدقة، لتُظهر بدقة ما كسبه التحسين وما كلّفه.

## الأدوات

PyTorch · ONNX · TensorRT · TensorRT-LLM · Nsight Systems · trtexec · Triton Inference Server

## المدربة

تقدّمها آية ناصر، مؤسِّسة مجتمع MLOps MENA ومهندسة MLOps أولى.`,
    // Founding cohort: 15 seats.
    capacity: 15,
    durationWeeks: 6,
    levels: ['MID', 'SENIOR'],
    level: legacyCourseLevel(['MID', 'SENIOR']),
    topics: ['model-optimization', 'tensorrt', 'gpu', 'llm', 'model-serving'],
    targetAudience: {
      en: `- ML and MLOps engineers who deploy models on NVIDIA GPUs and need lower latency or cost
- Computer-vision engineers who need more FPS from the same hardware
- Engineers serving LLMs who want more tokens per second and a faster time to first token`,
      ar: `- مهندسو تعلّم الآلة وMLOps الذين ينشرون النماذج على وحدات NVIDIA GPU ويحتاجون إلى زمن استجابة أو تكلفة أقل
- مهندسو الرؤية الحاسوبية الذين يحتاجون إلى عدد إطارات أكبر في الثانية من العتاد نفسه
- المهندسون الذين يقدّمون نماذج لغوية ويريدون tokens أكثر في الثانية وزمنًا أقصر حتى أول token`,
    },
    learningOutcomes: {
      en: [
        'Export PyTorch models to ONNX and build TensorRT engines',
        'Quantise to FP16, INT8 (with calibration) and FP8, and check accuracy before and after',
        'Profile engines and remove bottlenecks with Nsight Systems and trtexec',
        'Optimise LLMs with TensorRT-LLM: quantisation, in-flight batching and KV cache',
        'Deploy optimised engines with Triton Inference Server',
        'Prove the result with a benchmark and accuracy report: FPS, latency, tokens/sec, time to first token, mAP',
      ],
      ar: [
        'تصدير نماذج PyTorch إلى ONNX وبناء محركات TensorRT',
        'التكميم إلى FP16 وINT8 (مع المعايرة) وFP8، والتحقق من الدقة قبل التكميم وبعده',
        'تحليل أداء المحركات (Profiling) وإزالة الاختناقات بـ Nsight Systems وtrtexec',
        'تحسين النماذج اللغوية بـ TensorRT-LLM: التكميم والتجميع أثناء التنفيذ (In-flight Batching) وذاكرة KV',
        'نشر المحركات المحسّنة عبر Triton Inference Server',
        'إثبات النتيجة بتقرير للأداء والدقة: FPS وزمن الاستجابة وعدد الـ tokens في الثانية والزمن حتى أول token وmAP',
      ],
    },
    prerequisites: {
      en: [
        'Python and PyTorch: you can load, run and evaluate a model',
        'Docker basics and comfort with the Linux command line',
        'Access to an NVIDIA GPU (a cloud GPU instance is fine)',
      ],
      ar: [
        'Python وPyTorch: أن تستطيع تحميل نموذج وتشغيله وتقييمه',
        'أساسيات Docker والارتياح لسطر أوامر Linux',
        'وصول إلى وحدة NVIDIA GPU (يكفي خادم GPU سحابي)',
      ],
    },
    outline: [
      {
        titleEn: 'Week 1 · ONNX export & engine build',
        titleAr: 'الأسبوع 1 · التصدير إلى ONNX وبناء المحرك',
        descriptionEn: 'From PyTorch to ONNX to a TensorRT engine; dynamic shapes; a baseline benchmark of the original model.',
        descriptionAr: 'من PyTorch إلى ONNX ثم إلى محرك TensorRT؛ والأشكال الديناميكية (Dynamic Shapes)؛ وقياس أداء مرجعي للنموذج الأصلي.',
      },
      {
        titleEn: 'Week 2 · Precision: FP16, INT8 calibration & accuracy check',
        titleAr: 'الأسبوع 2 · الدقة العددية: FP16 ومعايرة INT8 والتحقق من الدقة',
        descriptionEn: 'Mixed precision, INT8 calibration and quantisation-aware options; mAP before and after for a YOLO model.',
        descriptionAr: 'الدقة المختلطة، ومعايرة INT8، وخيارات التكميم أثناء التدريب؛ وقياس mAP قبل التكميم وبعده لنموذج YOLO.',
      },
      {
        titleEn: 'Week 3 · Profiling & optimisation',
        titleAr: 'الأسبوع 3 · تحليل الأداء والتحسين',
        descriptionEn: 'trtexec and Nsight Systems, layer fusion, batch size and memory trade-offs, finding the real bottleneck.',
        descriptionAr: 'trtexec وNsight Systems، ودمج الطبقات، والمفاضلة بين حجم الدفعة والذاكرة، والعثور على الاختناق الحقيقي.',
      },
      {
        titleEn: 'Week 4 · TensorRT-LLM',
        titleAr: 'الأسبوع 4 · TensorRT-LLM',
        descriptionEn:
          'Building an engine for Llama 8B: FP8/INT8 quantisation, in-flight batching, KV cache; tokens per second and time to first token.',
        descriptionAr:
          'بناء محرك لـ Llama 8B: تكميم FP8/INT8، والتجميع أثناء التنفيذ، وذاكرة KV؛ وقياس عدد الـ tokens في الثانية والزمن حتى أول token.',
      },
      {
        titleEn: 'Week 5 · Deployment with Triton',
        titleAr: 'الأسبوع 5 · النشر عبر Triton',
        descriptionEn: 'Serving TensorRT and TensorRT-LLM engines with Triton Inference Server, dynamic batching and load testing.',
        descriptionAr: 'تقديم محركات TensorRT وTensorRT-LLM عبر Triton Inference Server، والتجميع الديناميكي، واختبار الحِمل.',
      },
      {
        titleEn: 'Week 6 · Project Week',
        titleAr: 'الأسبوع 6 · أسبوع المشروع',
        descriptionEn: 'Optimise a model of your choice and submit the engine with its benchmark and accuracy report for review.',
        descriptionAr: 'حسّن نموذجًا من اختيارك وسلّم المحرك مع تقرير الأداء والدقة للمراجعة.',
      },
    ],
    faq: [
      qa(
        'Do I need my own GPU?',
        'هل أحتاج إلى وحدة GPU خاصة بي؟',
        'You need access to an NVIDIA GPU. A cloud GPU instance is fine; cloud costs are yours.',
        'تحتاج إلى وصول إلى وحدة NVIDIA GPU، ويكفي خادم GPU سحابي، وتكاليف السحابة عليك.',
      ),
      qa(
        'What is the founding cohort?',
        'ما الدفعة التأسيسية؟',
        'The first cohort of this course, limited to 15 seats so every student gets close feedback on their labs.',
        'هي الدفعة الأولى من هذه الدورة، وتقتصر على 15 مقعدًا ليحصل كل طالب على ملاحظات قريبة على مختبراته.',
      ),
      ...recordedCohortFaq(3),
    ],
    included: recordedIncluded(
      'About 35 short videos (about 9 hours), about 20 hours of GPU labs, 3 recorded 90-minute follow-ups with the instructor.',
      'نحو 35 فيديو قصيرًا (قرابة 9 ساعات)، ونحو 20 ساعة من مختبرات GPU، و3 جلسات متابعة مسجّلة مع المدربة مدة كل منها 90 دقيقة.',
    ),
  },
  questions: [],
  sessions: [],
};

// ---- DeepStream Real-Time Video Analytics

const deepstream: SeedCourse = {
  course: {
    ...comingSoonBase,
    slug: 'deepstream-video-analytics',
    titleEn: 'DeepStream Real-Time Video Analytics',
    titleAr: 'تحليلات الفيديو اللحظية باستخدام DeepStream',
    shortDescriptionEn:
      'Build real-time video analytics with NVIDIA DeepStream: multi-camera pipelines on one GPU, tracking, people counting and line crossing, and edge deployment on Jetson Orin, for smart city, security and retail.',
    shortDescriptionAr:
      'ابنِ تحليلات فيديو لحظية باستخدام NVIDIA DeepStream: مسارات متعددة الكاميرات على وحدة GPU واحدة، والتتبّع، وعدّ الأشخاص ورصد عبور الخطوط، والنشر على الأجهزة الطرفية Jetson Orin، لقطاعات المدن الذكية والأمن والتجزئة.',
    longDescriptionEn: `Video analytics is one of the most in-demand applications of AI in the region: smart cities, security and retail analytics all need it, and all of it has to run in real time on limited hardware.

In this course you build complete DeepStream pipelines: decode several camera streams (for example 8 cameras on one GPU), run detection with TensorRT models, track objects, count people and detect line crossings, send events to a message broker, and deploy the result on a Jetson Orin at the edge.

## How it works

- About **7 weeks**, including a project week
- About **45 short videos** (about 12 hours), released weekly
- About **25 hours of hands-on labs**
- **4 recorded follow-ups** of 90 minutes with the instructor
- A **final project** (a multi-camera analytics pipeline), reviewed, and a **certificate**

## Tools

NVIDIA DeepStream · GStreamer · TensorRT · nvinfer · NvDCF / NvDeepSORT trackers · nvdsanalytics · Kafka / MQTT · Jetson Orin · Docker

## Instructor

Taught by Aya Nasser, founder of the MLOps MENA Community and Senior MLOps Engineer.`,
    longDescriptionAr: `تحليلات الفيديو من أكثر تطبيقات الذكاء الاصطناعي طلبًا في المنطقة: تحتاجها المدن الذكية والأمن وتحليلات التجزئة، ويجب أن يعمل كل ذلك لحظيًا على عتاد محدود.

في هذه الدورة تبني مسارات DeepStream كاملة: تفك ترميز عدة بثوث من الكاميرات (مثل 8 كاميرات على وحدة GPU واحدة)، وتشغّل الكشف بنماذج TensorRT، وتتتبّع الأجسام، وتعدّ الأشخاص وترصد عبور الخطوط، وترسل الأحداث إلى وسيط رسائل (Message Broker)، ثم تنشر النتيجة على جهاز Jetson Orin طرفي.

## كيف تسير الدورة

- نحو **7 أسابيع**، منها أسبوع للمشروع
- نحو **45 فيديو قصيرًا** (قرابة 12 ساعة)، تُنشر أسبوعيًا
- نحو **25 ساعة من المختبرات العملية**
- **4 جلسات متابعة مسجّلة** مع المدربة مدة كل منها 90 دقيقة
- **مشروع نهائي** (مسار تحليلات متعدد الكاميرات) يُراجَع، و**شهادة**

## الأدوات

NVIDIA DeepStream · GStreamer · TensorRT · nvinfer · NvDCF / NvDeepSORT trackers · nvdsanalytics · Kafka / MQTT · Jetson Orin · Docker

## المدربة

تقدّمها آية ناصر، مؤسِّسة مجتمع MLOps MENA ومهندسة MLOps أولى.`,
    durationWeeks: 7,
    levels: ['MID', 'SENIOR'],
    level: legacyCourseLevel(['MID', 'SENIOR']),
    topics: ['computer-vision', 'deepstream', 'edge-ai', 'gpu', 'tensorrt'],
    targetAudience: {
      en: `- Computer-vision engineers who need to move from single-video demos to real-time, multi-camera systems
- ML and MLOps engineers building video analytics for smart city, security or retail clients
- Edge AI engineers deploying on NVIDIA Jetson devices`,
      ar: `- مهندسو الرؤية الحاسوبية الذين يحتاجون إلى الانتقال من عروض على فيديو واحد إلى أنظمة لحظية متعددة الكاميرات
- مهندسو تعلّم الآلة وMLOps الذين يبنون تحليلات فيديو لعملاء في المدن الذكية أو الأمن أو التجزئة
- مهندسو الذكاء الاصطناعي على الأجهزة الطرفية الذين ينشرون على أجهزة NVIDIA Jetson`,
    },
    learningOutcomes: {
      en: [
        'Build GStreamer and DeepStream pipelines from camera input to annotated output',
        'Run TensorRT models inside DeepStream with nvinfer, including secondary classifiers',
        'Track objects across frames and choose the right tracker',
        'Run many camera streams on one GPU with batching, and measure throughput',
        'Implement analytics such as people counting and line crossing, and publish events to a message broker',
        'Deploy and tune a pipeline on a Jetson Orin at the edge',
      ],
      ar: [
        'بناء مسارات GStreamer وDeepStream من مدخل الكاميرا إلى مخرج مُعلَّم',
        'تشغيل نماذج TensorRT داخل DeepStream عبر nvinfer، بما فيها المصنّفات الثانوية',
        'تتبّع الأجسام عبر الإطارات واختيار المتتبّع المناسب',
        'تشغيل بثوث كاميرات كثيرة على وحدة GPU واحدة بالتجميع (Batching)، وقياس الإنتاجية',
        'تنفيذ تحليلات مثل عدّ الأشخاص ورصد عبور الخطوط، ونشر الأحداث إلى وسيط رسائل',
        'نشر مسار وضبط أدائه على جهاز Jetson Orin طرفي',
      ],
    },
    prerequisites: {
      en: [
        'Python, and basic computer vision (object detection models such as YOLO)',
        'Docker basics and comfort with the Linux command line',
        'Access to an NVIDIA GPU (a cloud GPU instance is fine); a Jetson Orin is optional for the edge week',
      ],
      ar: [
        'Python، وأساسيات الرؤية الحاسوبية (نماذج كشف الأجسام مثل YOLO)',
        'أساسيات Docker والارتياح لسطر أوامر Linux',
        'وصول إلى وحدة NVIDIA GPU (يكفي خادم GPU سحابي)، وجهاز Jetson Orin اختياري لأسبوع الأجهزة الطرفية',
      ],
    },
    outline: [
      {
        titleEn: 'Week 1 · GStreamer & DeepStream basics',
        titleAr: 'الأسبوع 1 · أساسيات GStreamer وDeepStream',
        descriptionEn: 'Pipelines, elements and pads, decoding camera and file sources, the DeepStream reference app.',
        descriptionAr: 'المسارات والعناصر والمنافذ (Pads)، وفك ترميز مصادر الكاميرات والملفات، وتطبيق DeepStream المرجعي.',
      },
      {
        titleEn: 'Week 2 · Inference with TensorRT models (nvinfer)',
        titleAr: 'الأسبوع 2 · الاستدلال بنماذج TensorRT ‏(nvinfer)',
        descriptionEn: 'Bringing a detector into DeepStream, primary and secondary inference, custom parsers.',
        descriptionAr: 'إدخال نموذج كشف إلى DeepStream، والاستدلال الأساسي والثانوي، والمحلّلات المخصّصة (Custom Parsers).',
      },
      {
        titleEn: 'Week 3 · Tracking',
        titleAr: 'الأسبوع 3 · التتبّع',
        descriptionEn: 'Multi-object tracking, tracker choices and tuning, stable IDs across frames.',
        descriptionAr: 'تتبّع أجسام متعددة، وخيارات المتتبّعات وضبطها، ومعرّفات ثابتة عبر الإطارات.',
      },
      {
        titleEn: 'Week 4 · Multi-stream batching & performance',
        titleAr: 'الأسبوع 4 · التجميع متعدد البثوث والأداء',
        descriptionEn: 'Eight cameras on one GPU: stream muxing, batching, measuring FPS per stream and GPU utilisation.',
        descriptionAr: 'ثماني كاميرات على وحدة GPU واحدة: دمج البثوث (Muxing)، والتجميع، وقياس عدد الإطارات في الثانية لكل بث واستخدام وحدة GPU.',
      },
      {
        titleEn: 'Week 5 · Analytics & message brokers',
        titleAr: 'الأسبوع 5 · التحليلات ووسطاء الرسائل',
        descriptionEn: 'Line crossing, people counting and regions of interest with nvdsanalytics; sending events to Kafka or MQTT.',
        descriptionAr: 'رصد عبور الخطوط وعدّ الأشخاص ومناطق الاهتمام عبر nvdsanalytics؛ وإرسال الأحداث إلى Kafka أو MQTT.',
      },
      {
        titleEn: 'Week 6 · Edge deployment on Jetson Orin',
        titleAr: 'الأسبوع 6 · النشر على الأجهزة الطرفية Jetson Orin',
        descriptionEn: 'Building for Jetson, power and performance modes, containers at the edge, remote updates.',
        descriptionAr: 'البناء لأجهزة Jetson، وأوضاع الطاقة والأداء، والحاويات على الأجهزة الطرفية، والتحديث عن بُعد.',
      },
      {
        titleEn: 'Week 7 · Project Week',
        titleAr: 'الأسبوع 7 · أسبوع المشروع',
        descriptionEn: 'Build a multi-camera analytics pipeline for a smart-city, security or retail scenario and submit it for review.',
        descriptionAr: 'ابنِ مسار تحليلات متعدد الكاميرات لسيناريو في المدن الذكية أو الأمن أو التجزئة، وسلّمه للمراجعة.',
      },
    ],
    faq: [
      qa(
        'Do I need a Jetson device?',
        'هل أحتاج إلى جهاز Jetson؟',
        'No. A cloud NVIDIA GPU is enough for most of the course; a Jetson Orin is optional for the edge week.',
        'لا. تكفي وحدة NVIDIA GPU سحابية لمعظم الدورة، وجهاز Jetson Orin اختياري لأسبوع الأجهزة الطرفية.',
      ),
      ...recordedCohortFaq(4),
    ],
    included: recordedIncluded(
      'About 45 short videos (about 12 hours), about 25 hours of labs, 4 recorded 90-minute follow-ups with the instructor.',
      'نحو 45 فيديو قصيرًا (قرابة 12 ساعة)، ونحو 25 ساعة من المختبرات، و4 جلسات متابعة مسجّلة مع المدربة مدة كل منها 90 دقيقة.',
    ),
  },
  questions: [],
  sessions: [],
};

// ---- Forward Deployed Engineer

const fde: SeedCourse = {
  course: {
    ...comingSoonBase,
    slug: 'forward-deployed-engineer',
    titleEn: 'Forward Deployed Engineer: from business problem to deployed AI app',
    titleAr: 'مهندس النشر الميداني (Forward Deployed Engineer): من مشكلة العمل إلى تطبيق ذكاء اصطناعي منشور',
    shortDescriptionEn:
      'Work like a forward deployed engineer: run discovery with a client, scope the problem, build and deploy an AI app, and demo it to stakeholders, through a real client-style brief from start to finish.',
    shortDescriptionAr:
      'اعمل كمهندس نشر ميداني: أجرِ جلسة استكشاف مع العميل، وحدّد نطاق المشكلة، وابنِ تطبيق ذكاء اصطناعي وانشره، واعرضه على أصحاب المصلحة، عبر طلب عميل واقعي من البداية إلى النهاية.',
    longDescriptionEn: `Building the model is rarely the hard part. The hard part is sitting with a client, understanding what they actually need, agreeing on a scope, and shipping something that works in their environment.

That is the job of a **forward deployed engineer**. In this course you do it end to end on a real client-style brief: a discovery call, a written scoping document, the build, a deployment, and a stakeholder demo.

## How it works

- About **7 weeks**, including a project week
- About **45 short videos** (about 11 hours), released weekly
- About **20 hours of hands-on labs**
- **4 recorded follow-ups** of 90 minutes with the instructors
- A **capstone**: brief → discovery call → scoping doc → build → deploy → stakeholder demo, reviewed, and a **certificate**

## Instructors

A guest practitioner (to be announced) together with Aya Nasser, founder of the MLOps MENA Community and Senior MLOps Engineer.`,
    longDescriptionAr: `نادرًا ما يكون بناء النموذج هو الجزء الصعب. الصعب هو أن تجلس مع العميل، وتفهم ما يحتاجه فعلًا، وتتفق معه على النطاق، ثم تسلّم شيئًا يعمل في بيئته.

هذه هي وظيفة **مهندس النشر الميداني (Forward Deployed Engineer)**. في هذه الدورة تؤديها من البداية إلى النهاية على طلب عميل واقعي: جلسة استكشاف، ووثيقة نطاق مكتوبة، والبناء، والنشر، والعرض على أصحاب المصلحة.

## كيف تسير الدورة

- نحو **7 أسابيع**، منها أسبوع للمشروع
- نحو **45 فيديو قصيرًا** (قرابة 11 ساعة)، تُنشر أسبوعيًا
- نحو **20 ساعة من المختبرات العملية**
- **4 جلسات متابعة مسجّلة** مع المدربين مدة كل منها 90 دقيقة
- **مشروع ختامي**: الطلب ← جلسة الاستكشاف ← وثيقة النطاق ← البناء ← النشر ← العرض على أصحاب المصلحة، يُراجَع، و**شهادة**

## المدربون

ممارس ضيف (سيُعلَن عنه لاحقًا) مع آية ناصر، مؤسِّسة مجتمع MLOps MENA ومهندسة MLOps أولى.`,
    durationWeeks: 7,
    levels: ['MID', 'SENIOR'],
    level: legacyCourseLevel(['MID', 'SENIOR']),
    topics: ['forward-deployed-engineering', 'llm', 'rag', 'agents', 'deployment', 'consulting'],
    targetAudience: {
      en: `- AI, ML and software engineers who want to work directly with clients and own a solution end to end
- Solution and presales engineers who want to build and deploy, not only design
- Consultants and freelancers delivering AI projects to businesses`,
      ar: `- مهندسو الذكاء الاصطناعي وتعلّم الآلة والبرمجيات الذين يريدون العمل مباشرة مع العملاء وتحمّل مسؤولية الحل من البداية إلى النهاية
- مهندسو الحلول وما قبل البيع الذين يريدون البناء والنشر، لا التصميم فقط
- الاستشاريون والمستقلون الذين ينفّذون مشاريع ذكاء اصطناعي للشركات`,
    },
    learningOutcomes: {
      en: [
        'Run a discovery call and turn a vague business problem into clear requirements and success metrics',
        'Write a scoping document: what is in, what is out, risks, timeline and how success is measured',
        'Choose the simplest AI approach that solves the problem (prompting, RAG, agents or classic ML)',
        "Build and deploy a working AI app in a client-like environment, with evaluation and monitoring",
        'Demo to stakeholders, handle feedback and hand the solution over',
      ],
      ar: [
        'إجراء جلسة استكشاف وتحويل مشكلة عمل غامضة إلى متطلبات واضحة ومؤشرات نجاح',
        'كتابة وثيقة نطاق: ما يدخل فيه وما يخرج منه، والمخاطر، والجدول الزمني، وكيف يُقاس النجاح',
        'اختيار أبسط نهج ذكاء اصطناعي يحل المشكلة (الـ prompting أو RAG أو الوكلاء أو التعلّم الآلي التقليدي)',
        'بناء تطبيق ذكاء اصطناعي يعمل ونشره في بيئة شبيهة ببيئة العميل، مع التقييم والمراقبة',
        'العرض على أصحاب المصلحة، والتعامل مع الملاحظات، وتسليم الحل',
      ],
    },
    prerequisites: {
      en: [
        'Python and experience building at least one LLM or ML application',
        'Docker basics and experience deploying to a cloud provider',
        'Comfortable presenting your work in English or Arabic',
      ],
      ar: [
        'Python وخبرة في بناء تطبيق واحد على الأقل قائم على نموذج لغوي أو تعلّم آلي',
        'أساسيات Docker وخبرة في النشر على أحد مزودي السحابة',
        'الارتياح لعرض عملك بالإنجليزية أو العربية',
      ],
    },
    outline: [
      {
        titleEn: 'Week 1 · The forward deployed engineer',
        titleAr: 'الأسبوع 1 · مهندس النشر الميداني',
        descriptionEn: 'What the role is, how it differs from consulting and product engineering, and the client-style brief you will work on.',
        descriptionAr: 'ما هذا الدور، وكيف يختلف عن الاستشارات وهندسة المنتجات، وطلب العميل الواقعي الذي ستعمل عليه.',
      },
      {
        titleEn: 'Week 2 · Discovery',
        titleAr: 'الأسبوع 2 · الاستكشاف',
        descriptionEn: 'Running the discovery call, mapping stakeholders, data and constraints, and defining success metrics.',
        descriptionAr: 'إدارة جلسة الاستكشاف، وتحديد أصحاب المصلحة والبيانات والقيود، وتعريف مؤشرات النجاح.',
      },
      {
        titleEn: 'Week 3 · Scoping',
        titleAr: 'الأسبوع 3 · تحديد النطاق',
        descriptionEn: 'The written scoping document: in and out of scope, risks, timeline, effort and cost estimate.',
        descriptionAr: 'وثيقة النطاق المكتوبة: ما يدخل في النطاق وما يخرج منه، والمخاطر، والجدول الزمني، وتقدير الجهد والتكلفة.',
      },
      {
        titleEn: 'Week 4 · Build',
        titleAr: 'الأسبوع 4 · البناء',
        descriptionEn: 'Choosing the simplest approach that works, building a first version fast, and evaluating it against the success metrics.',
        descriptionAr: 'اختيار أبسط نهج يعمل، وبناء نسخة أولى بسرعة، وتقييمها مقابل مؤشرات النجاح.',
      },
      {
        titleEn: 'Week 5 · Deploy',
        titleAr: 'الأسبوع 5 · النشر',
        descriptionEn: "Deploying into a client-like environment: security, access, monitoring and what happens when it breaks.",
        descriptionAr: 'النشر في بيئة شبيهة ببيئة العميل: الأمان والصلاحيات والمراقبة وما يحدث عند حدوث عطل.',
      },
      {
        titleEn: 'Week 6 · Demo & handover',
        titleAr: 'الأسبوع 6 · العرض والتسليم',
        descriptionEn: 'The stakeholder demo, handling feedback and scope changes, documentation and handover.',
        descriptionAr: 'العرض على أصحاب المصلحة، والتعامل مع الملاحظات وتغييرات النطاق، والتوثيق والتسليم.',
      },
      {
        titleEn: 'Week 7 · Project Week',
        titleAr: 'الأسبوع 7 · أسبوع المشروع',
        descriptionEn: 'Complete the capstone from brief to stakeholder demo, with the written scope, and submit it for review.',
        descriptionAr: 'أكمل المشروع الختامي من الطلب إلى العرض على أصحاب المصلحة، مع وثيقة النطاق، وسلّمه للمراجعة.',
      },
    ],
    faq: [
      qa(
        'Who teaches the course?',
        'من يقدّم الدورة؟',
        'A guest practitioner who works as a forward deployed engineer (to be announced), together with Aya Nasser.',
        'ممارس ضيف يعمل مهندس نشر ميداني (سيُعلَن عنه لاحقًا)، مع آية ناصر.',
      ),
      qa(
        'What is the capstone?',
        'ما المشروع الختامي؟',
        'A real client-style brief that you take through a discovery call, a written scope, the build, a deployment and a stakeholder demo.',
        'طلب عميل واقعي تمر به عبر جلسة استكشاف، ووثيقة نطاق مكتوبة، والبناء، والنشر، والعرض على أصحاب المصلحة.',
      ),
      ...recordedCohortFaq(4),
    ],
    included: recordedIncluded(
      'About 45 short videos (about 11 hours), about 20 hours of labs, 4 recorded 90-minute follow-ups with the instructors.',
      'نحو 45 فيديو قصيرًا (قرابة 11 ساعة)، ونحو 20 ساعة من المختبرات، و4 جلسات متابعة مسجّلة مع المدربين مدة كل منها 90 دقيقة.',
    ),
  },
  questions: [],
  sessions: [],
};

/** The coming-soon courses from the owner's planning doc (Oct 2026). */
export const plannedCourses: SeedCourse[] = [practitionerRecorded, finops, llmEval, tensorrt, deepstream, fde];

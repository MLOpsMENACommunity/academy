import type { Prisma } from '@prisma/client';
import type { FaqItem, Included, LocalizedList, LocalizedText, OutlineModule } from '@academy/shared';

/**
 * Placeholder catalog content. Search for [PLACEHOLDER] to find everything
 * that must be replaced before launch.
 */

const DAY = 24 * 60 * 60 * 1000;

/** Next occurrence of 17:00 UTC (19:00 Cairo) at least `days` from now. */
function at(daysFromNow: number): Date {
  const d = new Date(Date.now() + daysFromNow * DAY);
  d.setUTCHours(17, 0, 0, 0);
  return d;
}

export interface SeedCourse {
  course: Omit<Prisma.CourseCreateInput, 'instructors' | 'screeningQuestions' | 'sessions'> & {
    targetAudience: LocalizedText;
    notFor: LocalizedText;
    learningOutcomes: LocalizedList;
    prerequisites: LocalizedList;
    outline: OutlineModule[];
    faq: FaqItem[];
    included: Included;
  };
  instructor: Prisma.InstructorCreateInput;
  questions: Omit<Prisma.ScreeningQuestionCreateWithoutCourseInput, 'order'>[];
  sessions: Omit<Prisma.CourseSessionCreateWithoutCourseInput, 'order'>[];
}

const yesNo = { type: 'YES_NO' as const };

export const seedCourses: SeedCourse[] = [
  // ------------------------------------------------------------------ Course 1
  {
    course: {
      slug: 'ai-architecture-design',
      titleEn: 'AI Architecture Design',
      titleAr: 'تصميم معمارية أنظمة الذكاء الاصطناعي',
      shortDescriptionEn:
        'Design production LLM, RAG and agentic systems that are secure, governed and measurable. A 4-week live course for mid-level and senior engineers.',
      shortDescriptionAr:
        'صمّم أنظمة LLM وRAG وأنظمة الوكلاء (Agents) جاهزة للإنتاج، آمنة وقابلة للحوكمة والقياس. دورة مباشرة لمدة 4 أسابيع للمهندسين من المستوى المتوسط والخبراء.',
      longDescriptionEn: `[PLACEHOLDER] Most teams can build an LLM demo in a weekend. Far fewer can run one in production for a year.

This course is about the architecture decisions that separate the two: how to structure LLM systems, which RAG pattern fits which problem, when an agent is the right tool (and when it is not), and how to secure, govern and evaluate everything you ship.

Each week has a live session with a senior practitioner. Sessions are recorded and uploaded to YouTube, but live attendees can ask the instructor questions directly, so try to join live.`,
      longDescriptionAr: `[PLACEHOLDER] يستطيع معظم الفرق بناء نموذج تجريبي لـ LLM في عطلة نهاية أسبوع، لكن القليل منها يستطيع تشغيله في بيئة الإنتاج لمدة عام.

تركز هذه الدورة على القرارات المعمارية التي تصنع هذا الفرق: كيف تُبنى أنظمة LLM، وأي نمط من أنماط RAG يناسب أي مشكلة، ومتى يكون الوكيل (Agent) هو الأداة الصحيحة ومتى لا يكون، وكيف تؤمّن وتحكم وتقيّم كل ما تطلقه.

كل أسبوع جلسة مباشرة مع خبير ممارس. تُسجَّل الجلسات وتُرفع على YouTube، لكن الحضور المباشر يتيح لك طرح أسئلتك على المحاضر مباشرة، لذا حاول الحضور مباشرة.`,
      type: 'FREE',
      price: 0,
      currency: 'EGP',
      requiresApproval: true,
      capacity: 150,
      status: 'OPEN',
      level: 'ADVANCED',
      language: 'BILINGUAL',
      startDate: at(14),
      applicationDeadline: at(10),
      durationWeeks: 4,
      hoursPerWeek: 4,
      deliveryPlatform: 'GOOGLE_MEET',
      recordingsPlatform: 'YOUTUBE',
      youtubePlaylistUrl: 'https://www.youtube.com/@MLOpsMENACommunity/playlists',
      targetAudience: {
        en: 'Mid-level and senior engineers (software, ML, data, platform) who build or will soon build LLM-powered systems at work, and tech leads who need to make architecture calls on them.',
        ar: 'المهندسون من المستوى المتوسط والخبراء (برمجيات، تعلم آلة، بيانات، منصات) الذين يبنون أو سيبنون قريبًا أنظمة تعتمد على LLM في عملهم، وقادة الفرق التقنية الذين يتخذون القرارات المعمارية بشأنها.',
      },
      notFor: {
        en: 'Complete beginners to programming or machine learning, and anyone looking for a prompt-engineering or no-code course.',
        ar: 'المبتدئون تمامًا في البرمجة أو تعلم الآلة، ومن يبحث عن دورة في هندسة الأوامر (Prompt Engineering) أو أدوات بدون كود.',
      },
      learningOutcomes: {
        en: [
          'Choose and justify an architecture for an LLM system given real constraints (latency, cost, data sensitivity)',
          'Compare RAG patterns and pick the right one for a retrieval problem',
          'Decide when an agentic design is warranted, and bound its failure modes',
          'Apply security, governance and evaluation practices before going to production',
          'Learn from enterprise case studies what actually breaks at scale',
        ],
        ar: [
          'اختيار معمارية لنظام LLM وتبريرها وفق قيود حقيقية (زمن الاستجابة، التكلفة، حساسية البيانات)',
          'المقارنة بين أنماط RAG واختيار النمط المناسب لمشكلة الاسترجاع',
          'تحديد متى يكون تصميم الوكلاء (Agents) مبررًا، وكيف تُضبط أنماط فشله',
          'تطبيق ممارسات الأمن والحوكمة والتقييم قبل الإطلاق في بيئة الإنتاج',
          'التعلم من دراسات حالة مؤسسية عمّا ينكسر فعلًا عند التوسع',
        ],
      },
      prerequisites: {
        en: [
          '3+ years building production software or ML systems',
          'Comfortable reading Python and system design diagrams',
          'Have called an LLM API at least once',
        ],
        ar: [
          'خبرة 3 سنوات أو أكثر في بناء برمجيات أو أنظمة تعلم آلة في بيئة الإنتاج',
          'إلمام بقراءة كود Python ومخططات تصميم الأنظمة',
          'استخدام واجهة برمجية (API) لـ LLM مرة واحدة على الأقل',
        ],
      },
      outline: [
        {
          titleEn: 'LLM systems architecture',
          titleAr: 'معمارية أنظمة LLM',
          descriptionEn: 'Gateways, routing, caching, model choice and the cost/latency trade-offs.',
          descriptionAr: 'البوابات والتوجيه والتخزين المؤقت واختيار النموذج، والموازنة بين التكلفة وزمن الاستجابة.',
        },
        {
          titleEn: 'RAG architectures',
          titleAr: 'معماريات RAG',
          descriptionEn: 'Chunking, hybrid search, re-ranking, and when RAG is the wrong answer.',
          descriptionAr: 'التقطيع والبحث الهجين وإعادة الترتيب، ومتى لا يكون RAG هو الحل.',
        },
        {
          titleEn: 'Agentic systems',
          titleAr: 'أنظمة الوكلاء (Agents)',
          descriptionEn: 'Tool use, planning, multi-agent patterns and how to keep them bounded.',
          descriptionAr: 'استخدام الأدوات والتخطيط وأنماط تعدد الوكلاء، وكيف تبقيها تحت السيطرة.',
        },
        {
          titleEn: 'Security, governance and evaluations',
          titleAr: 'الأمن والحوكمة والتقييم',
          descriptionEn: 'Prompt injection, data leakage, policy, and building an evaluation suite.',
          descriptionAr: 'حقن الأوامر وتسرب البيانات والسياسات، وبناء منظومة تقييم.',
        },
        {
          titleEn: 'Enterprise case studies',
          titleAr: 'دراسات حالة مؤسسية',
          descriptionEn: 'What worked and what failed in real deployments across the region.',
          descriptionAr: 'ما الذي نجح وما الذي فشل في مشاريع حقيقية في المنطقة.',
        },
      ],
      faq: [
        {
          questionEn: 'Is the course really free?',
          questionAr: 'هل الدورة مجانية فعلًا؟',
          answerEn: 'Yes. Applicants are screened because live seats are limited, but there is no fee.',
          answerAr: 'نعم. تتم مراجعة الطلبات لأن المقاعد المباشرة محدودة، لكن لا توجد أي رسوم.',
        },
        {
          questionEn: 'What if I miss a live session?',
          questionAr: 'ماذا لو فاتتني جلسة مباشرة؟',
          answerEn: 'Every session is recorded and uploaded to YouTube, usually within 48 hours.',
          answerAr: 'تُسجَّل كل جلسة وتُرفع على YouTube عادةً خلال 48 ساعة.',
        },
        {
          questionEn: 'How do I get the certificate?',
          questionAr: 'كيف أحصل على الشهادة؟',
          answerEn:
            'Weekly assignments are optional, but the final project is mandatory for the certificate.',
          answerAr: 'الواجبات الأسبوعية اختيارية، لكن المشروع النهائي إلزامي للحصول على الشهادة.',
        },
      ],
      included: {
        liveSessions: true,
        recordings: true,
        assignments: true,
        finalProject: true,
        certificate: true,
        notesEn:
          'Assignments after each session are optional. A final project is mandatory to earn the certificate.',
        notesAr: 'الواجبات بعد كل جلسة اختيارية. المشروع النهائي إلزامي للحصول على الشهادة.',
      },
    },
    instructor: {
      name: '[PLACEHOLDER] Guest Instructor',
      nameAr: '[PLACEHOLDER] المحاضر الضيف',
      titleEn: 'Head of AI',
      titleAr: 'رئيس قسم الذكاء الاصطناعي',
      bioEn:
        '[PLACEHOLDER] Head of AI with 20+ years of experience building data and AI platforms for enterprises across the MENA region.',
      bioAr:
        '[PLACEHOLDER] رئيس قسم الذكاء الاصطناعي بخبرة تتجاوز 20 عامًا في بناء منصات البيانات والذكاء الاصطناعي للمؤسسات في منطقة الشرق الأوسط وشمال أفريقيا.',
    },
    questions: [
      {
        type: 'LONG_TEXT',
        labelEn: 'What is your current role, and what are you responsible for?',
        labelAr: 'ما دورك الحالي، وما المسؤوليات التي تتولاها؟',
        required: true,
      },
      {
        type: 'SINGLE_SELECT',
        labelEn: 'Years of hands-on experience building production systems',
        labelAr: 'سنوات الخبرة العملية في بناء أنظمة في بيئة الإنتاج',
        options: [
          { value: 'lt2', labelEn: 'Less than 2', labelAr: 'أقل من سنتين' },
          { value: '2_5', labelEn: '2–5', labelAr: '2–5' },
          { value: '5_10', labelEn: '5–10', labelAr: '5–10' },
          { value: '10plus', labelEn: '10+', labelAr: 'أكثر من 10' },
        ],
        required: true,
      },
      {
        ...yesNo,
        labelEn: 'Have you deployed an LLM or RAG system to production?',
        labelAr: 'هل سبق أن أطلقت نظام LLM أو RAG في بيئة الإنتاج؟',
        required: true,
      },
      {
        type: 'LONG_TEXT',
        labelEn: 'If yes, briefly describe it (scale, stack, what went wrong).',
        labelAr: 'إذا كانت الإجابة نعم، صفه باختصار (الحجم، التقنيات، وما الذي واجهته من مشكلات).',
        required: false,
      },
      {
        type: 'LONG_TEXT',
        labelEn: 'What do you want to get from this course?',
        labelAr: 'ما الذي تريد أن تحققه من هذه الدورة؟',
        required: true,
      },
      {
        ...yesNo,
        labelEn: 'Can you commit to attending the live sessions and submitting a final project?',
        labelAr: 'هل يمكنك الالتزام بحضور الجلسات المباشرة وتسليم مشروع نهائي؟',
        required: true,
      },
    ],
    sessions: [
      {
        titleEn: '[PLACEHOLDER] LLM systems architecture',
        titleAr: '[PLACEHOLDER] معمارية أنظمة LLM',
        startsAt: at(14),
        durationMin: 120,
        liveUrl: 'https://meet.google.com/aaa-bbbb-ccc',
        recordingUrl: null,
      },
      {
        titleEn: '[PLACEHOLDER] RAG architectures',
        titleAr: '[PLACEHOLDER] معماريات RAG',
        startsAt: at(21),
        durationMin: 120,
        liveUrl: 'https://meet.google.com/aaa-bbbb-ccc',
      },
      {
        titleEn: '[PLACEHOLDER] Agentic systems',
        titleAr: '[PLACEHOLDER] أنظمة الوكلاء',
        startsAt: at(28),
        durationMin: 120,
        liveUrl: 'https://meet.google.com/aaa-bbbb-ccc',
      },
      {
        titleEn: '[PLACEHOLDER] Security, governance, evals and case studies',
        titleAr: '[PLACEHOLDER] الأمن والحوكمة والتقييم ودراسات الحالة',
        startsAt: at(35),
        durationMin: 120,
        liveUrl: 'https://meet.google.com/aaa-bbbb-ccc',
      },
    ],
  },

  // ------------------------------------------------------------------ Course 2
  {
    course: {
      slug: 'kubernetes',
      titleEn: 'Kubernetes for ML Engineers',
      titleAr: 'Kubernetes لمهندسي تعلم الآلة',
      shortDescriptionEn:
        'From containers to a production ML model service on Kubernetes: core objects, networking, config, storage, autoscaling and GPUs.',
      shortDescriptionAr:
        'من الحاويات إلى خدمة نموذج تعلم آلة في بيئة الإنتاج على Kubernetes: الكائنات الأساسية والشبكات والإعدادات والتخزين والتوسع التلقائي ووحدات GPU.',
      longDescriptionEn: `[PLACEHOLDER] Kubernetes is where most ML models end up in production, and where many ML engineers feel least at home.

Over six live sessions you will go from a Docker refresher to deploying, scaling and operating a model-serving workload on a real cluster. Every session is hands-on.`,
      longDescriptionAr: `[PLACEHOLDER] ينتهي المطاف بمعظم نماذج تعلم الآلة في بيئة الإنتاج على Kubernetes، وهو المكان الذي يشعر فيه كثير من مهندسي تعلم الآلة بأقل قدر من الألفة.

على مدار ست جلسات مباشرة ستنتقل من مراجعة Docker إلى نشر خدمة لتقديم نموذج وتوسيعها وتشغيلها على Cluster حقيقي. كل جلسة عملية بالكامل.`,
      type: 'PAID',
      price: 0, // [PLACEHOLDER] price in EGP
      currency: 'EGP',
      requiresApproval: true,
      capacity: 40,
      status: 'OPEN',
      level: 'INTERMEDIATE',
      language: 'AR',
      startDate: at(21),
      applicationDeadline: at(16),
      durationWeeks: 6,
      hoursPerWeek: 5,
      deliveryPlatform: 'GOOGLE_MEET',
      recordingsPlatform: 'GOOGLE_DRIVE',
      driveFolderUrl: 'https://drive.google.com/drive/folders/PLACEHOLDER_FOLDER_ID',
      targetAudience: {
        en: 'ML engineers, data scientists and backend engineers who deploy (or want to deploy) models and services, and know Docker basics.',
        ar: 'مهندسو تعلم الآلة وعلماء البيانات ومهندسو Backend الذين ينشرون (أو يريدون نشر) النماذج والخدمات، ولديهم أساسيات Docker.',
      },
      notFor: {
        en: 'Experienced Kubernetes operators or platform engineers; this course does not cover cluster administration in depth.',
        ar: 'المحترفون في تشغيل Kubernetes أو مهندسو المنصات؛ لا تغطي هذه الدورة إدارة الـ Cluster بعمق.',
      },
      learningOutcomes: {
        en: [
          'Explain and use the core Kubernetes objects confidently',
          'Expose services with Deployments, Services and Ingress',
          'Manage configuration, secrets and persistent storage',
          'Autoscale workloads and schedule GPU jobs',
          'Deploy and operate an ML model service on Kubernetes end to end',
        ],
        ar: [
          'شرح الكائنات الأساسية في Kubernetes واستخدامها بثقة',
          'إتاحة الخدمات باستخدام Deployments وServices وIngress',
          'إدارة الإعدادات والأسرار (Secrets) والتخزين الدائم',
          'التوسع التلقائي للأحمال وجدولة مهام GPU',
          'نشر خدمة نموذج تعلم آلة وتشغيلها على Kubernetes من البداية للنهاية',
        ],
      },
      prerequisites: {
        en: ['Comfortable on the Linux command line', 'Have built and run a Docker image', 'Basic Python'],
        ar: ['إلمام بسطر أوامر Linux', 'بناء صورة Docker وتشغيلها من قبل', 'أساسيات Python'],
      },
      outline: [
        { titleEn: 'Containers & Docker refresher', titleAr: 'مراجعة الحاويات وDocker' },
        { titleEn: 'Kubernetes core objects', titleAr: 'الكائنات الأساسية في Kubernetes' },
        { titleEn: 'Deployments, Services, Ingress', titleAr: 'Deployments وServices وIngress' },
        { titleEn: 'Config, secrets and storage', titleAr: 'الإعدادات والأسرار والتخزين' },
        { titleEn: 'Autoscaling and GPU workloads', titleAr: 'التوسع التلقائي وأحمال GPU' },
        {
          titleEn: 'Deploying an ML model service on Kubernetes',
          titleAr: 'نشر خدمة نموذج تعلم آلة على Kubernetes',
        },
      ],
      faq: [
        {
          questionEn: 'How do I pay?',
          questionAr: 'كيف أدفع؟',
          answerEn:
            'After your application is accepted you will see InstaPay and Vodafone Cash details, then upload proof of payment. An admin verifies it, usually within 2 working days.',
          answerAr:
            'بعد قبول طلبك ستظهر لك بيانات InstaPay وفودافون كاش، ثم ترفع إثبات الدفع. يراجعه أحد المسؤولين عادةً خلال يومي عمل.',
        },
        {
          questionEn: 'How do I access recordings?',
          questionAr: 'كيف أصل إلى التسجيلات؟',
          answerEn:
            'Recordings are in a private Google Drive folder shared only with the Google account in your profile.',
          answerAr:
            'التسجيلات موجودة في مجلد خاص على Google Drive تتم مشاركته فقط مع حساب Google المسجل في ملفك الشخصي.',
        },
        {
          questionEn: 'Do I need a cloud account?',
          questionAr: 'هل أحتاج إلى حساب سحابي؟',
          answerEn: '[PLACEHOLDER] No. A local cluster (kind or minikube) is enough for all labs.',
          answerAr: '[PLACEHOLDER] لا. يكفي Cluster محلي (kind أو minikube) لجميع التمارين.',
        },
      ],
      included: {
        liveSessions: true,
        recordings: true,
        assignments: true,
        finalProject: false,
        certificate: false,
      },
    },
    instructor: {
      name: '[PLACEHOLDER] Kubernetes Instructor',
      nameAr: '[PLACEHOLDER] محاضر Kubernetes',
      titleEn: '[PLACEHOLDER] Senior Platform Engineer',
      titleAr: '[PLACEHOLDER] مهندس منصات أول',
      bioEn: '[PLACEHOLDER] Runs production Kubernetes clusters for ML workloads.',
      bioAr: '[PLACEHOLDER] يدير Clusters من Kubernetes في بيئة الإنتاج لأحمال تعلم الآلة.',
    },
    questions: [
      {
        type: 'SINGLE_SELECT',
        labelEn: 'Your experience with Docker',
        labelAr: 'خبرتك في Docker',
        options: [
          { value: 'none', labelEn: 'None', labelAr: 'لا توجد' },
          { value: 'basic', labelEn: 'Basic', labelAr: 'أساسية' },
          { value: 'production', labelEn: 'Production', labelAr: 'في بيئة الإنتاج' },
        ],
        required: true,
      },
      {
        type: 'SINGLE_SELECT',
        labelEn: 'Your experience with Kubernetes',
        labelAr: 'خبرتك في Kubernetes',
        options: [
          { value: 'none', labelEn: 'None', labelAr: 'لا توجد' },
          { value: 'basic', labelEn: 'Basic', labelAr: 'أساسية' },
          { value: 'production', labelEn: 'Production', labelAr: 'في بيئة الإنتاج' },
        ],
        required: true,
      },
      {
        type: 'MULTI_SELECT',
        labelEn: 'Which cloud(s) have you used?',
        labelAr: 'ما المنصات السحابية التي استخدمتها؟',
        options: [
          { value: 'aws', labelEn: 'AWS', labelAr: 'AWS' },
          { value: 'gcp', labelEn: 'Google Cloud', labelAr: 'Google Cloud' },
          { value: 'azure', labelEn: 'Azure', labelAr: 'Azure' },
          { value: 'other', labelEn: 'Other', labelAr: 'أخرى' },
          { value: 'none', labelEn: 'None yet', labelAr: 'لم أستخدم أيًّا منها بعد' },
        ],
        required: true,
      },
      {
        type: 'LONG_TEXT',
        labelEn: "What's your goal with this course?",
        labelAr: 'ما هدفك من هذه الدورة؟',
        required: true,
      },
    ],
    sessions: [
      'Containers & Docker refresher|مراجعة الحاويات وDocker',
      'Kubernetes core objects|الكائنات الأساسية في Kubernetes',
      'Deployments, Services, Ingress|Deployments وServices وIngress',
      'Config, secrets and storage|الإعدادات والأسرار والتخزين',
      'Autoscaling and GPU workloads|التوسع التلقائي وأحمال GPU',
      'Deploying an ML model service|نشر خدمة نموذج تعلم آلة',
    ].map((pair, i) => {
      const [en, ar] = pair.split('|') as [string, string];
      return {
        titleEn: `[PLACEHOLDER] ${en}`,
        titleAr: `[PLACEHOLDER] ${ar}`,
        startsAt: at(21 + i * 7),
        durationMin: 120,
        liveUrl: 'https://meet.google.com/xxx-yyyy-zzz',
      };
    }),
  },
];

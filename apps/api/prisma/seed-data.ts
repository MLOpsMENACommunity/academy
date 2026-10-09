import type { Prisma } from '@prisma/client';
import type { FaqItem, Included, LocalizedList, LocalizedText, OutlineModule } from '@academy/shared';

/**
 * Launch catalog. Search for [PLACEHOLDER] to find content that must still be
 * replaced. Times are UTC: Cairo is UTC+3 until 29 Oct 2026, then UTC+2, so
 * "7:00 PM Cairo" is 16:00Z in October and 17:00Z in November.
 */

export interface SeedCourse {
  course: Omit<Prisma.CourseCreateInput, 'instructors' | 'screeningQuestions' | 'sessions'> & {
    targetAudience: LocalizedText;
    notFor: LocalizedText;
    preparation: LocalizedText;
    learningOutcomes: LocalizedList;
    prerequisites: LocalizedList;
    outline: OutlineModule[];
    faq: FaqItem[];
    included: Included;
  };
  /**
   * Placeholder courses never go live by accident: in production they start as drafts
   * unless SEED_PLACEHOLDER_STATUS says otherwise.
   */
  placeholder?: boolean;
  /**
   * `longDescriptionEn` of earlier versions of this seed. A course still holding one of them,
   * never edited by an admin, is updated in place to this version on the next start
   * (see seed-catalog.ts). Admin edits are never overwritten.
   */
  supersedes?: string[];
  instructor?: Prisma.InstructorCreateInput;
  questions: Omit<Prisma.ScreeningQuestionCreateWithoutCourseInput, 'order'>[];
  sessions: Omit<Prisma.CourseSessionCreateWithoutCourseInput, 'order'>[];
}

const PLAYLIST = 'https://www.youtube.com/playlist?list=PLfBN40jBVI-U';

// ------------------------------------------------------------------ AI Architecture Design

const aiArchitecture: SeedCourse = {
  course: {
    slug: 'ai-architecture-design',
    titleEn: 'AI Architecture Design',
    titleAr: 'تصميم معمارية أنظمة الذكاء الاصطناعي',
    shortDescriptionEn:
      'Design production-grade AI systems: LLMs, RAG, agents, security and evaluation, from whiteboard to enterprise. Free, 6 live sessions on Sundays, with a certificate.',
    shortDescriptionAr:
      'صمّم أنظمة ذكاء اصطناعي جاهزة للإنتاج: نماذج اللغة الكبيرة (LLMs) وRAG والوكلاء (Agents) والأمن والتقييم، من السبورة إلى المؤسسة. مجانية، 6 جلسات مباشرة أيام الأحد، مع شهادة.',
    longDescriptionEn: `Most engineers can now build a RAG app or an AI agent in a day. Far fewer can design one that survives real traffic, real security reviews, real budgets and real regulators.

This course teaches you to think and work like an AI architect. You'll learn to turn a vague business request into a defensible architecture: choose models with evidence, design retrieval that fits your documents and languages, add agents only where they earn their place, threat-model the system, and prove it works with evaluations and monitoring.

You'll learn from real enterprise systems in telecom, e-commerce and government. Throughout the course you build one complete architecture, which becomes your capstone project.

## How the course works

- **Live sessions on Google Meet**, every Sunday 7:00–8:30 PM Cairo time
- **Every lecture is recorded** and uploaded to YouTube. [Watch the playlist →](${PLAYLIST})
- **Live Q&A with the instructor**: attending live lets you put questions about your own architecture to someone with 20+ years in the field
- **A short quiz after every session** to lock in what you learned (links shared after each session)
- **One GitHub repository for the whole course**, which holds your assignments and capstone
- **Study groups on Telegram** for questions, peer reviews and announcements (link announced soon)

There's a midpoint break week after Session 3 (8–14 Nov): no live session, but a Midpoint Quiz on Sessions 1–3 and the first half of your capstone, due Saturday 14 Nov for feedback.

## Certificate requirements

To earn the AI Architecture Design certificate, complete all three:

1. **All session quizzes**, one after each of the 6 sessions
2. **The Midpoint Quiz** in the break week (8–14 Nov)
3. **The final capstone project**, submitted by **Sunday 13 Dec 2026** with a score of **70/100 or higher**

Assignments after each session are optional, but each one becomes a section of your capstone, so doing them makes the final project much easier.

## The capstone

Design a complete, production-grade architecture for an enterprise AI system in telecom, e-commerce, government, or your own approved domain. It includes an architecture document, C4 diagrams, ADRs, a cost estimate, a threat model, and an evaluation and monitoring plan. A small proof of concept earns bonus points.

Quiz links, the Assignments & Capstone Handbook and the submission forms are shared on your course page as the course progresses.`,
    longDescriptionAr: `يستطيع معظم المهندسين اليوم بناء تطبيق RAG أو وكيل ذكاء اصطناعي (Agent) في يوم واحد، لكن القليل منهم يستطيع تصميم نظام يصمد أمام حركة استخدام حقيقية، ومراجعات أمنية حقيقية، وميزانيات حقيقية، وجهات تنظيمية حقيقية.

تعلّمك هذه الدورة أن تفكر وتعمل كمعماري أنظمة ذكاء اصطناعي. ستتعلم كيف تحوّل طلبًا غامضًا من جهة العمل إلى معمارية يمكن الدفاع عنها: تختار النماذج بالأدلة، وتصمم استرجاعًا يناسب مستنداتك ولغاتك، وتضيف الوكلاء فقط حيث يستحقون مكانهم، وتحلل التهديدات الأمنية للنظام، وتثبت أنه يعمل من خلال التقييم والمراقبة.

ستتعلم من أنظمة مؤسسية حقيقية في قطاعات الاتصالات والتجارة الإلكترونية والقطاع الحكومي. وعلى مدار الدورة تبني معمارية واحدة متكاملة تصبح مشروعك الختامي.

## كيف تسير الدورة

- **جلسات مباشرة على Google Meet** كل أحد من 7:00 إلى 8:30 مساءً بتوقيت القاهرة
- **تُسجَّل كل محاضرة** وتُرفع على YouTube. [شاهد قائمة التشغيل ←](${PLAYLIST})
- **أسئلة وأجوبة مباشرة مع المحاضر**: يتيح لك الحضور المباشر طرح أسئلة عن معمارية نظامك على خبير بأكثر من 20 عامًا في المجال
- **اختبار قصير بعد كل جلسة** لتثبيت ما تعلمته (تُشارك الروابط بعد كل جلسة)
- **مستودع GitHub واحد للدورة كاملة** يضم واجباتك ومشروعك الختامي
- **مجموعات دراسة على Telegram** للأسئلة ومراجعات الزملاء والإعلانات (يُعلن الرابط قريبًا)

بعد الجلسة الثالثة أسبوع استراحة في منتصف الدورة (8–14 نوفمبر): لا توجد جلسة مباشرة، لكن هناك اختبار منتصف الدورة على الجلسات 1–3 والنصف الأول من مشروعك الختامي، ويُسلَّم يوم السبت 14 نوفمبر للحصول على ملاحظات.

## متطلبات الشهادة

للحصول على شهادة تصميم معمارية أنظمة الذكاء الاصطناعي، أكمل الثلاثة التالية:

1. **جميع اختبارات الجلسات**، اختبار بعد كل جلسة من الجلسات الست
2. **اختبار منتصف الدورة** في أسبوع الاستراحة (8–14 نوفمبر)
3. **المشروع الختامي**، ويُسلَّم قبل **الأحد 13 ديسمبر 2026** بدرجة **70/100 أو أعلى**

الواجبات بعد كل جلسة اختيارية، لكن كل واجب يصبح جزءًا من مشروعك الختامي، لذا فإن إنجازها يجعل المشروع النهائي أسهل كثيرًا.

## المشروع الختامي

صمّم معمارية متكاملة جاهزة للإنتاج لنظام ذكاء اصطناعي مؤسسي في قطاع الاتصالات أو التجارة الإلكترونية أو القطاع الحكومي، أو في مجال تختاره ونوافق عليه. يتضمن المشروع وثيقة معمارية، ومخططات C4، وسجلات قرارات معمارية (ADRs)، وتقديرًا للتكلفة، وتحليلًا للتهديدات، وخطة للتقييم والمراقبة. ويحصل النموذج الأولي الصغير (Proof of Concept) على درجات إضافية.

تُشارك روابط الاختبارات ودليل الواجبات والمشروع الختامي ونماذج التسليم على صفحة الدورة الخاصة بك مع تقدم الدورة.`,
    type: 'FREE',
    price: 0,
    currency: 'EGP',
    requiresApproval: true,
    // "Seats are limited": set a number in the admin panel once you know it.
    capacity: null,
    status: 'OPEN',
    level: 'ADVANCED',
    language: 'BILINGUAL',
    startDate: new Date('2026-10-18T16:00:00Z'),
    applicationsOpenAt: null,
    // Saturday 17 Oct 2026, 23:59 Cairo (UTC+3).
    applicationDeadline: new Date('2026-10-17T20:59:00Z'),
    durationWeeks: 7,
    hoursPerWeek: 5,
    deliveryPlatform: 'GOOGLE_MEET',
    recordingsPlatform: 'YOUTUBE',
    youtubePlaylistUrl: PLAYLIST,
    driveFolderUrl: null,
    coverImageUrl: null,
    targetAudience: {
      en: 'Mid-level and senior engineers (3+ years) in AI, ML, MLOps, backend or platform roles; engineers moving toward tech lead, staff or architect roles; and engineers who have built RAG apps or agents and want to design them for production at enterprise scale.',
      ar: 'المهندسون من المستوى المتوسط والخبراء (3 سنوات أو أكثر) في مجالات الذكاء الاصطناعي وتعلم الآلة وMLOps والـ Backend والمنصات؛ والمهندسون المتجهون إلى أدوار قائد تقني أو Staff أو معماري؛ والمهندسون الذين بنوا تطبيقات RAG أو وكلاء ويريدون تصميمها للإنتاج على مستوى المؤسسات.',
    },
    notFor: {
      en: 'Beginners. Applications go through a short screening so everyone in the room is at a similar level and the discussions stay deep. Earlier in your career? Follow the recordings on YouTube and apply to a future cohort.',
      ar: 'المبتدئون. تمر الطلبات بمراجعة قصيرة ليكون الجميع في مستوى متقارب وتبقى النقاشات عميقة. إن كنت في بداية مسيرتك، تابع التسجيلات على YouTube وقدّم على دفعة قادمة.',
    },
    preparation: {
      en: `### Before Session 1: create your course repository

Create **one public GitHub repository** for the whole course. Every assignment, diagram, decision record and your capstone will live there. By the end of the course it's a portfolio you can show in interviews.

**Name it:** \`ai-architecture-portfolio\`

Use this structure:

\`\`\`text
ai-architecture-portfolio/
├── README.md        # your scenario, assumptions, how to read the repo
├── docs/            # one file per session: 01-framing.md, 02-building-blocks.md ...
├── diagrams/        # exported PNG/SVG + source files
├── adr/             # one file per decision: 0001-model-hosting.md ...
└── capstone/        # final architecture PDF + slides
\`\`\`

**Then:** post your repo link in the course study group before **Sunday 18 Oct**. Each session adds a new file to \`docs/\`, so your commit history shows your progress through the course.`,
      ar: `### قبل الجلسة الأولى: أنشئ مستودع الدورة

أنشئ **مستودعًا عامًا واحدًا على GitHub** للدورة كاملة. سيضم كل واجب ومخطط وسجل قرار معماري ومشروعك الختامي. وبنهاية الدورة يصبح ملف أعمال (Portfolio) يمكنك عرضه في مقابلات العمل.

**اسم المستودع:** \`ai-architecture-portfolio\`

استخدم هذا الهيكل:

\`\`\`text
ai-architecture-portfolio/
├── README.md        # your scenario, assumptions, how to read the repo
├── docs/            # one file per session: 01-framing.md, 02-building-blocks.md ...
├── diagrams/        # exported PNG/SVG + source files
├── adr/             # one file per decision: 0001-model-hosting.md ...
└── capstone/        # final architecture PDF + slides
\`\`\`

**بعد ذلك:** انشر رابط مستودعك في مجموعة الدراسة الخاصة بالدورة قبل **الأحد 18 أكتوبر**. تضيف كل جلسة ملفًا جديدًا إلى مجلد \`docs/\`، فيُظهر سجل الـ commits تقدّمك خلال الدورة.`,
    },
    learningOutcomes: {
      en: [
        'Turn a business problem into a scoped architecture with measurable quality targets',
        'Design and communicate systems with C4 diagrams and Architecture Decision Records',
        'Choose between API and self-hosted LLMs with evidence, not leaderboards',
        'Design RAG pipelines for real documents, Arabic and English, and access control',
        'Decide when an agent is justified, and design its tools, memory, approvals and guardrails',
        'Threat-model AI systems: prompt injection, data leakage, tool misuse',
        "Apply regional compliance (Saudi PDPL, Egypt's Data Protection Law, UAE PDPL)",
        'Build evaluation and monitoring plans with release gates and rollback criteria',
        'Learn the real trade-offs behind enterprise AI systems in production',
      ],
      ar: [
        'تحويل مشكلة من جهة العمل إلى معمارية محددة النطاق بأهداف جودة قابلة للقياس',
        'تصميم الأنظمة وشرحها باستخدام مخططات C4 وسجلات القرارات المعمارية (ADRs)',
        'الاختيار بين نماذج LLM عبر API والنماذج المستضافة ذاتيًا بالأدلة، لا بجداول الترتيب',
        'تصميم مسارات RAG لمستندات حقيقية، بالعربية والإنجليزية، مع التحكم في الوصول',
        'تحديد متى يكون الوكيل (Agent) مبررًا، وتصميم أدواته وذاكرته وموافقاته وضوابطه',
        'تحليل التهديدات الأمنية لأنظمة الذكاء الاصطناعي: حقن الأوامر وتسرب البيانات وإساءة استخدام الأدوات',
        'تطبيق متطلبات الامتثال الإقليمية (نظام حماية البيانات الشخصية السعودي، وقانون حماية البيانات الشخصية المصري، وقانون حماية البيانات الإماراتي)',
        'بناء خطط للتقييم والمراقبة مع بوابات للإطلاق ومعايير للتراجع',
        'فهم الموازنات الحقيقية وراء أنظمة الذكاء الاصطناعي المؤسسية في بيئة الإنتاج',
      ],
    },
    prerequisites: {
      en: [
        '3+ years building software or ML systems in a team',
        'At least one service, API or model shipped to real users',
        'Comfortable with Python, REST APIs and basic cloud concepts (containers, managed databases)',
        'Hands-on exposure to LLMs (API calls, prompting, or a simple RAG)',
      ],
      ar: [
        'خبرة 3 سنوات أو أكثر في بناء برمجيات أو أنظمة تعلم آلة ضمن فريق',
        'إطلاق خدمة أو واجهة برمجية (API) أو نموذج واحد على الأقل لمستخدمين حقيقيين',
        'إلمام بـ Python وواجهات REST ومفاهيم السحابة الأساسية (الحاويات، قواعد البيانات المُدارة)',
        'تجربة عملية مع نماذج LLM (استدعاءات API، كتابة الأوامر، أو تطبيق RAG بسيط)',
      ],
    },
    outline: [
      {
        titleEn: 'Architecture Views, Steps and Process',
        titleAr: 'المناظير المعمارية والخطوات والعملية',
        descriptionEn: 'Sun 18 Oct. Frame the system before you design it.',
        descriptionAr: 'الأحد 18 أكتوبر. حدّد إطار النظام قبل أن تصممه.',
      },
      {
        titleEn: 'AI System Building Blocks',
        titleAr: 'المكونات الأساسية لأنظمة الذكاء الاصطناعي',
        descriptionEn: 'Sun 25 Oct. From data pipelines to serving, and what it costs.',
        descriptionAr: 'الأحد 25 أكتوبر. من مسارات البيانات إلى تقديم النماذج، وكم يكلّف ذلك.',
      },
      {
        titleEn: 'LLM & RAG Architecture',
        titleAr: 'معمارية LLM وRAG',
        descriptionEn:
          'Sun 1 Nov. Choosing models with evidence and designing retrieval that works. Followed by the midpoint break (8–14 Nov): Midpoint Quiz and Capstone Part 1, no live session.',
        descriptionAr:
          'الأحد 1 نوفمبر. اختيار النماذج بالأدلة وتصميم استرجاع يعمل فعلًا. يليها أسبوع استراحة منتصف الدورة (8–14 نوفمبر): اختبار المنتصف والجزء الأول من المشروع الختامي، بدون جلسة مباشرة.',
      },
      {
        titleEn: 'Agentic AI Architecture',
        titleAr: 'معمارية أنظمة الوكلاء (Agentic AI)',
        descriptionEn: "Sun 15 Nov. Agents that earn their place, and can't do damage.",
        descriptionAr: 'الأحد 15 نوفمبر. وكلاء يستحقون مكانهم، ولا يستطيعون إحداث ضرر.',
      },
      {
        titleEn: 'Security, Governance, Evals',
        titleAr: 'الأمن والحوكمة والتقييم',
        descriptionEn: "Sun 22 Nov. Prove it's safe to ship, and know when it breaks.",
        descriptionAr: 'الأحد 22 نوفمبر. أثبت أن النظام آمن للإطلاق، واعرف متى يتعطل.',
      },
      {
        titleEn: 'Enterprise Case Studies',
        titleAr: 'دراسات حالة مؤسسية',
        descriptionEn: "Sun 29 Nov. How real systems were designed, and what we'd change. Capstone due Sun 13 Dec.",
        descriptionAr: 'الأحد 29 نوفمبر. كيف صُممت أنظمة حقيقية، وما الذي كنا سنغيّره. تسليم المشروع الختامي الأحد 13 ديسمبر.',
      },
    ],
    faq: [
      {
        questionEn: 'Is the course really free?',
        questionAr: 'هل الدورة مجانية فعلًا؟',
        answerEn: "Yes. There's no fee and no payment. Because seats are limited, every application goes through a short screening form.",
        answerAr: 'نعم. لا توجد أي رسوم أو مدفوعات. ولأن المقاعد محدودة، يمر كل طلب بنموذج مراجعة قصير.',
      },
      {
        questionEn: 'When does registration close?',
        questionAr: 'متى يُغلق التسجيل؟',
        answerEn: 'Saturday, 17 October 2026, the day before Session 1.',
        answerAr: 'يوم السبت 17 أكتوبر 2026، قبل الجلسة الأولى بيوم.',
      },
      {
        questionEn: "I'm a junior engineer. Can I join?",
        questionAr: 'أنا مهندس مبتدئ. هل يمكنني الانضمام؟',
        answerEn:
          "This course is built for mid-level and senior engineers. If you're earlier in your career, follow the recordings on YouTube and apply to a future cohort.",
        answerAr: 'صُممت هذه الدورة للمهندسين من المستوى المتوسط والخبراء. إن كنت في بداية مسيرتك، تابع التسجيلات على YouTube وقدّم على دفعة قادمة.',
      },
      {
        questionEn: 'Do I need to write code?',
        questionAr: 'هل أحتاج إلى كتابة كود؟',
        answerEn:
          'No code is required. This is an architecture course: you design, document and defend systems. A small proof of concept in the capstone is optional bonus work.',
        answerAr:
          'لا يلزم كتابة أي كود. هذه دورة في المعمارية: تصمم الأنظمة وتوثقها وتدافع عن قراراتها. والنموذج الأولي الصغير في المشروع الختامي عمل إضافي اختياري.',
      },
      {
        questionEn: 'Do I need a GitHub account?',
        questionAr: 'هل أحتاج إلى حساب على GitHub؟',
        answerEn:
          "Yes. You'll keep all your course work in one public GitHub repository. Create it before Session 1. No coding is needed: it holds your Markdown documents and diagrams.",
        answerAr:
          'نعم. ستحفظ كل أعمال الدورة في مستودع عام واحد على GitHub. أنشئه قبل الجلسة الأولى. لا يلزم أي كود: سيضم مستندات Markdown ومخططاتك.',
      },
      {
        questionEn: 'What if I miss a session?',
        questionAr: 'ماذا لو فاتتني جلسة؟',
        answerEn: "Every session is on YouTube afterwards. Watch it and complete that session's quiz. Quizzes are required for the certificate.",
        answerAr: 'تُرفع كل جلسة على YouTube بعد انتهائها. شاهدها وأكمل اختبار تلك الجلسة. الاختبارات مطلوبة للحصول على الشهادة.',
      },
      {
        questionEn: 'Are the assignments mandatory?',
        questionAr: 'هل الواجبات إلزامية؟',
        answerEn: 'No. Assignments are optional. The session quizzes, the Midpoint Quiz and the capstone project are required for the certificate.',
        answerAr: 'لا. الواجبات اختيارية. أما اختبارات الجلسات واختبار منتصف الدورة والمشروع الختامي فهي مطلوبة للحصول على الشهادة.',
      },
      {
        questionEn: 'How long does it take per week?',
        questionAr: 'كم تستغرق الدورة أسبوعيًا؟',
        answerEn: 'Plan for about 4–5 hours per week: the 1.5-hour live session, the quiz, and time on your assignment or capstone.',
        answerAr: 'خطط لنحو 4–5 ساعات أسبوعيًا: الجلسة المباشرة لمدة ساعة ونصف، والاختبار، ووقت للعمل على واجبك أو مشروعك الختامي.',
      },
      {
        questionEn: 'Where do I ask questions between sessions?',
        questionAr: 'أين أطرح أسئلتي بين الجلسات؟',
        answerEn: 'In the course study groups on Telegram. The link will be announced soon.',
        answerAr: 'في مجموعات الدراسة الخاصة بالدورة على Telegram. سيُعلن الرابط قريبًا.',
      },
      {
        questionEn: 'Who organises the course?',
        questionAr: 'من ينظم الدورة؟',
        answerEn: 'MLOps MENA Community, a bilingual Arabic/English community for ML and AI practitioners across the MENA region.',
        answerAr: 'مجتمع MLOps MENA، وهو مجتمع ثنائي اللغة (العربية والإنجليزية) لممارسي تعلم الآلة والذكاء الاصطناعي في منطقة الشرق الأوسط وشمال أفريقيا.',
      },
    ],
    included: {
      liveSessions: true,
      recordings: true,
      assignments: true,
      finalProject: true,
      certificate: true,
      notesEn:
        'Session quizzes, the Midpoint Quiz and the capstone (70/100 or higher) are required for the certificate. Assignments are optional and build up your capstone.',
      notesAr:
        'اختبارات الجلسات واختبار منتصف الدورة والمشروع الختامي (70/100 أو أعلى) مطلوبة للحصول على الشهادة. الواجبات اختيارية وتبني مشروعك الختامي تدريجيًا.',
    },
  },
  instructor: {
    name: 'Eng. Sameh Amin',
    nameAr: 'م. سامح أمين',
    titleEn: 'Head of Artificial Intelligence, Unifonic',
    titleAr: 'رئيس قسم الذكاء الاصطناعي في Unifonic',
    bioEn: `Sameh has over 20 years in software and AI engineering and nearly a decade building AI organisations and production AI systems across the Middle East and Europe.

At Unifonic, he founded the AI department from scratch. He launched an Arabic/English NLP engine, built a real-time SMS classifier processing 5,000 messages per second, and scaled AI to 6 squads of 20+ engineers delivering RAG, summarisation and text-generation services. He now leads Unifonic's agentic AI startup, which lets customers build working agents in under an hour.

Before Unifonic, at DocuSign he designed an AI contract-negotiation system processing 100K+ contracts. At Etisalat he delivered the company's first NLP chatbot, a recommendation engine that lifted digital engagement by 70%, OCR document automation, and deep-learning face login.

He holds an MSc in Artificial Intelligence from the University of Colorado Boulder and engineering leadership training from Cornell University.`,
    bioAr: `يمتلك سامح خبرة تتجاوز 20 عامًا في هندسة البرمجيات والذكاء الاصطناعي، وقرابة عقد في بناء فرق الذكاء الاصطناعي وأنظمته في بيئة الإنتاج في الشرق الأوسط وأوروبا.

في Unifonic أسّس قسم الذكاء الاصطناعي من الصفر. أطلق محركًا لمعالجة اللغة الطبيعية بالعربية والإنجليزية، وبنى مصنّفًا فوريًا لرسائل SMS يعالج 5,000 رسالة في الثانية، ووسّع فريق الذكاء الاصطناعي إلى 6 فرق تضم أكثر من 20 مهندسًا تقدم خدمات RAG والتلخيص وتوليد النصوص. ويقود اليوم الشركة الناشئة التابعة لـ Unifonic في مجال الوكلاء الذكيين (Agentic AI)، التي تتيح للعملاء بناء وكلاء يعملون فعليًا في أقل من ساعة.

قبل Unifonic، صمّم في DocuSign نظامًا للتفاوض على العقود بالذكاء الاصطناعي يعالج أكثر من 100 ألف عقد. وفي Etisalat قدّم أول روبوت محادثة يعتمد على معالجة اللغة الطبيعية في الشركة، ومحرك توصيات رفع التفاعل الرقمي بنسبة 70%، وأتمتة المستندات بتقنية التعرف الضوئي على الحروف (OCR)، وتسجيل الدخول ببصمة الوجه باستخدام التعلم العميق.

حاصل على ماجستير في الذكاء الاصطناعي من جامعة كولورادو بولدر، وتدريب في القيادة الهندسية من جامعة كورنيل.`,
  },
  questions: [
    {
      type: 'LONG_TEXT',
      labelEn: 'Describe a service, API or model you have shipped to real users. What was your role?',
      labelAr: 'صف خدمة أو واجهة برمجية (API) أو نموذجًا أطلقته لمستخدمين حقيقيين. ما كان دورك؟',
      helpEn: 'A few sentences: what it did, its scale, and what you were responsible for.',
      helpAr: 'بضع جمل: ماذا كان يفعل، وحجمه، وما كانت مسؤوليتك.',
      required: true,
    },
    {
      type: 'SINGLE_SELECT',
      labelEn: 'Your hands-on experience with LLMs',
      labelAr: 'خبرتك العملية مع نماذج LLM',
      options: [
        { value: 'api', labelEn: 'API calls and prompting', labelAr: 'استدعاءات API وكتابة الأوامر' },
        { value: 'prototype', labelEn: 'Built a RAG app or agent prototype', labelAr: 'بنيت نموذجًا أوليًا لتطبيق RAG أو وكيل' },
        { value: 'production', labelEn: 'Run a RAG app or agent in production', labelAr: 'أشغّل تطبيق RAG أو وكيلًا في بيئة الإنتاج' },
        { value: 'none', labelEn: 'None yet', labelAr: 'لا توجد بعد' },
      ],
      required: true,
    },
    {
      type: 'SINGLE_SELECT',
      labelEn: 'Which domain would you like to design your capstone for?',
      labelAr: 'في أي مجال تود تصميم مشروعك الختامي؟',
      options: [
        { value: 'telecom', labelEn: 'Telecom', labelAr: 'الاتصالات' },
        { value: 'ecommerce', labelEn: 'E-commerce', labelAr: 'التجارة الإلكترونية' },
        { value: 'government', labelEn: 'Government', labelAr: 'القطاع الحكومي' },
        { value: 'own', labelEn: 'My own domain (to be approved)', labelAr: 'مجال خاص بي (يتطلب الموافقة)', requiresDetail: true },
      ],
      required: true,
    },
    {
      type: 'LONG_TEXT',
      labelEn: 'What do you want to get out of this course?',
      labelAr: 'ما الذي تريد أن تحققه من هذه الدورة؟',
      required: true,
    },
    {
      type: 'YES_NO',
      labelEn:
        'Can you commit about 4–5 hours a week: live sessions on Sundays 7:00–8:30 PM Cairo time, a quiz after each session, and the capstone by 13 Dec?',
      labelAr:
        'هل يمكنك الالتزام بنحو 4–5 ساعات أسبوعيًا: الجلسات المباشرة أيام الأحد من 7:00 إلى 8:30 مساءً بتوقيت القاهرة، واختبار بعد كل جلسة، والمشروع الختامي قبل 13 ديسمبر؟',
      required: true,
    },
    {
      type: 'YES_NO',
      labelEn: 'Will you keep your course work in one public GitHub repository (ai-architecture-portfolio)?',
      labelAr: 'هل ستحفظ أعمال الدورة في مستودع عام واحد على GitHub باسم ai-architecture-portfolio؟',
      required: true,
    },
  ],
  sessions: [
    {
      titleEn: 'Session 1: Architecture Views, Steps and Process',
      titleAr: 'الجلسة 1: المناظير المعمارية والخطوات والعملية',
      descriptionEn: `Frame the system before you design it.

• Introduction to architecture design for AI systems
• Architecture viewpoints and stakeholders
• Quality attributes: latency, cost, accuracy, security, availability
• Design steps and verification
• Frameworks: C4, TOGAF, Zachman
• Real-world use case

Session quiz (required). Optional assignment: choose your scenario, write the problem statement, rank quality attributes, and draw C4 Level 1 & 2.`,
      descriptionAr: `حدّد إطار النظام قبل أن تصممه.

• مقدمة في تصميم معمارية أنظمة الذكاء الاصطناعي
• المناظير المعمارية وأصحاب المصلحة
• سمات الجودة: زمن الاستجابة والتكلفة والدقة والأمن والإتاحة
• خطوات التصميم والتحقق
• أُطر العمل: C4 وTOGAF وZachman
• حالة استخدام من الواقع

اختبار الجلسة (مطلوب). واجب اختياري: اختر السيناريو، واكتب وصف المشكلة، ورتّب سمات الجودة، وارسم مخططات C4 للمستويين 1 و2.`,
      startsAt: new Date('2026-10-18T16:00:00Z'),
      durationMin: 90,
      liveUrl: 'https://meet.google.com/jja-fbos-rwg',
    },
    {
      titleEn: 'Session 2: AI System Building Blocks',
      titleAr: 'الجلسة 2: المكونات الأساسية لأنظمة الذكاء الاصطناعي',
      descriptionEn: `From data pipelines to serving, and what it costs.

• Data pipelines and feature stores
• The model layer: foundation, fine-tuned and classical ML
• Training vs inference infrastructure
• Serving, APIs and orchestration
• MLOps / LLMOps and observability
• Real-world use case

Session quiz (required). Optional assignment: C4 Level 3 component diagram, capability-to-model map, compute plan and monthly cost estimate.`,
      descriptionAr: `من مسارات البيانات إلى تقديم النماذج، وكم يكلّف ذلك.

• مسارات البيانات ومخازن الخصائص (Feature Stores)
• طبقة النماذج: النماذج الأساسية والمُعدّلة وتعلم الآلة التقليدي
• البنية التحتية للتدريب مقابل الاستدلال
• تقديم النماذج وواجهات API والتنسيق (Orchestration)
• MLOps / LLMOps وقابلية المراقبة
• حالة استخدام من الواقع

اختبار الجلسة (مطلوب). واجب اختياري: مخطط مكونات C4 للمستوى 3، وخريطة القدرات إلى النماذج، وخطة الموارد الحاسوبية، وتقدير التكلفة الشهرية.`,
      startsAt: new Date('2026-10-25T16:00:00Z'),
      durationMin: 90,
      liveUrl: 'https://meet.google.com/csn-dcye-vbu',
    },
    {
      titleEn: 'Session 3: LLM & RAG Architecture',
      titleAr: 'الجلسة 3: معمارية LLM وRAG',
      descriptionEn: `Choosing models with evidence and designing retrieval that works.

• LLM selection and hosting: API vs self-hosted
• Prompting and context management
• Embeddings and vector databases
• RAG pipelines: chunking, retrieval, re-ranking
• Advanced patterns: hybrid search, GraphRAG
• Real-world use case

Session quiz (required). Optional assignment: model selection matrix, RAG pipeline diagram, retrieval strategy and context budget.`,
      descriptionAr: `اختيار النماذج بالأدلة وتصميم استرجاع يعمل فعلًا.

• اختيار نماذج LLM واستضافتها: عبر API أم استضافة ذاتية
• كتابة الأوامر وإدارة السياق
• التضمينات (Embeddings) وقواعد البيانات المتجهية
• مسارات RAG: التقطيع والاسترجاع وإعادة الترتيب
• أنماط متقدمة: البحث الهجين وGraphRAG
• حالة استخدام من الواقع

اختبار الجلسة (مطلوب). واجب اختياري: مصفوفة اختيار النموذج، ومخطط مسار RAG، واستراتيجية الاسترجاع، وميزانية السياق.`,
      // 29 Oct: Cairo moves to UTC+2, so 7:00 PM Cairo is 17:00Z from here on.
      startsAt: new Date('2026-11-01T17:00:00Z'),
      durationMin: 90,
      liveUrl: 'https://meet.google.com/vue-msdt-shc',
    },
    {
      titleEn: 'Session 4: Agentic AI Architecture',
      titleAr: 'الجلسة 4: معمارية أنظمة الوكلاء (Agentic AI)',
      descriptionEn: `Agents that earn their place, and can't do damage.

• Agent fundamentals and patterns: ReAct, planner–executor, router
• Tools, function calling and MCP
• Memory and state management
• Multi-agent orchestration
• Human-in-the-loop design
• Guardrails and limits
• Real-world use case

Session quiz (required). Optional assignment: agent justification table, sequence diagram, tool catalog, memory and approval design.`,
      descriptionAr: `وكلاء يستحقون مكانهم، ولا يستطيعون إحداث ضرر.

• أساسيات الوكلاء وأنماطهم: ReAct والمخطِّط والمنفِّذ والموجِّه (Router)
• الأدوات واستدعاء الدوال وMCP
• الذاكرة وإدارة الحالة
• تنسيق الوكلاء المتعددين
• تصميم يُبقي الإنسان في الحلقة (Human-in-the-loop)
• الضوابط والحدود
• حالة استخدام من الواقع

اختبار الجلسة (مطلوب). واجب اختياري: جدول تبرير استخدام الوكيل، ومخطط تسلسلي، وقائمة الأدوات، وتصميم الذاكرة والموافقات.`,
      startsAt: new Date('2026-11-15T17:00:00Z'),
      durationMin: 90,
      liveUrl: 'https://meet.google.com/mgu-qdsx-osv',
    },
    {
      titleEn: 'Session 5: Security, Governance, Evals',
      titleAr: 'الجلسة 5: الأمن والحوكمة والتقييم',
      descriptionEn: `Prove it's safe to ship, and know when it breaks.

• AI threat modelling: prompt injection, data leakage, tool misuse
• Guardrails and access control
• Governance, compliance and responsible AI in the MENA region
• Evaluation methods: offline test sets, LLM-as-judge, human review
• Production monitoring and observability
• Real-world use case

Session quiz (required). Optional assignment: threat model, compliance section, evaluation plan with release gates, monitoring plan.`,
      descriptionAr: `أثبت أن النظام آمن للإطلاق، واعرف متى يتعطل.

• تحليل التهديدات لأنظمة الذكاء الاصطناعي: حقن الأوامر وتسرب البيانات وإساءة استخدام الأدوات
• الضوابط والتحكم في الوصول
• الحوكمة والامتثال والذكاء الاصطناعي المسؤول في منطقة الشرق الأوسط وشمال أفريقيا
• أساليب التقييم: مجموعات الاختبار، وLLM كمُقيِّم، والمراجعة البشرية
• المراقبة وقابلية الرصد في بيئة الإنتاج
• حالة استخدام من الواقع

اختبار الجلسة (مطلوب). واجب اختياري: تحليل التهديدات، وقسم الامتثال، وخطة التقييم مع بوابات الإطلاق، وخطة المراقبة.`,
      startsAt: new Date('2026-11-22T17:00:00Z'),
      durationMin: 90,
      liveUrl: 'https://meet.google.com/pwf-ivya-oqq',
    },
    {
      titleEn: 'Session 6: Enterprise Case Studies',
      titleAr: 'الجلسة 6: دراسات حالة مؤسسية',
      descriptionEn: `How real systems were designed, and what we'd change.

• End-to-end architecture walkthroughs: telecom, e-commerce, government
• The hardest trade-offs and how they were decided
• What breaks at 10x scale
• Lessons learned from production
• Capstone guidance and Q&A

Session quiz (required).`,
      descriptionAr: `كيف صُممت أنظمة حقيقية، وما الذي كنا سنغيّره.

• جولات معمارية متكاملة: الاتصالات والتجارة الإلكترونية والقطاع الحكومي
• أصعب الموازنات وكيف حُسمت
• ما الذي ينكسر عند التوسع عشرة أضعاف
• دروس مستفادة من بيئة الإنتاج
• إرشادات المشروع الختامي وأسئلة وأجوبة

اختبار الجلسة (مطلوب).`,
      startsAt: new Date('2026-11-29T17:00:00Z'),
      durationMin: 90,
      liveUrl: 'https://meet.google.com/qov-zsdb-gqn',
    },
  ],
};

// ------------------------------------------------------------------ Kubernetes Mastery (coming soon)

/** Shown for every course detail that isn't decided yet. */
const TBA_EN = 'Will be announced soon.';
const TBA_AR = 'سيُعلَن عنه قريبًا.';

/** Content from the owner (9 Oct 2026). Dates, format, language, price and certificate aren't decided yet. */
const kubernetes: SeedCourse = {
  course: {
    slug: 'kubernetes',
    titleEn: 'Kubernetes Mastery: From Containers to Production & AI Infrastructure',
    titleAr: 'احتراف Kubernetes: من الحاويات إلى بيئة الإنتاج والبنية التحتية للذكاء الاصطناعي',
    shortDescriptionEn:
      'A complete, hands-on path from container basics to production-grade Kubernetes, cluster security, Amazon EKS and GPU-powered AI infrastructure.',
    shortDescriptionAr:
      'مسار عملي متكامل من أساسيات الحاويات إلى Kubernetes بمستوى الإنتاج، وتأمين الـ clusters، وAmazon EKS، وبنية تحتية للذكاء الاصطناعي تعمل بوحدات GPU.',
    longDescriptionEn: `This course covers Kubernetes end to end. You start with why containers need orchestration. You finish able to run secure, observable production clusters on AWS, including GPU nodes for training and serving AI models.

Every major concept follows the same pattern: **what it is → why it exists → how it works → a diagram → a real YAML/command example → how to troubleshoot it**.

The content is current throughout. Deprecated and retired pieces (PodSecurityPolicy, dockershim, in-tree EBS, Ingress-NGINX) are pointed out wherever they come up. You learn their modern replacements instead: Pod Security Standards, containerd/CRI, the EBS CSI driver, Gateway API and DRA.

## Hands-on labs

- **Application lifecycle:** deploy, expose, scale and roll back an application
- **Networking, Ingress & Gateway API:** route blue/green apps, then lock them down with a NetworkPolicy
- **Persistent storage on AWS EBS:** show that data survives deleting and recreating a Pod
- **Scheduling control:** nodeSelector, taints/tolerations and pod anti-affinity
- **RBAC least privilege:** create a user, grant exactly the access needed, check it with \`kubectl auth can-i\`
- **Security hardening:** fix common CKS-style findings (non-root, dropped capabilities, restricted PSS, default-deny)
- **Troubleshooting drill:** diagnose and fix three deliberately broken manifests
- **Cluster maintenance:** back up etcd, break something, restore it, then upgrade the cluster
- **GPU lab:** install the GPU Operator, run GPU Pods, enable time slicing and MIG, then a PyTorch training challenge

## Capstone projects (on AWS)

- **WordPress + MySQL:** MySQL as a StatefulSet on EBS, Secrets, a headless Service, WordPress exposed through a LoadBalancer or Ingress, and it survives Pod restarts
- **Self-managed MongoDB + Mongo Express:** a StatefulSet with persistent storage, a web admin UI, and data that survives restarts

## Learning outcomes

By the end of the course you'll be able to:

- **Explain the architecture:** every control-plane and worker-node component, and how a request flows through them
- **Deploy real workloads:** Pods, Deployments, StatefulSets, Jobs and CronJobs with proper probes and resource limits
- **Expose applications:** choose the right option among Services, Ingress, Gateway API and DNS-based discovery
- **Manage storage:** PV/PVC/StorageClass with the CSI driver on AWS EBS and EFS
- **Secure a cluster:** RBAC, ServiceAccounts, SecurityContext, Pod Security Standards, NetworkPolicies and supply-chain controls
- **Run it on AWS:** stand up and operate Amazon EKS, with GitOps through Argo CD
- **Operate clusters:** back up and restore etcd, drain nodes, upgrade clusters safely
- **Run AI/GPU workloads:** share GPUs with time slicing or MIG, queue training jobs with Kueue, serve LLMs with vLLM, monitor GPUs with DCGM
- **Troubleshoot under pressure:** work systematically through Pending, CrashLoopBackOff, ImagePullBackOff, stuck rollouts, DNS problems and GPU failures

## What makes this course different

- **Practical first:** every concept comes with a working YAML or command demo and a troubleshooting table
- **Up to date:** no deprecated APIs taught as current; covers Gateway API, DRA (GA in 1.34), sidecar containers and EKS access entries
- **Exam-aligned:** content maps directly to the CKA and CKS domains, with exam-day speed tips
- **Interview-ready:** every section ends with real interview questions and model answers
- **AI infrastructure built in:** a full section on GPUs, which most Kubernetes courses leave out

## Tools & technologies

Kubernetes · kubectl · kubeadm · Minikube/kind · containerd · Calico · Cilium · CoreDNS · Traefik · Envoy Gateway · Helm · Kustomize · Argo CD · Amazon EKS · eksctl · AWS EBS/EFS CSI · AWS KMS · Prometheus · Grafana · Trivy · Kyverno · Falco · kube-bench · Velero · NVIDIA GPU Operator · DCGM · Kueue · vLLM · KEDA

## After the course

- Sit the CKA once you can finish every lab under time pressure
- Go on to the CKS, using Section 14 as your foundation
- Go deeper on AI platforms: Kubeflow, KServe, KubeRay, Karpenter
- Explore service meshes (Istio, Linkerd)`,
    longDescriptionAr: `تغطي هذه الدورة Kubernetes من البداية إلى النهاية. تبدأ بسؤال: لماذا تحتاج الحاويات إلى orchestration؟ وتنتهي وأنت قادر على تشغيل clusters إنتاجية آمنة وقابلة للمراقبة على AWS، بما فيها nodes بوحدات GPU لتدريب نماذج الذكاء الاصطناعي وتقديمها.

يسير كل مفهوم أساسي على النمط نفسه: **ما هو ← لماذا وُجد ← كيف يعمل ← مخطط توضيحي ← مثال حقيقي بـ YAML أو أمر ← كيف تحل مشكلاته**.

المحتوى محدَّث بالكامل. ننبّه إلى المكونات المهجورة والمتوقفة (PodSecurityPolicy وdockershim وin-tree EBS وIngress-NGINX) أينما ظهرت، وتتعلم بدائلها الحديثة: Pod Security Standards وcontainerd/CRI وEBS CSI driver وGateway API وDRA.

## المختبرات العملية

- **دورة حياة التطبيق:** انشر تطبيقًا وأتِحه ووسّعه ثم تراجع عن إصداره
- **الشبكات وIngress وGateway API:** وجّه الحركة بين تطبيقات blue/green، ثم أغلقها بـ NetworkPolicy
- **التخزين الدائم على AWS EBS:** أثبت أن البيانات تبقى بعد حذف الـ Pod وإعادة إنشائه
- **التحكم في الجدولة:** nodeSelector وtaints/tolerations وpod anti-affinity
- **RBAC بأقل الصلاحيات:** أنشئ مستخدمًا وامنحه الصلاحيات اللازمة فقط، وتحقّق منها بـ \`kubectl auth can-i\`
- **تقوية الأمان:** أصلح ملاحظات شائعة على طريقة CKS (التشغيل دون root، وإسقاط الـ capabilities، وrestricted PSS، والرفض الافتراضي)
- **تمرين حل المشكلات:** شخّص ثلاثة manifests معطوبة عمدًا وأصلحها
- **صيانة الـ cluster:** خذ نسخة احتياطية من etcd، وعطّل شيئًا ثم استعده، ثم رقِّ الـ cluster
- **مختبر GPU:** ثبّت GPU Operator، وشغّل Pods على GPU، وفعّل time slicing وMIG، ثم تحدٍّ لتدريب نموذج بـ PyTorch

## المشاريع الختامية (على AWS)

- **WordPress + MySQL:** قاعدة MySQL كـ StatefulSet على EBS، وSecrets، وheadless Service، وWordPress متاح عبر LoadBalancer أو Ingress، ويصمد أمام إعادة تشغيل الـ Pods
- **MongoDB مُدار ذاتيًا + Mongo Express:** StatefulSet بتخزين دائم، وواجهة ويب للإدارة، وبيانات تبقى بعد إعادة التشغيل

## مخرجات التعلّم

بنهاية الدورة ستكون قادرًا على:

- **شرح المعمارية:** كل مكونات الـ control plane والـ worker nodes، وكيف يمر الطلب عبرها
- **نشر أحمال عمل حقيقية:** Pods وDeployments وStatefulSets وJobs وCronJobs مع probes وحدود موارد مضبوطة
- **إتاحة التطبيقات:** اختيار الخيار المناسب بين Services وIngress وGateway API والاكتشاف عبر DNS
- **إدارة التخزين:** PV/PVC/StorageClass مع CSI driver على AWS EBS وEFS
- **تأمين الـ cluster:** RBAC وServiceAccounts وSecurityContext وPod Security Standards وNetworkPolicies وضوابط سلسلة التوريد
- **التشغيل على AWS:** إعداد Amazon EKS وتشغيله، مع GitOps عبر Argo CD
- **تشغيل الـ clusters وصيانتها:** نسخ etcd احتياطيًا واستعادته، وتفريغ الـ nodes (drain)، وترقية الـ clusters بأمان
- **تشغيل أحمال الذكاء الاصطناعي على GPU:** مشاركة وحدات GPU عبر time slicing أو MIG، وجدولة مهام التدريب في طوابير بـ Kueue، وتقديم نماذج LLM بـ vLLM، ومراقبة وحدات GPU بـ DCGM
- **حل المشكلات تحت الضغط:** التعامل بمنهجية مع Pending وCrashLoopBackOff وImagePullBackOff والـ rollouts العالقة ومشكلات DNS وأعطال GPU

## ما الذي يميّز هذه الدورة

- **التطبيق أولًا:** كل مفهوم معه مثال عملي بـ YAML أو أمر يعمل، وجدول لحل المشكلات
- **محدَّثة:** لا تُدرَّس واجهات API مهجورة على أنها حالية؛ وتغطي Gateway API وDRA (مستقرة GA منذ 1.34) والـ sidecar containers وEKS access entries
- **متوافقة مع الاختبارات:** المحتوى مرتبط مباشرة بمجالات اختباري CKA وCKS، مع نصائح للسرعة يوم الاختبار
- **جاهزة للمقابلات:** ينتهي كل قسم بأسئلة مقابلات حقيقية وإجابات نموذجية
- **البنية التحتية للذكاء الاصطناعي جزء أساسي:** قسم كامل عن وحدات GPU، وهو ما تغفله معظم دورات Kubernetes

## الأدوات والتقنيات

Kubernetes · kubectl · kubeadm · Minikube/kind · containerd · Calico · Cilium · CoreDNS · Traefik · Envoy Gateway · Helm · Kustomize · Argo CD · Amazon EKS · eksctl · AWS EBS/EFS CSI · AWS KMS · Prometheus · Grafana · Trivy · Kyverno · Falco · kube-bench · Velero · NVIDIA GPU Operator · DCGM · Kueue · vLLM · KEDA

## بعد الدورة

- تقدّم لاختبار CKA حين تستطيع إنهاء كل المختبرات تحت ضغط الوقت
- انتقل بعدها إلى CKS، مستندًا إلى القسم 14 كأساس
- تعمّق في منصات الذكاء الاصطناعي: Kubeflow وKServe وKubeRay وKarpenter
- استكشف الـ service meshes ‏(Istio وLinkerd)`,
    // The price isn't decided: shown as "Price to be announced", never as free.
    type: 'PAID',
    price: 0,
    currency: 'EGP',
    requiresApproval: true,
    capacity: null,
    status: 'COMING_SOON',
    // Explicit nulls: dates, duration and schedule aren't decided ("Will be announced soon" on the page).
    startDate: null,
    applicationsOpenAt: null,
    applicationDeadline: null,
    durationWeeks: null,
    hoursPerWeek: null,
    driveFolderUrl: null,
    youtubePlaylistUrl: null,
    coverImageUrl: null,
    level: 'INTERMEDIATE',
    // Not decided yet either: coming-soon pages show "Will be announced soon" for the language.
    language: 'BILINGUAL',
    deliveryPlatform: 'GOOGLE_MEET',
    recordingsPlatform: 'GOOGLE_DRIVE',
    targetAudience: {
      en: `- Junior to intermediate DevOps engineers who want to deploy, secure and operate real Kubernetes clusters
- Engineers preparing for the CKA or CKS exams, which are hands-on and terminal-based
- MLOps and ML platform engineers who need to run GPU workloads (training, inference, notebooks) on Kubernetes
- Cloud and backend engineers moving workloads to Amazon EKS
- Anyone preparing for Kubernetes / DevOps interviews, since every section ends with interview questions`,
      ar: `- مهندسو DevOps من المستوى المبتدئ إلى المتوسط الذين يريدون نشر clusters حقيقية لـ Kubernetes وتأمينها وتشغيلها
- المهندسون الذين يستعدون لاختباري CKA أو CKS، وهما اختباران عمليان على الطرفية (Terminal)
- مهندسو MLOps ومنصات تعلّم الآلة الذين يحتاجون إلى تشغيل أحمال GPU (التدريب والاستدلال والـ notebooks) على Kubernetes
- مهندسو السحابة والـ Backend الذين ينقلون أحمال العمل إلى Amazon EKS
- كل من يستعد لمقابلات Kubernetes وDevOps، إذ ينتهي كل قسم بأسئلة مقابلات`,
    },
    notFor: { en: '', ar: '' },
    preparation: { en: '', ar: '' },
    learningOutcomes: {
      en: [
        'Architecture: the control plane, worker nodes, and how each component talks to the others',
        'Workloads: Pods, Deployments, StatefulSets, DaemonSets, Jobs and CronJobs, plus rollout strategies',
        'Networking: CNI, Services, Ingress, Gateway API, CoreDNS and NetworkPolicies',
        'Storage: Volumes, PV/PVC, StorageClass and the CSI driver on AWS EBS and EFS',
        'Security: AuthN/AuthZ, RBAC, ServiceAccounts, SecurityContext, Pod Security Standards and supply-chain security',
        'Operations & AI infrastructure: scheduling, autoscaling, observability, maintenance, EKS, GitOps and GPU workloads',
      ],
      ar: [
        'المعمارية: الـ control plane والـ worker nodes، وكيف يتواصل كل مكوّن مع الآخر',
        'أحمال العمل: Pods وDeployments وStatefulSets وDaemonSets وJobs وCronJobs، واستراتيجيات الـ rollout',
        'الشبكات: CNI وServices وIngress وGateway API وCoreDNS وNetworkPolicies',
        'التخزين: Volumes وPV/PVC وStorageClass وCSI driver على AWS EBS وEFS',
        'الأمان: المصادقة والتفويض (AuthN/AuthZ) وRBAC وServiceAccounts وSecurityContext وPod Security Standards وأمن سلسلة التوريد',
        'التشغيل والبنية التحتية للذكاء الاصطناعي: الجدولة والتوسع التلقائي والمراقبة والصيانة وEKS وGitOps وأحمال GPU',
      ],
    },
    prerequisites: {
      en: [
        'Comfortable with the Linux command line (shell, files, processes, SSH)',
        'Docker basics: building and running containers, images, registries',
        'Able to read and write YAML',
        'Basic networking: IPs, ports, DNS, HTTP, load balancers',
        'Basic AWS knowledge helps: EC2, VPC and IAM concepts',
        'An AWS account for the EKS labs and capstones (cloud costs apply), plus a laptop that can run Minikube or kind',
        'Optional: access to an NVIDIA GPU (e.g. a cloud GPU instance) for the GPU lab',
      ],
      ar: [
        'التعامل بارتياح مع سطر أوامر Linux (الـ shell والملفات والعمليات وSSH)',
        'أساسيات Docker: بناء الحاويات وتشغيلها، والصور (Images)، والـ registries',
        'القدرة على قراءة YAML وكتابته',
        'أساسيات الشبكات: عناوين IP والمنافذ وDNS وHTTP وموازنات الأحمال (Load Balancers)',
        'معرفة أساسية بـ AWS تفيدك: مفاهيم EC2 وVPC وIAM',
        'حساب AWS لمختبرات EKS والمشاريع الختامية (مع تكاليف سحابية)، وجهاز لابتوب يستطيع تشغيل Minikube أو kind',
        'اختياري: وصول إلى وحدة NVIDIA GPU (مثل خادم GPU سحابي) لمختبر GPU',
      ],
    },
    // The curriculum: 23 sections.
    outline: [
      {
        titleEn: 'Kubernetes Fundamentals',
        titleAr: 'أساسيات Kubernetes',
        descriptionEn: 'Bare metal → VMs → containers → K8s, core features, the CNCF ecosystem',
        descriptionAr:
          'من الخوادم الفعلية إلى الأجهزة الافتراضية ثم الحاويات ثم K8s، والميزات الأساسية، ومنظومة CNCF',
      },
      {
        titleEn: 'Architecture',
        titleAr: 'المعمارية',
        descriptionEn:
          'API server request flow, etcd (Raft), scheduler, controller managers, kubelet ↔ CRI, the dockershim removal',
        descriptionAr:
          'مسار الطلب في الـ API server، وetcd ‏(Raft)، والـ scheduler، والـ controller managers، والعلاقة بين kubelet وCRI، وإزالة dockershim',
      },
      {
        titleEn: 'Cluster Setup',
        titleAr: 'إعداد الـ Cluster',
        descriptionEn: 'Minikube/kind, a multi-node kubeadm cluster, managed options (EKS/GKE/AKS)',
        descriptionAr:
          'Minikube/kind، وcluster متعدد الـ nodes بـ kubeadm، والخيارات المُدارة (EKS/GKE/AKS)',
      },
      {
        titleEn: 'kubectl & YAML',
        titleAr: 'kubectl وYAML',
        descriptionEn:
          'Essential commands, manifest anatomy, imperative vs declarative, dry-runs and diffs',
        descriptionAr:
          'الأوامر الأساسية، وتشريح الـ manifest، والأسلوب الأمري مقابل التصريحي (Imperative vs Declarative)، والـ dry-runs والـ diffs',
      },
      {
        titleEn: 'Pods & Workloads',
        titleAr: 'الـ Pods وأحمال العمل',
        descriptionEn:
          'Init and sidecar containers, labels/selectors, namespaces, ReplicaSets, Deployments, rollout strategies, probes, graceful termination',
        descriptionAr:
          'حاويات init وsidecar، والـ labels/selectors، والـ namespaces، وReplicaSets، وDeployments، واستراتيجيات الـ rollout، والـ probes، والإيقاف السلس (Graceful Termination)',
      },
      {
        titleEn: 'Networking',
        titleAr: 'الشبكات',
        descriptionEn:
          'The K8s network model, CNI plugins (Calico, Cilium, Flannel, AWS VPC CNI), CoreDNS and service discovery',
        descriptionAr:
          'نموذج الشبكات في K8s، وإضافات CNI ‏(Calico وCilium وFlannel وAWS VPC CNI)، وCoreDNS واكتشاف الخدمات',
      },
      {
        titleEn: 'Services, Ingress & Gateway API',
        titleAr: 'Services وIngress وGateway API',
        descriptionEn:
          'ClusterIP / NodePort / LoadBalancer / headless, Ingress routing, a weighted canary with Gateway API',
        descriptionAr:
          'ClusterIP وNodePort وLoadBalancer وheadless، والتوجيه عبر Ingress، وإصدار canary موزون بـ Gateway API',
      },
      {
        titleEn: 'Scheduling & Autoscaling',
        titleAr: 'الجدولة والتوسع التلقائي',
        descriptionEn:
          'nodeSelector, affinity/anti-affinity, taints and tolerations, requests/limits, ResourceQuota, HPA, PodDisruptionBudgets',
        descriptionAr:
          'nodeSelector، وaffinity/anti-affinity، والـ taints والـ tolerations، والـ requests/limits، وResourceQuota، وHPA، وPodDisruptionBudgets',
      },
      {
        titleEn: 'Jobs & CronJobs',
        titleAr: 'Jobs وCronJobs',
        descriptionEn: 'Batch and scheduled workloads',
        descriptionAr: 'أحمال العمل الدفعية والمجدولة',
      },
      {
        titleEn: 'Configuration',
        titleAr: 'الإعدادات',
        descriptionEn: 'ConfigMaps, Secrets, encrypting Secrets at rest (KMS on EKS)',
        descriptionAr: 'ConfigMaps وSecrets، وتشفير الـ Secrets المخزّنة (KMS على EKS)',
      },
      {
        titleEn: 'Storage',
        titleAr: 'التخزين',
        descriptionEn:
          'PV/PVC, StorageClass, EBS vs EFS, dynamic provisioning with the EBS CSI driver',
        descriptionAr:
          'PV/PVC، وStorageClass، والمقارنة بين EBS وEFS، والتوفير الديناميكي بـ EBS CSI driver',
      },
      {
        titleEn: 'Stateful Applications',
        titleAr: 'التطبيقات ذات الحالة (Stateful)',
        descriptionEn: 'StatefulSets, headless Services, per-replica storage',
        descriptionAr: 'StatefulSets، والـ headless Services، وتخزين مستقل لكل نسخة (Replica)',
      },
      {
        titleEn: 'Helm, Kustomize & CRDs',
        titleAr: 'Helm وKustomize والـ CRDs',
        descriptionEn: 'Charts vs overlays, CRDs and the Operator pattern',
        descriptionAr: 'الـ charts مقابل الـ overlays، والـ CRDs ونمط الـ Operator',
      },
      {
        titleEn: 'Security & RBAC',
        titleAr: 'الأمان وRBAC',
        descriptionEn:
          'kubeconfig, certificate auth, Roles/ClusterRoles, least-privilege ServiceAccounts, Pod Security Standards, NetworkPolicies, Trivy + Kyverno, audit logging, Falco',
        descriptionAr:
          'kubeconfig، والمصادقة بالشهادات، وRoles/ClusterRoles، وServiceAccounts بأقل الصلاحيات، وPod Security Standards، وNetworkPolicies، وTrivy مع Kyverno، وسجلات التدقيق (Audit Logging)، وFalco',
      },
      {
        titleEn: 'Amazon EKS',
        titleAr: 'Amazon EKS',
        descriptionEn:
          'EKS architecture, eksctl, what the console creates, access entries, production best practices',
        descriptionAr:
          'معمارية EKS، وeksctl، وما تنشئه لوحة التحكم (Console)، وaccess entries، وأفضل الممارسات للإنتاج',
      },
      {
        titleEn: 'Observability',
        titleAr: 'المراقبة (Observability)',
        descriptionEn: 'Metrics, logs and events, plus a structured troubleshooting method',
        descriptionAr: 'المقاييس والسجلات والأحداث، مع منهجية منظّمة لحل المشكلات',
      },
      {
        titleEn: 'Cluster Maintenance',
        titleAr: 'صيانة الـ Cluster',
        descriptionEn:
          'etcd backup and restore, cordon/drain, upgrading one minor version at a time, Velero on EKS',
        descriptionAr:
          'النسخ الاحتياطي لـ etcd واستعادته، وcordon/drain، والترقية إصدارًا فرعيًا واحدًا في كل مرة، وVelero على EKS',
      },
      {
        titleEn: 'Production & GitOps',
        titleAr: 'الإنتاج وGitOps',
        descriptionEn: 'Production-readiness checklist, HA, GitOps with Argo CD',
        descriptionAr: 'قائمة الجاهزية للإنتاج، والإتاحة العالية (HA)، وGitOps باستخدام Argo CD',
      },
      {
        titleEn: 'Hands-on Labs',
        titleAr: 'المختبرات العملية',
        descriptionEn: '8 progressive labs (see Hands-on labs above)',
        descriptionAr: '8 مختبرات متدرّجة (انظر «المختبرات العملية» في الأعلى)',
      },
      {
        titleEn: 'Capstone Projects',
        titleAr: 'المشاريع الختامية',
        descriptionEn: '2 full deployments on AWS',
        descriptionAr: 'مشروعا نشر متكاملان على AWS',
      },
      {
        titleEn: 'CKA / CKS Focus',
        titleAr: 'التركيز على CKA وCKS',
        descriptionEn: 'How the exam domains map to the course, exam-day tips',
        descriptionAr: 'كيف ترتبط مجالات الاختبارين بمحتوى الدورة، ونصائح ليوم الاختبار',
      },
      {
        titleEn: 'AI Infrastructure on Kubernetes',
        titleAr: 'البنية التحتية للذكاء الاصطناعي على Kubernetes',
        descriptionEn:
          'NVIDIA GPU Operator, GPU scheduling, time slicing, MIG, DRA, Kueue and gang scheduling, serving LLMs with vLLM, DCGM monitoring',
        descriptionAr:
          'NVIDIA GPU Operator، وجدولة وحدات GPU، وtime slicing، وMIG، وDRA، وKueue والجدولة الجماعية (Gang Scheduling)، وتقديم نماذج LLM بـ vLLM، والمراقبة بـ DCGM',
      },
      {
        titleEn: 'Final Recap',
        titleAr: 'المراجعة الختامية',
        descriptionEn: 'Review and next steps',
        descriptionAr: 'مراجعة شاملة والخطوات التالية',
      },
    ],
    faq: [],
    // Format and certificate aren't decided: nothing is listed as included yet.
    included: {
      liveSessions: false,
      recordings: false,
      assignments: false,
      finalProject: false,
      certificate: false,
      notesEn: TBA_EN,
      notesAr: TBA_AR,
    },
  },
  // Earlier seeded content: a row still holding it, never edited by an admin, is updated to this version.
  supersedes: [
    `This course is coming soon. We're finalising the curriculum, the instructor and the dates.

Follow MLOps MENA on LinkedIn, Telegram or Discord to hear first when applications open.`,
  ],
  questions: [],
  sessions: [],
};

export const seedCourses: SeedCourse[] = [aiArchitecture, kubernetes];

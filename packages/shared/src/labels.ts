import type {
  ApplicationStatus,
  Area,
  CloudPlatform,
  CompanySize,
  CourseAvailability,
  CourseLanguage,
  CourseLevel,
  CourseStatus,
  CourseType,
  DeliveryPlatform,
  EducationLevel,
  EmploymentStatus,
  EventStatus,
  ExperienceRange,
  Industry,
  LearningFormat,
  LearningGoal,
  Locale,
  PaymentMethod,
  PaymentStatus,
  QuestionType,
  RecordingsPlatform,
  ReferralSource,
  Seniority,
  SessionTime,
  Skill,
  Topic,
  WeeklyHours,
} from './enums';

export type Localized = { en: string; ar: string };
type LabelMap<T extends string> = Record<T, Localized>;

export const employmentStatusLabels: LabelMap<EmploymentStatus> = {
  EMPLOYED_FULL_TIME: { en: 'Employed full-time', ar: 'موظف بدوام كامل' },
  EMPLOYED_PART_TIME: { en: 'Employed part-time', ar: 'موظف بدوام جزئي' },
  FREELANCER: { en: 'Freelancer', ar: 'عمل حر (Freelancer)' },
  STUDENT: { en: 'Student', ar: 'طالب' },
  JOB_SEEKING: { en: 'Looking for a job', ar: 'أبحث عن عمل' },
  OTHER: { en: 'Other', ar: 'أخرى' },
};

export const experienceRangeLabels: LabelMap<ExperienceRange> = {
  Y0_1: { en: '0–1 years', ar: '0–1 سنة' },
  Y1_3: { en: '1–3 years', ar: '1–3 سنوات' },
  Y3_5: { en: '3–5 years', ar: '3–5 سنوات' },
  Y5_10: { en: '5–10 years', ar: '5–10 سنوات' },
  Y10_PLUS: { en: '10+ years', ar: 'أكثر من 10 سنوات' },
};

export const areaLabels: LabelMap<Area> = {
  ML_ENGINEERING: { en: 'ML Engineering', ar: 'هندسة تعلم الآلة (ML Engineering)' },
  MLOPS: { en: 'MLOps', ar: 'MLOps' },
  LLMOPS_AI_ENGINEERING: { en: 'LLMOps / AI Engineering', ar: 'LLMOps / هندسة الذكاء الاصطناعي' },
  DATA_SCIENCE: { en: 'Data Science', ar: 'علم البيانات' },
  DATA_ENGINEERING: { en: 'Data Engineering', ar: 'هندسة البيانات' },
  SOFTWARE_BACKEND: { en: 'Software / Backend', ar: 'هندسة البرمجيات / Backend' },
  DEVOPS_PLATFORM_SRE: { en: 'DevOps / Platform / SRE', ar: 'DevOps / Platform / SRE' },
  RESEARCH: { en: 'Research', ar: 'بحث علمي' },
  STUDENT: { en: 'Student', ar: 'طالب' },
  OTHER: { en: 'Other', ar: 'أخرى' },
};

export const industryLabels: LabelMap<Industry> = {
  FINTECH: { en: 'Fintech', ar: 'التقنية المالية' },
  TELECOM: { en: 'Telecom', ar: 'الاتصالات' },
  HEALTHCARE: { en: 'Healthcare', ar: 'الرعاية الصحية' },
  ECOMMERCE: { en: 'E-commerce', ar: 'التجارة الإلكترونية' },
  GOVERNMENT: { en: 'Government', ar: 'القطاع الحكومي' },
  CONSULTING: { en: 'Consulting', ar: 'الاستشارات' },
  ACADEMIA: { en: 'Academia', ar: 'الأوساط الأكاديمية' },
  OTHER: { en: 'Other', ar: 'أخرى' },
};

export const companySizeLabels: LabelMap<CompanySize> = {
  S1_10: { en: '1–10 employees', ar: '1–10 موظفين' },
  S11_50: { en: '11–50 employees', ar: '11–50 موظفًا' },
  S51_200: { en: '51–200 employees', ar: '51–200 موظف' },
  S201_1000: { en: '201–1,000 employees', ar: '201–1,000 موظف' },
  S1000_PLUS: { en: '1,000+ employees', ar: 'أكثر من 1,000 موظف' },
};

export const seniorityLabels: LabelMap<Seniority> = {
  INTERN: { en: 'Intern', ar: 'متدرب' },
  JUNIOR: { en: 'Junior', ar: 'مبتدئ (Junior)' },
  MID: { en: 'Mid-level', ar: 'متوسط الخبرة (Mid)' },
  SENIOR: { en: 'Senior', ar: 'خبير (Senior)' },
  LEAD_STAFF: { en: 'Lead / Staff', ar: 'Lead / Staff' },
  MANAGER: { en: 'Manager', ar: 'مدير فريق' },
  HEAD_DIRECTOR: { en: 'Head / Director', ar: 'رئيس قسم / مدير' },
};

export const educationLevelLabels: LabelMap<EducationLevel> = {
  HIGH_SCHOOL: { en: 'High school', ar: 'ثانوية عامة' },
  DIPLOMA: { en: 'Diploma', ar: 'دبلوم' },
  BACHELORS: { en: "Bachelor's", ar: 'بكالوريوس' },
  MASTERS: { en: "Master's", ar: 'ماجستير' },
  PHD: { en: 'PhD', ar: 'دكتوراه' },
  BOOTCAMP_SELF_TAUGHT: { en: 'Bootcamp / self-taught', ar: 'معسكر تدريبي / تعلم ذاتي' },
};

export const skillLabels: LabelMap<Skill> = {
  PYTHON: { en: 'Python', ar: 'Python' },
  SQL: { en: 'SQL', ar: 'SQL' },
  LINUX_BASH: { en: 'Linux / Bash', ar: 'Linux / Bash' },
  GIT: { en: 'Git', ar: 'Git' },
  DOCKER: { en: 'Docker', ar: 'Docker' },
  KUBERNETES: { en: 'Kubernetes', ar: 'Kubernetes' },
  CI_CD: { en: 'CI/CD', ar: 'CI/CD' },
  AWS: { en: 'AWS', ar: 'AWS' },
  GCP: { en: 'Google Cloud (GCP)', ar: 'Google Cloud (GCP)' },
  AZURE: { en: 'Azure', ar: 'Azure' },
  ML_FUNDAMENTALS: { en: 'ML fundamentals', ar: 'أساسيات تعلم الآلة' },
  DEEP_LEARNING: { en: 'Deep learning', ar: 'التعلم العميق' },
  LLMS_RAG: { en: 'LLMs / RAG', ar: 'LLMs / RAG' },
  AGENTS: { en: 'AI agents', ar: 'الوكلاء الذكيون (Agents)' },
  MLOPS_TOOLING: {
    en: 'MLOps tooling (MLflow, Kubeflow, Airflow…)',
    ar: 'أدوات MLOps (MLflow وKubeflow وAirflow…)',
  },
  MONITORING_OBSERVABILITY: { en: 'Monitoring / observability', ar: 'المراقبة (Observability)' },
};

/** Shown next to the 1–5 skill scale. */
export const skillLevelLabels: Record<1 | 2 | 3 | 4 | 5, Localized> = {
  1: { en: 'Aware: read about it, never used it', ar: 'معرفة نظرية: قرأت عنه ولم أستخدمه' },
  2: { en: 'Beginner: followed tutorials', ar: 'مبتدئ: طبقت دروسًا تعليمية' },
  3: { en: 'Working: used it in a real project', ar: 'عملي: استخدمته في مشروع حقيقي' },
  4: { en: 'Proficient: use it in production', ar: 'متمكن: أستخدمه في بيئة الإنتاج' },
  5: { en: 'Expert: could teach it', ar: 'خبير: أستطيع تدريسه' },
};

export const cloudPlatformLabels: LabelMap<CloudPlatform> = {
  AWS: { en: 'AWS', ar: 'AWS' },
  GCP: { en: 'Google Cloud', ar: 'Google Cloud' },
  AZURE: { en: 'Azure', ar: 'Azure' },
  ORACLE: { en: 'Oracle Cloud', ar: 'Oracle Cloud' },
  ALIBABA: { en: 'Alibaba Cloud', ar: 'Alibaba Cloud' },
  OTHER: { en: 'Other', ar: 'أخرى' },
};

export const learningGoalLabels: LabelMap<LearningGoal> = {
  FIRST_ML_JOB: { en: 'Get my first ML job', ar: 'الحصول على أول وظيفة في تعلم الآلة' },
  MOVE_TO_MLOPS: { en: 'Move into MLOps', ar: 'الانتقال إلى مجال MLOps' },
  LEVEL_UP_SENIOR: { en: 'Level up to senior', ar: 'الترقي إلى مستوى Senior' },
  LEAD_TEAM: { en: 'Lead a team', ar: 'قيادة فريق' },
  BUILD_PRODUCT: { en: 'Build a product', ar: 'بناء منتج' },
  FREELANCING: { en: 'Freelancing', ar: 'العمل الحر' },
  RESEARCH: { en: 'Research', ar: 'البحث العلمي' },
};

export const topicLabels: LabelMap<Topic> = {
  MLOPS: { en: 'MLOps', ar: 'MLOps' },
  LLMOPS: { en: 'LLMOps', ar: 'LLMOps' },
  KUBERNETES: { en: 'Kubernetes', ar: 'Kubernetes' },
  RAG: { en: 'RAG', ar: 'RAG' },
  AGENTS: { en: 'AI agents', ar: 'الوكلاء الذكيون (Agents)' },
  AI_ARCHITECTURE: { en: 'AI architecture', ar: 'معمارية أنظمة الذكاء الاصطناعي' },
  CLOUD: { en: 'Cloud', ar: 'الحوسبة السحابية' },
  DATA_ENGINEERING: { en: 'Data engineering', ar: 'هندسة البيانات' },
  COMPUTER_VISION: { en: 'Computer vision', ar: 'الرؤية الحاسوبية' },
  NLP: { en: 'NLP', ar: 'معالجة اللغات الطبيعية (NLP)' },
  DEEP_LEARNING: { en: 'Deep learning', ar: 'التعلم العميق' },
  MONITORING: { en: 'Monitoring & observability', ar: 'المراقبة (Observability)' },
  SECURITY_GOVERNANCE: { en: 'AI security & governance', ar: 'أمن وحوكمة الذكاء الاصطناعي' },
};

export const weeklyHoursLabels: LabelMap<WeeklyHours> = {
  H_LT_2: { en: 'Less than 2 hours', ar: 'أقل من ساعتين' },
  H_2_5: { en: '2–5 hours', ar: '2–5 ساعات' },
  H_5_10: { en: '5–10 hours', ar: '5–10 ساعات' },
  H_10_PLUS: { en: '10+ hours', ar: 'أكثر من 10 ساعات' },
};

export const sessionTimeLabels: LabelMap<SessionTime> = {
  WEEKDAY_MORNINGS: { en: 'Weekday mornings', ar: 'صباح أيام الأسبوع' },
  WEEKDAY_EVENINGS: { en: 'Weekday evenings', ar: 'مساء أيام الأسبوع' },
  WEEKEND_MORNINGS: { en: 'Weekend mornings', ar: 'صباح عطلة نهاية الأسبوع' },
  WEEKEND_EVENINGS: { en: 'Weekend evenings', ar: 'مساء عطلة نهاية الأسبوع' },
};

export const learningFormatLabels: LabelMap<LearningFormat> = {
  LIVE: { en: 'Live', ar: 'مباشر' },
  RECORDED: { en: 'Recorded', ar: 'مسجل' },
  HYBRID: { en: 'Hybrid', ar: 'مختلط' },
};

export const referralSourceLabels: LabelMap<ReferralSource> = {
  MAIN_SITE: { en: 'mlopsmena.com', ar: 'موقع mlopsmena.com' },
  LINKEDIN: { en: 'LinkedIn', ar: 'LinkedIn' },
  FACEBOOK: { en: 'Facebook', ar: 'Facebook' },
  X_TWITTER: { en: 'X (Twitter)', ar: 'X (تويتر)' },
  YOUTUBE: { en: 'YouTube', ar: 'YouTube' },
  DISCORD: { en: 'Discord', ar: 'Discord' },
  TELEGRAM: { en: 'Telegram', ar: 'Telegram' },
  WHATSAPP: { en: 'WhatsApp', ar: 'WhatsApp' },
  FRIEND_COLLEAGUE: { en: 'A friend or colleague', ar: 'صديق أو زميل' },
  EVENT: { en: 'An event or meetup', ar: 'فعالية أو لقاء' },
  SEARCH: { en: 'Search engine', ar: 'محرك بحث' },
  OTHER: { en: 'Other', ar: 'أخرى' },
};

export const courseTypeLabels: LabelMap<CourseType> = {
  FREE: { en: 'Free', ar: 'مجاني' },
  PAID: { en: 'Paid', ar: 'مدفوع' },
};

export const courseStatusLabels: LabelMap<CourseStatus> = {
  DRAFT: { en: 'Draft', ar: 'مسودة' },
  COMING_SOON: { en: 'Coming soon', ar: 'قريبًا' },
  OPEN: { en: 'Open', ar: 'مفتوح' },
  CLOSED: { en: 'Closed', ar: 'مغلق' },
  ARCHIVED: { en: 'Archived', ar: 'مؤرشف' },
};

export const eventStatusLabels: LabelMap<EventStatus> = {
  DRAFT: { en: 'Draft', ar: 'مسودة' },
  PUBLISHED: { en: 'Published', ar: 'منشورة' },
  CANCELLED: { en: 'Cancelled', ar: 'ملغاة' },
};

export const courseAvailabilityLabels: LabelMap<CourseAvailability> = {
  OPEN: { en: 'Applications open', ar: 'التسجيل مفتوح' },
  UPCOMING: { en: 'Opening soon', ar: 'يفتح قريبًا' },
  CLOSED: { en: 'Applications closed', ar: 'التسجيل مغلق' },
};

export const courseLevelLabels: LabelMap<CourseLevel> = {
  BEGINNER: { en: 'Beginner', ar: 'مبتدئ' },
  INTERMEDIATE: { en: 'Intermediate', ar: 'متوسط' },
  ADVANCED: { en: 'Advanced', ar: 'متقدم' },
  ALL_LEVELS: { en: 'All levels', ar: 'جميع المستويات' },
};

export const courseLanguageLabels: LabelMap<CourseLanguage> = {
  EN: { en: 'English', ar: 'الإنجليزية' },
  AR: { en: 'Arabic', ar: 'العربية' },
  BILINGUAL: { en: 'Arabic & English', ar: 'العربية والإنجليزية' },
};

export const deliveryPlatformLabels: LabelMap<DeliveryPlatform> = {
  GOOGLE_MEET: { en: 'Google Meet', ar: 'Google Meet' },
  YOUTUBE_LIVE: { en: 'YouTube Live', ar: 'YouTube Live' },
};

export const recordingsPlatformLabels: LabelMap<RecordingsPlatform> = {
  YOUTUBE: { en: 'YouTube', ar: 'YouTube' },
  GOOGLE_DRIVE: { en: 'Google Drive', ar: 'Google Drive' },
};

export const questionTypeLabels: LabelMap<QuestionType> = {
  SHORT_TEXT: { en: 'Short text', ar: 'نص قصير' },
  LONG_TEXT: { en: 'Long text', ar: 'نص طويل' },
  SINGLE_SELECT: { en: 'Single choice', ar: 'اختيار واحد' },
  MULTI_SELECT: { en: 'Multiple choice', ar: 'اختيار متعدد' },
  YES_NO: { en: 'Yes / No', ar: 'نعم / لا' },
  NUMBER: { en: 'Number', ar: 'رقم' },
};

export const applicationStatusLabels: LabelMap<ApplicationStatus> = {
  SUBMITTED: { en: 'Submitted', ar: 'تم التقديم' },
  SHORTLISTED: { en: 'Shortlisted', ar: 'في القائمة المختصرة' },
  AWAITING_PAYMENT: { en: 'Awaiting payment', ar: 'في انتظار الدفع' },
  PAYMENT_SUBMITTED: { en: 'Payment under review', ar: 'الدفع قيد المراجعة' },
  PAYMENT_REJECTED: { en: 'Payment not accepted', ar: 'لم يتم قبول الدفع' },
  ENROLLED: { en: 'Enrolled', ar: 'مسجل' },
  REJECTED: { en: 'Not accepted', ar: 'لم يتم القبول' },
  WAITLISTED: { en: 'Waitlisted', ar: 'في قائمة الانتظار' },
};

export const paymentMethodLabels: LabelMap<PaymentMethod> = {
  INSTAPAY: { en: 'InstaPay', ar: 'إنستاباي (InstaPay)' },
  VODAFONE_CASH: { en: 'Vodafone Cash', ar: 'فودافون كاش' },
  CARD: { en: 'Card', ar: 'بطاقة' },
};

export const paymentStatusLabels: LabelMap<PaymentStatus> = {
  PENDING_REVIEW: { en: 'Pending review', ar: 'قيد المراجعة' },
  APPROVED: { en: 'Approved', ar: 'مقبول' },
  REJECTED: { en: 'Rejected', ar: 'مرفوض' },
};

export function label(map: Record<string, Localized>, value: string, locale: Locale): string {
  return map[value]?.[locale] ?? value;
}

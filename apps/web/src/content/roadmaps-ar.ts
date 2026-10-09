/**
 * Arabic overview of each open-source roadmap, copied from the website
 * (src/lib/content-i18n.ts, `roadmapsAr`), which is what /ar/roadmaps shows on
 * mlopsmena.com. As there, only the overview is translated: the roadmap body
 * (content/roadmaps/*.md) is English in both languages. Change both sites together.
 */
export interface RoadmapArabic {
  title: string;
  tagline: string;
  level: string;
  duration: string;
  commitment: string;
  audience: string;
  /** Keyed by the English heading label ("Phase 0", "Specialization 3"), never by position. */
  phases: Record<string, string>;
}

export const ROADMAPS_AR: Record<string, RoadmapArabic> = {
  'basic-mlops-engineer': {
    title: 'خريطة مهندس MLOps المبتدئ',
    tagline: 'من الصفر إلى الجاهزية للعمل',
    level: 'مبتدئ ← جاهز للعمل',
    duration: '6–9 أشهر',
    commitment: '10–15 ساعة أسبوعيًا',
    audience: 'للطلاب ومهندسي التعلّم الآلي ومهندسي البرمجيات وعلماء البيانات الداخلين إلى مجال MLOps.',
    phases: {
      'Phase 0': 'الأساسيات',
      'Phase 1': 'هندسة البرمجيات للتعلّم الآلي',
      'Phase 2': 'جوهر MLOps',
      'Phase 3': 'أساسيات السحابة',
      'Phase 4': 'المراقبة الأساسية',
    },
  },
  'devops-to-mlops': {
    title: 'خريطة الانتقال من DevOps إلى MLOps',
    tagline: 'أسرع تحوّل مهني في مجال التقنية',
    level: 'DevOps ← MLOps',
    duration: '3–5 أشهر',
    commitment: '10–15 ساعة أسبوعيًا',
    audience: 'لمهندسي DevOps وSRE والمنصّات والبنية التحتية المنتقلين إلى التعلّم الآلي.',
    phases: {
      'Phase 1': 'سدّ فجوة Python والتعلّم الآلي',
      'Phase 2': 'تعلّم أدوات التعلّم الآلي',
      'Phase 3': 'حيث تتألّق مهاراتك في DevOps',
      'Phase 4': 'مفاهيم MLOps التي لن تعرفها',
      'Phase 5': 'تخصّص اختياري: LLMOps',
    },
  },
  'senior-mlops-engineer': {
    title: 'خريطة MLOps للخبراء',
    tagline: 'العمق وتفكير الأنظمة ومقياس الإنتاج',
    level: 'متوسط ← خبير',
    duration: 'مستمرة',
    commitment: 'اختر 2–3 تخصّصات',
    audience: 'لمهندسي MLOps في المستويين المبتدئ والمتوسط الراغبين في الوصول إلى مستوى الخبير.',
    phases: {
      'Specialization 1': 'LLMOps',
      'Specialization 2': 'تحسين النماذج',
      'Specialization 3': 'Kubernetes في الإنتاج والأنظمة الموزّعة',
      'Specialization 4': 'المراقبة المتقدّمة',
      'Specialization 5': 'اختبار الأداء والحِمل',
      'Specialization 6': 'تصميم أنظمة التعلّم الآلي',
      'Specialization 7': 'المهارات الشخصية',
    },
  },
};

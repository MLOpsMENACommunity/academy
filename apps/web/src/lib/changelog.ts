/**
 * The /whats-new page: user-facing changes to the academy, newest first. Add an entry
 * at the top when something people will notice ships; the header shows a dot until
 * the visitor has seen the newest one (remembered in this browser only).
 */
export interface ChangelogEntry {
  /** Stable and unique: the header's "unread" dot compares it. */
  id: string;
  /** YYYY-MM-DD */
  date: string;
  title: { en: string; ar: string };
  body: { en: string; ar: string };
  /** A page on this site (without the locale) to try it. */
  path?: string;
}

export const CHANGELOG: readonly ChangelogEntry[] = [
  {
    id: '2026-10-community-usernames',
    date: '2026-10-15',
    title: { en: 'Your Telegram and Discord usernames', ar: 'اسما المستخدم على Telegram وDiscord' },
    body: {
      en: 'Course groups and community help happen on Telegram and Discord, so your profile now asks for both usernames. Already a student? Nothing changes for your current courses: add them from your profile before your next application.',
      ar: 'مجموعات الدورات ومساعدة المجتمع تتم على Telegram وDiscord، لذا يطلب ملفك الشخصي الآن اسمي المستخدم عليهما. هل أنت طالب بالفعل؟ لا يتغير شيء في دوراتك الحالية: أضفهما من ملفك الشخصي قبل تقديمك القادم.',
    },
    path: '/profile?tab=community',
  },
  {
    id: '2026-10-light-academy',
    date: '2026-10-09',
    title: { en: 'A calmer look, learning paths and a new menu', ar: 'مظهر أهدأ ومسارات تعلّم وقائمة جديدة' },
    body: {
      en: 'The academy has a lighter design. Learning paths put courses and free recordings in a sensible order, the menu groups everything under Learn, Live and Community, and the dashboard and course pages show your progress more clearly.',
      ar: 'للأكاديمية تصميم أخفّ. مسارات التعلّم ترتّب الدورات والتسجيلات المجانية ترتيبًا منطقيًا، والقائمة تجمع كل شيء تحت «تعلّم» و«مباشر» و«المجتمع»، ولوحة التحكم وصفحات الدورات تعرض تقدّمك بوضوح أكبر.',
    },
    path: '/learning-paths',
  },
  {
    id: '2026-10-waiting-list',
    date: '2026-10-09',
    title: { en: 'Get notified when a course opens', ar: 'تنبيه عند فتح التسجيل في دورة' },
    body: {
      en: 'Courses that are coming soon have a "Notify me" button. Leave your email and we write to you once, when applications open.',
      ar: 'في الدورات القادمة زر «أبلغني». اترك بريدك الإلكتروني وسنراسلك مرة واحدة عند فتح التسجيل.',
    },
    path: '/courses',
  },
  {
    id: '2026-10-recordings-library',
    date: '2026-10-08',
    title: { en: 'Recordings library and speaker pages', ar: 'مكتبة التسجيلات وصفحات المتحدثين' },
    body: {
      en: 'Every past live session and course lesson with a recording is in one place, with topic filters and search. Each speaker has a page with their sessions and courses.',
      ar: 'كل الجلسات المباشرة ودروس الدورات المسجّلة في مكان واحد، مع تصفية حسب الموضوع وبحث. ولكل متحدث صفحة تضم جلساته ودوراته.',
    },
    path: '/sessions/recordings',
  },
];

export const LATEST_CHANGE_ID = CHANGELOG[0]?.id ?? '';
export const WHATS_NEW_STORAGE_KEY = 'academy.whatsNew.seen';

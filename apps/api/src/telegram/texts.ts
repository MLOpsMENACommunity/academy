import type { Locale } from '@academy/shared';

/**
 * What the bot says, in English and Arabic. Messages to someone whose account we know use their
 * language; to an unknown Telegram user, both (English first, then Arabic). Plain text: no
 * Markdown, so course titles can't break the formatting.
 */
type Course = { titleEn: string; titleAr: string };
type Text = Record<Locale, string>;

const both = (t: Text) => `${t.en}\n\n${t.ar}`;

export const botTexts = {
  /** "/start" without a valid token, or any other message. */
  help: (url: Text) =>
    both({
      en: `Hi! I'm the MLOps MENA Academy bot. To connect your Telegram account, open Profile → Community on the academy and choose "Connect Telegram": ${url.en}`,
      ar: `مرحبًا! أنا بوت أكاديمية MLOps MENA. لربط حسابك على Telegram، افتح الملف الشخصي ← المجتمع في الأكاديمية واختر «ربط Telegram»: ${url.ar}`,
    }),

  expired: (url: Text) =>
    both({
      en: `This connect link has expired or was already used. Open Profile → Community on the academy and choose "Connect Telegram" again: ${url.en}`,
      ar: `انتهت صلاحية رابط الربط هذا أو استُخدم من قبل. افتح الملف الشخصي ← المجتمع في الأكاديمية واختر «ربط Telegram» مرة أخرى: ${url.ar}`,
    }),

  linked: (locale: Locale, approved: number): string =>
    ({
      en: `Your Telegram account is now connected to your MLOps MENA Academy account. Join your courses' Telegram groups from each course's page.${approved ? ' Your waiting requests to join your course groups were approved.' : ''}`,
      ar: `تم ربط حسابك على Telegram بحسابك في أكاديمية MLOps MENA. انضم إلى مجموعات Telegram لدوراتك من صفحة كل دورة.${approved ? ' وتمت الموافقة على طلباتك المعلّقة للانضمام إلى مجموعات دوراتك.' : ''}`,
    })[locale],

  alreadyLinked: (locale: Locale): string =>
    ({
      en: 'This Telegram account is already connected to your academy account.',
      ar: 'حساب Telegram هذا مربوط بالفعل بحسابك في الأكاديمية.',
    })[locale],

  /** The Telegram account is connected to another academy account: refused, never moved. */
  takenByOther: (locale: Locale): string =>
    ({
      en: 'This Telegram account is already connected to another academy account. Sign in to that account and choose "Disconnect" in Profile → Community first, then try again.',
      ar: 'حساب Telegram هذا مربوط بالفعل بحساب آخر في الأكاديمية. سجّل الدخول إلى ذلك الحساب واختر «إلغاء الربط» من الملف الشخصي ← المجتمع أولًا، ثم حاول مرة أخرى.',
    })[locale],

  /** A join request from a Telegram account that isn't connected to the academy yet. */
  joinUnlinked: (course: Course, url: Text) =>
    both({
      en: `Thanks for asking to join the group of "${course.titleEn}". It is for the course's enrolled students, so first connect your Telegram account to your academy account: open ${url.en} and choose "Connect Telegram". You'll be let in right after.`,
      ar: `شكرًا لطلبك الانضمام إلى مجموعة «${course.titleAr}». المجموعة للطلاب المسجّلين في الدورة، لذا اربط أولًا حسابك على Telegram بحسابك في الأكاديمية: افتح ${url.ar} واختر «ربط Telegram»، وسنقبل طلبك بعدها مباشرة.`,
    }),

  /** A join request from a connected account that isn't enrolled in the course (yet). */
  joinNotEnrolled: (locale: Locale, course: Course): string =>
    ({
      en: `Your request to join the group of "${course.titleEn}" is waiting: the group is for the course's enrolled students. Once you're enrolled, you'll be let in.`,
      ar: `طلبك الانضمام إلى مجموعة «${course.titleAr}» قيد الانتظار: المجموعة للطلاب المسجّلين في الدورة. بمجرد تسجيلك في الدورة سنقبل طلبك.`,
    })[locale],
};

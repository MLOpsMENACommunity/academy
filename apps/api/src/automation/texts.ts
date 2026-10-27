/**
 * The words automation rules send, in English and Arabic. Student messages become an in-app
 * notification (title + first line) and an email (every line, the button, the team's note);
 * team alerts are in-app only. Never "today" or "tonight": an hourly job, quiet hours and
 * students' own time zones mean a message can arrive later or elsewhere.
 */

export interface Words {
  title: string;
  lines: string[];
  cta: string;
}
export interface StudentText {
  en: Words;
  ar: Words;
}
export interface AlertText {
  titleEn: string;
  titleAr: string;
  bodyEn: string;
  bodyAr: string;
}

export interface CourseNames {
  en: string;
  ar: string;
}

const both = (en: Words, ar: Words): StudentText => ({ en, ar });
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
/** Arabic number words are left to the digits; the noun follows the common dual/plural forms. */
const arCount = (n: number, one: string, two: string, few: string, many: string) => (n === 1 ? one : n === 2 ? two : n <= 10 ? `${n} ${few}` : `${n} ${many}`);

export const studentTexts = {
  missedInARow: (c: CourseNames, n: number) =>
    both(
      {
        title: `We missed you in ${c.en}`,
        lines: [
          `You weren't in the last ${n} sessions of ${c.en}. Everything is fine if life got busy: the recordings and materials are on the course page.`,
          'If something is in the way, reply to the course team; they are happy to help you catch up.',
        ],
        cta: 'Open the course',
      },
      {
        title: `افتقدناك في ${c.ar}`,
        lines: [
          `لم تحضر آخر ${arCount(n, 'جلسة', 'جلستين', 'جلسات', 'جلسة')} من ${c.ar}. لا بأس إن انشغلت: التسجيلات والمواد موجودة في صفحة الدورة.`,
          'إن كان هناك ما يعيقك، فتواصل مع فريق الدورة؛ يسعدهم مساعدتك على اللحاق.',
        ],
        cta: 'افتح الدورة',
      },
    ),
  inactive: (c: CourseNames, next: { en: string | null; ar: string | null }, due: number) =>
    both(
      {
        title: `Your next step in ${c.en}`,
        lines: [
          `It's been a while since we saw you in ${c.en}.`,
          ...(next.en ? [`The next session is ${next.en}.`] : []),
          ...(due ? [`You have ${due} ${plural(due, 'assessment', 'assessments')} waiting.`] : []),
        ],
        cta: 'Continue the course',
      },
      {
        title: `خطوتك التالية في ${c.ar}`,
        lines: [
          `مرّ وقت منذ آخر نشاط لك في ${c.ar}.`,
          ...(next.ar ? [`الجلسة القادمة ${next.ar}.`] : []),
          ...(due ? [`لديك ${arCount(due, 'تقييم واحد', 'تقييمان', 'تقييمات', 'تقييمًا')} بانتظارك.`] : []),
        ],
        cta: 'تابع الدورة',
      },
    ),
  fullAttendance: (c: CourseNames, points: number) =>
    both(
      {
        title: `Perfect attendance so far: +${points} points`,
        lines: [`You've attended every session of ${c.en} so far. Here are ${points} bonus points. Keep going!`],
        cta: 'See the leaderboard',
      },
      {
        title: `حضور كامل حتى الآن: +${points} نقطة`,
        lines: [`حضرت كل جلسات ${c.ar} حتى الآن. إليك ${points} نقطة إضافية. استمر!`],
        cta: 'اعرض لوحة الصدارة',
      },
    ),
  oftenLate: (c: CourseNames) =>
    both(
      {
        title: `Catch the start of ${c.en}`,
        lines: [
          `You've joined part of several sessions of ${c.en}. The first minutes often set up the rest, so try to join on time.`,
          'Session reminders arrive a day and an hour before each session; the calendar feed keeps them in your calendar.',
        ],
        cta: 'See the sessions',
      },
      {
        title: `احضر بداية جلسات ${c.ar}`,
        lines: [
          `حضرت جزءًا من عدة جلسات في ${c.ar}. الدقائق الأولى تمهّد لما بعدها، فحاول الانضمام في الموعد.`,
          'تصلك تذكيرات قبل كل جلسة بيوم وبساعة، ويحفظها لك رابط التقويم في تقويمك.',
        ],
        cta: 'اعرض الجلسات',
      },
    ),
  dueSoon: (c: CourseNames, a: CourseNames, due: { en: string; ar: string }) =>
    both(
      { title: `Due ${due.en}: ${a.en}`, lines: [`"${a.en}" in ${c.en} is due ${due.en}, and you haven't started it yet.`], cta: 'Start it' },
      { title: `موعد التسليم ${due.ar}: ${a.ar}`, lines: [`موعد تسليم «${a.ar}» في ${c.ar} هو ${due.ar}، ولم تبدأه بعد.`], cta: 'ابدأه' },
    ),
  deadlineMissed: (c: CourseNames, a: CourseNames, allowLate: boolean) =>
    both(
      {
        title: `Missed deadline: ${a.en}`,
        lines: [
          `The deadline for "${a.en}" in ${c.en} has passed and we haven't received your work.`,
          allowLate ? 'You can still submit it; it will be marked late.' : "Late submissions aren't accepted for this one. If something got in the way, contact the course team.",
        ],
        cta: allowLate ? 'Submit now' : 'Open the course',
      },
      {
        title: `فاتك موعد التسليم: ${a.ar}`,
        lines: [
          `انتهى موعد تسليم «${a.ar}» في ${c.ar} ولم نستلم عملك.`,
          allowLate ? 'ما زال بإمكانك التسليم، وسيُسجَّل متأخرًا.' : 'لا يُقبل التسليم المتأخر لهذا التقييم. إن واجهتك ظروف، فتواصل مع فريق الدورة.',
        ],
        cta: allowLate ? 'سلّم الآن' : 'افتح الدورة',
      },
    ),
  quizFailed: (c: CourseNames, a: CourseNames, pass: number, left: number | null) =>
    both(
      {
        title: `Not passed yet: ${a.en}`,
        lines: [
          `Your score on "${a.en}" is below the ${pass}% pass mark.`,
          'Review the session materials and recording on the course page.',
          left === null ? 'You can try again as many times as you need.' : left > 0 ? `You have ${left} ${plural(left, 'attempt', 'attempts')} left.` : 'No attempts are left; the course team can help if you need it.',
        ],
        cta: 'Review and retry',
      },
      {
        title: `لم تنجح بعد: ${a.ar}`,
        lines: [
          `درجتك في «${a.ar}» أقل من درجة النجاح ${pass}٪.`,
          'راجع مواد الجلسة وتسجيلها في صفحة الدورة.',
          left === null ? 'يمكنك المحاولة مجددًا كلما احتجت.' : left > 0 ? `بقي لك ${arCount(left, 'محاولة واحدة', 'محاولتان', 'محاولات', 'محاولة')}.` : 'لم تبقَ محاولات؛ يمكن لفريق الدورة مساعدتك إن احتجت.',
        ],
        cta: 'راجع وأعد المحاولة',
      },
    ),
  highScore: (c: CourseNames, a: CourseNames, percent: number, points: number) =>
    both(
      { title: `Great score: +${points} points`, lines: [`You scored ${percent}% on "${a.en}" in ${c.en}. Here are ${points} bonus points.`], cta: 'See your points' },
      { title: `درجة رائعة: +${points} نقطة`, lines: [`حصلت على ${percent}٪ في «${a.ar}» ضمن ${c.ar}. إليك ${points} نقطة إضافية.`], cta: 'اعرض نقاطك' },
    ),
  mandatoryPassed: (c: CourseNames, sessions: { ok: boolean; required: number | null; percent: number }) =>
    both(
      {
        title: `All required assessments passed in ${c.en}`,
        lines: [
          'Well done: you passed every assessment the certificate needs.',
          sessions.ok
            ? 'You also meet the attendance rule, so the certificate is yours once the team issues it.'
            : `For the certificate you also need to attend ${sessions.required}% of the sessions (you're at ${sessions.percent}%).`,
        ],
        cta: 'Open the course',
      },
      {
        title: `اجتزت كل التقييمات المطلوبة في ${c.ar}`,
        lines: [
          'أحسنت: اجتزت كل التقييمات التي تتطلبها الشهادة.',
          sessions.ok
            ? 'وتستوفي شرط الحضور أيضًا، فالشهادة لك بمجرد أن يصدرها الفريق.'
            : `وللحصول على الشهادة تحتاج أيضًا إلى حضور ${sessions.required}٪ من الجلسات (أنت الآن عند ${sessions.percent}٪).`,
        ],
        cta: 'افتح الدورة',
      },
    ),
  certAlmost: (c: CourseNames, missing: { sessions?: { required: number; percent: number }; assessments?: number }) =>
    both(
      {
        title: `One step from your ${c.en} certificate`,
        lines: [
          'The course ends soon and you are close to the certificate.',
          missing.sessions
            ? `Attendance: you need ${missing.sessions.required}% of the sessions and you're at ${missing.sessions.percent}%. Attend the remaining sessions.`
            : `Assessments: ${missing.assessments} required ${plural(missing.assessments ?? 0, 'assessment is', 'assessments are')} not passed yet.`,
        ],
        cta: 'See what is left',
      },
      {
        title: `خطوة واحدة نحو شهادة ${c.ar}`,
        lines: [
          'تقترب الدورة من نهايتها وأنت قريب من الشهادة.',
          missing.sessions
            ? `الحضور: تحتاج إلى ${missing.sessions.required}٪ من الجلسات وأنت عند ${missing.sessions.percent}٪. احضر الجلسات المتبقية.`
            : `التقييمات: ${arCount(missing.assessments ?? 0, 'تقييم مطلوب واحد', 'تقييمان مطلوبان', 'تقييمات مطلوبة', 'تقييمًا مطلوبًا')} لم تجتزه بعد.`,
        ],
        cta: 'اعرض ما تبقى',
      },
    ),
  feedbackNudge: (c: CourseNames, s: CourseNames & { order: number }) =>
    both(
      { title: `A quick rating for session ${s.order}?`, lines: [`How was "${s.en}" in ${c.en}? One to five stars takes 10 seconds and helps the team.`], cta: 'Rate the session' },
      { title: `تقييم سريع للجلسة ${s.order}؟`, lines: [`كيف كانت «${s.ar}» في ${c.ar}؟ اختيار من نجمة إلى خمس نجوم يستغرق 10 ثوانٍ ويساعد الفريق.`], cta: 'قيّم الجلسة' },
    ),
  paymentReminder: (c: CourseNames, second: boolean) =>
    both(
      {
        title: `Your seat in ${c.en} is waiting for payment`,
        lines: [
          `You were accepted to ${c.en} and your payment is still due.`,
          second ? 'If something is in the way, contact us; we can help.' : 'Pay by the methods on your application page to confirm your seat.',
        ],
        cta: 'Complete payment',
      },
      {
        title: `مقعدك في ${c.ar} بانتظار الدفع`,
        lines: [
          `قُبلت في ${c.ar} وما زال الدفع مستحقًا.`,
          second ? 'إن كان هناك ما يعيقك فتواصل معنا؛ يمكننا المساعدة.' : 'ادفع بإحدى الطرق الموضحة في صفحة طلبك لتأكيد مقعدك.',
        ],
        cta: 'أكمل الدفع',
      },
    ),
  welcome: (c: CourseNames, start: { en: string | null; ar: string | null }, o: { telegram: boolean; google: string | null; drive: boolean }) =>
    both(
      {
        title: `${c.en} starts soon`,
        lines: [
          start.en ? `The first session is ${start.en}.` : `${c.en} starts soon.`,
          'On the course page: the sessions, live links (shown before each session) and any preparation.',
          'Add the sessions to your calendar from your dashboard so you never miss one.',
          ...(o.telegram ? ['Add your Telegram username to your profile so the team can add you to the course group.'] : []),
          ...(o.drive ? [o.google ? `Recordings will be shared with your Google account ${o.google}: check it's right.` : 'Add your Google account email to your profile: recordings are shared with it.'] : []),
        ],
        cta: 'Open the course',
      },
      {
        title: `${c.ar} تبدأ قريبًا`,
        lines: [
          start.ar ? `الجلسة الأولى ${start.ar}.` : `${c.ar} تبدأ قريبًا.`,
          'في صفحة الدورة: الجلسات، وروابط البث (تظهر قبل كل جلسة)، وأي تحضير مطلوب.',
          'أضف الجلسات إلى تقويمك من لوحة التحكم حتى لا تفوتك جلسة.',
          ...(o.telegram ? ['أضف اسم مستخدم Telegram إلى ملفك الشخصي ليضيفك الفريق إلى مجموعة الدورة.'] : []),
          ...(o.drive ? [o.google ? `ستُشارك التسجيلات مع حساب Google الخاص بك ${o.google}: تأكد من صحته.` : 'أضف بريد حساب Google إلى ملفك الشخصي: تُشارك التسجيلات معه.'] : []),
        ],
        cta: 'افتح الدورة',
      },
    ),
  midcourse: (c: CourseNames) =>
    both(
      {
        title: `Halfway through ${c.en}`,
        lines: [`You're halfway through ${c.en}. How is it going? Rate the sessions so far: the team reads every rating and adjusts the rest of the course.`],
        cta: 'Rate the sessions',
      },
      {
        title: `منتصف ${c.ar}`,
        lines: [`وصلت إلى منتصف ${c.ar}. كيف تسير الأمور؟ قيّم الجلسات حتى الآن: يقرأ الفريق كل تقييم ويعدّل بقية الدورة.`],
        cta: 'قيّم الجلسات',
      },
    ),
  wrapUp: (c: CourseNames) =>
    both(
      {
        title: `Thank you for joining ${c.en}`,
        lines: [`${c.en} has finished. Thank you for learning with us.`, 'Rate the course in a few seconds, and see what to learn next.'],
        cta: 'Rate the course',
      },
      { title: `شكرًا لانضمامك إلى ${c.ar}`, lines: [`انتهت ${c.ar}. شكرًا لتعلّمك معنا.`, 'قيّم الدورة في ثوانٍ، واكتشف ما تتعلمه بعدها.'], cta: 'قيّم الدورة' },
    ),
  communityLinks: (c: CourseNames, links: { telegram: string; discord: string }) =>
    both(
      {
        title: `Join the ${c.en} community`,
        lines: [
          'Meet your classmates and the course team:',
          ...(links.telegram ? [`Telegram: ${links.telegram}`] : []),
          ...(links.discord ? [`Discord: ${links.discord}`] : []),
        ],
        cta: links.telegram ? 'Join on Telegram' : 'Join on Discord',
      },
      {
        title: `انضم إلى مجتمع ${c.ar}`,
        lines: ['تعرّف على زملائك وفريق الدورة:', ...(links.telegram ? [`Telegram: ${links.telegram}`] : []), ...(links.discord ? [`Discord: ${links.discord}`] : [])],
        cta: links.telegram ? 'انضم عبر Telegram' : 'انضم عبر Discord',
      },
    ),
  telegramMissing: (c: CourseNames) =>
    both(
      {
        title: 'Add your Telegram username',
        lines: [`The ${c.en} team uses Telegram for the course group. Add your username to your profile so they can add you.`],
        cta: 'Add it to my profile',
      },
      { title: 'أضف اسم مستخدم Telegram', lines: [`يستخدم فريق ${c.ar} تطبيق Telegram لمجموعة الدورة. أضف اسم المستخدم إلى ملفك الشخصي ليضيفوك.`], cta: 'أضفه إلى ملفي' },
    ),
  weeklySummary: (c: CourseNames, week: number, rank: number, of: number) =>
    both(
      {
        title: `Your week in ${c.en}: +${week} points`,
        lines: [`Last week you earned ${week} ${plural(week, 'point', 'points')} in ${c.en}. You're #${rank} of ${of} on the course leaderboard.`],
        cta: 'See the leaderboard',
      },
      {
        title: `أسبوعك في ${c.ar}: +${week} نقطة`,
        lines: [`حصلت الأسبوع الماضي على ${week} نقطة في ${c.ar}. ترتيبك ${rank} من ${of} في لوحة صدارة الدورة.`],
        cta: 'اعرض لوحة الصدارة',
      },
    ),
};

/** Team alerts: one per rule per run, counting what it found. */
export const alertTexts = {
  missedInARow: (c: CourseNames, count: number, n: number): AlertText => ({
    titleEn: `${c.en}: ${count} ${plural(count, 'student', 'students')} missed ${n} sessions in a row`,
    titleAr: `${c.ar}: ${arCount(count, 'طالب', 'طالبان', 'طلاب', 'طالبًا')} غابوا عن ${n} جلسات متتالية`,
    bodyEn: 'They got a friendly check-in message. The Automation tab lists them under "Needs attention".',
    bodyAr: 'وصلتهم رسالة اطمئنان ودية. تجدهم في تبويب الأتمتة تحت «يحتاجون إلى متابعة».',
  }),
  atRisk: (c: CourseNames, count: number, n: number): AlertText => ({
    titleEn: `${c.en}: ${count} ${plural(count, 'student', 'students')} at risk`,
    titleAr: `${c.ar}: ${arCount(count, 'طالب', 'طالبان', 'طلاب', 'طالبًا')} معرّضون للتعثر`,
    bodyEn: `They attended none of the first ${n} sessions. See them in the Automation tab, "Needs attention".`,
    bodyAr: `لم يحضروا أيًّا من أول ${n} جلسات. تجدهم في تبويب الأتمتة تحت «يحتاجون إلى متابعة».`,
  }),
  deadlineMissed: (c: CourseNames, count: number): AlertText => ({
    titleEn: `${c.en}: ${count} missed ${plural(count, 'deadline', 'deadlines')}`,
    titleAr: `${c.ar}: ${arCount(count, 'موعد تسليم فائت', 'موعدا تسليم فائتان', 'مواعيد تسليم فائتة', 'موعد تسليم فائتًا')}`,
    bodyEn: 'Students missed an assessment deadline; each was told how to proceed.',
    bodyAr: 'فات بعض الطلاب موعد تسليم أحد التقييمات، وأُبلغ كلٌّ منهم بما عليه فعله.',
  }),
  ungraded: (c: CourseNames, count: number, days: number): AlertText => ({
    titleEn: `${c.en}: ${count} ${plural(count, 'submission', 'submissions')} waiting to be graded`,
    titleAr: `${c.ar}: ${arCount(count, 'تسليم', 'تسليمان', 'تسليمات', 'تسليمًا')} بانتظار التصحيح`,
    bodyEn: `Submitted ${days}+ days ago and not graded yet.`,
    bodyAr: `سُلّمت منذ ${days} أيام أو أكثر ولم تُصحَّح بعد.`,
  }),
  certEligible: (c: CourseNames, count: number, issued: boolean): AlertText => ({
    titleEn: issued ? `${c.en}: ${count} ${plural(count, 'certificate', 'certificates')} issued` : `${c.en}: ${count} ${plural(count, 'student is', 'students are')} eligible for a certificate`,
    titleAr: issued ? `${c.ar}: أُصدرت ${arCount(count, 'شهادة', 'شهادتان', 'شهادات', 'شهادة')}` : `${c.ar}: ${arCount(count, 'طالب مؤهل', 'طالبان مؤهلان', 'طلاب مؤهلون', 'طالبًا مؤهلًا')} للشهادة`,
    bodyEn: issued ? 'The automation rule issued them; each student was emailed.' : 'Review them in the Certificates tab and issue.',
    bodyAr: issued ? 'أصدرتها قاعدة الأتمتة، وأُبلغ كل طالب بالبريد.' : 'راجعهم في تبويب الشهادات وأصدر الشهادات.',
  }),
  certFailed: (c: CourseNames, count: number): AlertText => ({
    titleEn: `${c.en}: ${count} ${plural(count, 'certificate', 'certificates')} could not be issued`,
    titleAr: `${c.ar}: تعذّر إصدار ${arCount(count, 'شهادة', 'شهادتين', 'شهادات', 'شهادة')}`,
    bodyEn: 'Usually a missing name on the profile. Check them in the Certificates tab.',
    bodyAr: 'غالبًا بسبب غياب الاسم في الملف الشخصي. راجعهم في تبويب الشهادات.',
  }),
  lowRating: (c: CourseNames, count: number, max: number): AlertText => ({
    titleEn: `${c.en}: ${count} low ${plural(count, 'rating', 'ratings')}`,
    titleAr: `${c.ar}: ${arCount(count, 'تقييم منخفض', 'تقييمان منخفضان', 'تقييمات منخفضة', 'تقييمًا منخفضًا')}`,
    bodyEn: `Rated ${max} ${plural(max, 'star', 'stars')} or fewer. Read the comments in the feedback.`,
    bodyAr: `بتقييم ${max} نجوم أو أقل. اقرأ التعليقات في التقييمات.`,
  }),
  averageDrop: (c: CourseNames, average: number, threshold: number): AlertText => ({
    titleEn: `${c.en}: average rating ${average.toFixed(1)}`,
    titleAr: `${c.ar}: متوسط التقييم ${average.toFixed(1)}`,
    bodyEn: `The sessions' average rating is below ${threshold}. Read the comments in the feedback.`,
    bodyAr: `متوسط تقييم الجلسات أقل من ${threshold}. اقرأ التعليقات في التقييمات.`,
  }),
  paymentDue: (c: CourseNames, count: number, days: number): AlertText => ({
    titleEn: `${c.en}: ${count} accepted ${plural(count, 'student has', 'students have')} not paid`,
    titleAr: `${c.ar}: ${arCount(count, 'طالب مقبول لم يدفع', 'طالبان مقبولان لم يدفعا', 'طلاب مقبولين لم يدفعوا', 'طالبًا مقبولًا لم يدفعوا')}`,
    bodyEn: `Accepted ${days}+ days ago and reminded twice. Their seats are kept: contact them if needed.`,
    bodyAr: `قُبلوا منذ ${days} أيام أو أكثر وذُكّروا مرتين. مقاعدهم محفوظة: تواصل معهم إن لزم.`,
  }),
  seatOpen: (c: CourseNames, free: number, waiting: number): AlertText => ({
    titleEn: `${c.en}: ${free} ${plural(free, 'seat', 'seats')} free, ${waiting} waiting`,
    titleAr: `${c.ar}: ${arCount(free, 'مقعد شاغر', 'مقعدان شاغران', 'مقاعد شاغرة', 'مقعدًا شاغرًا')}، و${waiting} في الانتظار`,
    bodyEn: 'Seats are free while people are on the waiting list. Review the waitlisted applications or notify the waiting list.',
    bodyAr: 'توجد مقاعد شاغرة وأشخاص في قائمة الانتظار. راجع الطلبات المنتظرة أو أبلغ قائمة الانتظار.',
  }),
  applicationIdle: (c: CourseNames, count: number, days: number): AlertText => ({
    titleEn: `${c.en}: ${count} ${plural(count, 'application', 'applications')} waiting for review`,
    titleAr: `${c.ar}: ${arCount(count, 'طلب', 'طلبان', 'طلبات', 'طلبًا')} بانتظار المراجعة`,
    bodyEn: `Submitted ${days}+ days ago and not reviewed yet.`,
    bodyAr: `قُدّمت منذ ${days} أيام أو أكثر ولم تُراجع بعد.`,
  }),
  capacity: (c: CourseNames, percent: number, full: boolean): AlertText => ({
    titleEn: full ? `${c.en} is full` : `${c.en} is ${percent}% full`,
    titleAr: full ? `اكتملت مقاعد ${c.ar}` : `امتلأ ${percent}٪ من مقاعد ${c.ar}`,
    bodyEn: full ? 'New applicants now join the waiting list.' : 'Consider more seats or another cohort.',
    bodyAr: full ? 'ينضم المتقدمون الجدد الآن إلى قائمة الانتظار.' : 'فكّر في زيادة المقاعد أو فتح دفعة أخرى.',
  }),
  proofWaiting: (c: CourseNames, count: number, hours: number): AlertText => ({
    titleEn: `${c.en}: ${count} ${plural(count, 'payment', 'payments')} waiting for review`,
    titleAr: `${c.ar}: ${arCount(count, 'دفعة', 'دفعتان', 'دفعات', 'دفعة')} بانتظار المراجعة`,
    bodyEn: `Proof uploaded ${hours}+ hours ago.`,
    bodyAr: `رُفع الإثبات منذ ${hours} ساعة أو أكثر.`,
  }),
  noLiveLink: (c: CourseNames, count: number): AlertText => ({
    titleEn: `${c.en}: a session starts soon without a live link`,
    titleAr: `${c.ar}: جلسة تبدأ قريبًا بلا رابط بث`,
    bodyEn: `${count} upcoming ${plural(count, 'session has', 'sessions have')} no Meet/live link yet.`,
    bodyAr: `${arCount(count, 'جلسة قادمة', 'جلستان قادمتان', 'جلسات قادمة', 'جلسة قادمة')} بلا رابط بث حتى الآن.`,
  }),
  noMaterials: (c: CourseNames, count: number): AlertText => ({
    titleEn: `${c.en}: materials missing for an upcoming session`,
    titleAr: `${c.ar}: مواد جلسة قادمة غير مرفوعة`,
    bodyEn: `${count} upcoming ${plural(count, 'session has', 'sessions have')} no materials yet.`,
    bodyAr: `${arCount(count, 'جلسة قادمة', 'جلستان قادمتان', 'جلسات قادمة', 'جلسة قادمة')} بلا مواد حتى الآن.`,
  }),
  noRecording: (c: CourseNames, count: number): AlertText => ({
    titleEn: `${c.en}: recording missing`,
    titleAr: `${c.ar}: تسجيل غير مرفوع`,
    bodyEn: `${count} past ${plural(count, 'session has', 'sessions have')} no recording link yet.`,
    bodyAr: `${arCount(count, 'جلسة سابقة', 'جلستان سابقتان', 'جلسات سابقة', 'جلسة سابقة')} بلا رابط تسجيل حتى الآن.`,
  }),
};

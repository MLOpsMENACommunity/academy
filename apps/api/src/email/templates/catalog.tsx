import { applicationStatusLabels, applicationStatusMessages, type ApplicationStatus, type Locale } from '@academy/shared';
import { Link } from '@react-email/components';
import type { ReactElement } from 'react';
import { Layout } from './Layout';

/** Every email the academy sends, with the data each one needs. */
export type EmailTemplate =
  | { name: 'verifyEmail'; url: string }
  | { name: 'confirmNewEmail'; url: string }
  | { name: 'resetPassword'; url: string }
  | {
      name: 'applicationStatus';
      courseTitle: string;
      status: ApplicationStatus;
      /** Admin feedback (rejections) or the reason a payment was rejected. */
      reason?: string | null;
      /** The application page on the student's dashboard. */
      url: string;
      /** Learning page (enrolled) or public course page. */
      courseUrl?: string;
      /** Catalog, for rejections. */
      browseUrl?: string;
      /** First session or start date, already formatted in the student's time zone. */
      startsAt?: string | null;
      /** The course's recordings are public on YouTube (free courses). */
      recordingsPublic?: boolean;
      /** The course page has a "Before the course starts" section. */
      hasPreparation?: boolean;
    }
  | {
      name: 'sessionReminder';
      courseTitle: string;
      sessionTitle: string;
      startsAt: string;
      hoursBefore: 24 | 1;
      url: string;
      unsubscribeUrl: string;
    }
  | { name: 'profileReview'; url: string }
  | { name: 'accountDeleted' }
  /** Sent to the account's (old) address after a sensitive change. */
  | { name: 'securityNotice'; kind: 'emailChanged' | 'passwordChanged'; url: string }
  | { name: 'adminAlert'; message: string; url: string }
  /** Registration confirmation for a free live session. */
  /** calendarUrl: a Google Calendar link pointing at the public page (never the join link). */
  | { name: 'eventRegistered'; title: string; when: string; url: string; calendarUrl?: string }
  | { name: 'eventReminder'; title: string; when: string; hoursBefore: 24 | 1; url: string }
  /** Sent by an admin to a course's students. */
  | { name: 'announcement'; courseTitle: string; subject: string; body: string; url: string };

type Built = { subject: string; element: ReactElement };

const footer: Record<Locale, string> = {
  en: 'MLOps MENA Academy · academy.mlopsmena.com. You are receiving this because you have an account with us.',
  ar: 'أكاديمية MLOps MENA · academy.mlopsmena.com. وصلتك هذه الرسالة لأن لديك حسابًا لدينا.',
};

type StatusTemplate = Extract<EmailTemplate, { name: 'applicationStatus' }>;

/** One email per application status: clear, warm, and with the next step as the button. */
function applicationEmail(t: StatusTemplate, locale: Locale, base: { locale: Locale; footer: string }): Built {
  const ar = locale === 'ar';
  const c = t.courseTitle;
  const team = ar ? 'فريق أكاديمية MLOps MENA' : 'The MLOps MENA Academy team';
  const dashboard = { label: ar ? 'عرض طلبك' : 'View your application', url: t.url };
  const mk = (subject: string, props: Omit<Parameters<typeof Layout>[0], 'locale' | 'footer' | 'preview'>): Built => ({
    subject,
    element: <Layout {...base} preview={subject} {...props} />,
  });

  switch (t.status) {
    case 'ENROLLED': {
      const items = ar
        ? [
            'افتح صفحة الدورة لترى الجدول وأضف كل الجلسات إلى تقويمك. يظهر رابط الجلسة المباشرة هناك قبل بدايتها بوقت قصير.',
            ...(t.hasPreparation ? ['اقرأ قسم «قبل بدء الدورة» في صفحة الدورة وأنجز ما يطلبه من تحضير.'] : []),
            'تابع بريدك: سنرسل لك تذكيرًا قبل كل جلسة بـ 24 ساعة وبساعة واحدة، إضافة إلى إعلانات فريق الدورة.',
          ]
        : [
            'Open your course page to see the schedule and add every session to your calendar. The live link appears there shortly before each session.',
            ...(t.hasPreparation ? ['Read "Before the course starts" on the course page and do the setup it asks for.'] : []),
            'Watch your inbox: we send reminders 24 hours and 1 hour before each session, plus announcements from the course team.',
          ];
      return mk(ar ? `🎉 تم قبولك في ${c}` : `🎉 You're accepted: ${c}`, {
        banner: { text: ar ? 'مبروك، تم قبولك!' : "Congratulations, you're in!", tone: 'success' },
        heading: c,
        paragraphs: [
          ar
            ? `يسعدنا أن نخبرك بقبول طلبك في ${c}، وأصبحت الآن مسجلًا في الدورة.`
            : `We're delighted to tell you that your application to ${c} was accepted, and you're now enrolled.`,
          ...(t.startsAt ? [ar ? `تبدأ الدورة ${t.startsAt}.` : `The course starts ${t.startsAt}.`] : []),
        ],
        list: { title: ar ? 'قبل الجلسة الأولى:' : 'Before the first session:', items },
        cta: { label: ar ? 'افتح صفحة الدورة' : 'Open your course page', url: t.courseUrl ?? t.url },
        note: ar ? `نراك قريبًا! ${team}` : `See you there! ${team}`,
      });
    }
    case 'AWAITING_PAYMENT':
      return mk(ar ? `تم قبولك في ${c}: أكّد مقعدك` : `You're accepted: ${c}. Confirm your seat`, {
        banner: { text: ar ? 'مبروك، تم قبولك!' : "Congratulations, you're accepted!", tone: 'success' },
        heading: c,
        paragraphs: [
          ar
            ? `قُبل طلبك في ${c}. لتأكيد مقعدك، أكمل الدفع عبر InstaPay أو فودافون كاش وارفع إثبات الدفع من صفحة طلبك.`
            : `Your application to ${c} was accepted. To confirm your seat, pay by InstaPay or Vodafone Cash and upload your proof of payment from your application page.`,
          ar ? 'يُحجز المقعد بعد تحقق الفريق من الدفع، عادةً خلال يومي عمل.' : 'Your seat is confirmed once the team verifies the payment, usually within 2 working days.',
        ],
        cta: { label: ar ? 'ادفع وأكّد مقعدك' : 'Pay and confirm your seat', url: t.url },
      });
    case 'SHORTLISTED':
      return mk(ar ? `أنت ضمن القائمة المختصرة: ${c}` : `You're shortlisted: ${c}`, {
        banner: { text: ar ? 'أخبار سارة: أنت ضمن القائمة المختصرة' : "Good news: you're on the shortlist", tone: 'info' },
        heading: c,
        paragraphs: [
          ar
            ? `لفت طلبك في ${c} انتباه الفريق، وأصبحت ضمن القائمة المختصرة. يعمل فريق الدورة على اختيار الدفعة النهائية، وسنراسلك بالقرار النهائي قريبًا.`
            : `Your application to ${c} stood out, and you're on the shortlist. The course team is finalising the cohort and will email you the final decision soon.`,
          ar ? 'لا تحتاج إلى فعل أي شيء الآن.' : 'There is nothing you need to do for now.',
        ],
        cta: dashboard,
      });
    case 'WAITLISTED':
      return mk(ar ? `أنت على قائمة الانتظار: ${c}` : `You're on the waitlist: ${c}`, {
        banner: { text: ar ? 'أنت على قائمة الانتظار' : "You're on the waitlist", tone: 'neutral' },
        heading: c,
        paragraphs: [
          ar
            ? `شكرًا لتقديمك على ${c}. اكتملت المقاعد حاليًا، لذا أضفناك إلى قائمة الانتظار، وسنراسلك فورًا إذا توفر مقعد.`
            : `Thank you for applying to ${c}. The course is full for now, so you're on the waitlist. We'll email you right away if a seat opens up.`,
        ],
        cta: dashboard,
      });
    case 'REJECTED':
      return mk(ar ? `بخصوص طلبك في ${c}` : `About your application to ${c}`, {
        heading: ar ? 'شكرًا لتقديمك' : 'Thank you for applying',
        paragraphs: [
          ar
            ? `شكرًا لاهتمامك بدورة ${c} وللوقت الذي خصصته لطلبك.`
            : `Thank you for your interest in ${c}, and for the time you put into your application.`,
          ar
            ? 'نأسف لإبلاغك بأننا لا نستطيع منحك مقعدًا في هذه الدفعة. عدد المقاعد محدود، وكان القرار صعبًا.'
            : "We're sorry to tell you that we can't offer you a place in this cohort. Seats are limited, and it wasn't an easy decision.",
        ],
        callout: t.reason ? { title: ar ? 'ملاحظات من فريق الدورة' : 'Feedback from the course team', body: t.reason } : undefined,
        after: [
          ...(t.recordingsPublic
            ? [
                ar
                  ? 'ما زال بإمكانك التعلم معنا: تُنشر تسجيلات جلسات هذه الدورة على YouTube.'
                  : 'You can still learn along: the recordings of this course are published on YouTube.',
              ]
            : []),
          ar ? 'يسعدنا أن تتقدم إلى دفعة قادمة أو دورة أخرى.' : "We'd love to see you apply to a future cohort or another course.",
        ],
        cta: { label: ar ? 'تصفح الدورات' : 'Browse courses', url: t.browseUrl ?? t.url },
        note: team,
      });
    case 'SUBMITTED':
      return mk(ar ? `استلمنا طلبك: ${c}` : `We received your application: ${c}`, {
        heading: c,
        paragraphs: [
          ar
            ? `شكرًا لتقديمك على ${c}. استلمنا طلبك، وسيراجعه فريق الدورة ونراسلك فور اتخاذ القرار.`
            : `Thank you for applying to ${c}. We've received your application; the course team will review it and email you as soon as there's a decision.`,
        ],
        cta: dashboard,
      });
    default: {
      // Payment steps: short, with the payment reason when there is one.
      const paragraphs = [applicationStatusMessages[t.status][locale]];
      if (t.reason) paragraphs.push(ar ? `السبب: ${t.reason}` : `Reason: ${t.reason}`);
      return mk(`${c}: ${applicationStatusLabels[t.status][locale]}`, { heading: c, paragraphs, cta: dashboard });
    }
  }
}

export function buildEmail(t: EmailTemplate, locale: Locale): Built {
  const ar = locale === 'ar';
  const base = { locale, footer: footer[locale] };

  switch (t.name) {
    case 'verifyEmail': {
      const subject = ar ? 'أكّد بريدك الإلكتروني' : 'Confirm your email address';
      return {
        subject,
        element: (
          <Layout
            {...base}
            preview={subject}
            heading={subject}
            paragraphs={[
              ar
                ? 'مرحبًا بك في أكاديمية MLOps MENA. أكّد بريدك الإلكتروني لتتمكن من التقديم على الدورات.'
                : 'Welcome to MLOps MENA Academy. Confirm your email address so you can apply to courses.',
            ]}
            cta={{ label: ar ? 'تأكيد البريد الإلكتروني' : 'Confirm email', url: t.url }}
            note={
              ar
                ? 'ينتهي هذا الرابط خلال 24 ساعة. إذا لم تنشئ حسابًا، تجاهل هذه الرسالة.'
                : "This link expires in 24 hours. If you didn't create an account, ignore this email."
            }
          />
        ),
      };
    }
    case 'confirmNewEmail': {
      const subject = ar ? 'أكّد بريدك الإلكتروني الجديد' : 'Confirm your new email address';
      return {
        subject,
        element: (
          <Layout
            {...base}
            preview={subject}
            heading={subject}
            paragraphs={[
              ar
                ? 'طلبت تغيير البريد الإلكتروني لتسجيل الدخول. أكّد العنوان الجديد لإتمام التغيير.'
                : 'You asked to change your login email. Confirm this new address to complete the change.',
            ]}
            cta={{ label: ar ? 'تأكيد البريد الجديد' : 'Confirm new email', url: t.url }}
            note={
              ar
                ? 'ينتهي هذا الرابط خلال 24 ساعة. إذا لم تطلب هذا التغيير، تجاهل هذه الرسالة.'
                : "This link expires in 24 hours. If you didn't ask for this, ignore this email."
            }
          />
        ),
      };
    }
    case 'resetPassword': {
      const subject = ar ? 'إعادة تعيين كلمة المرور' : 'Reset your password';
      return {
        subject,
        element: (
          <Layout
            {...base}
            preview={subject}
            heading={subject}
            paragraphs={[
              ar
                ? 'تلقينا طلبًا لإعادة تعيين كلمة المرور لحسابك.'
                : 'We received a request to reset the password for your account.',
            ]}
            cta={{ label: ar ? 'تعيين كلمة مرور جديدة' : 'Choose a new password', url: t.url }}
            note={
              ar
                ? 'ينتهي هذا الرابط خلال ساعة واحدة. إذا لم تطلب ذلك، تجاهل هذه الرسالة وستبقى كلمة المرور كما هي.'
                : "This link expires in 1 hour. If you didn't ask for this, ignore this email; your password won't change."
            }
          />
        ),
      };
    }
    case 'applicationStatus':
      return applicationEmail(t, locale, base);
    case 'sessionReminder': {
      const when = ar
        ? t.hoursBefore === 24
          ? 'غدًا'
          : 'خلال ساعة'
        : t.hoursBefore === 24
          ? 'tomorrow'
          : 'in 1 hour';
      const subject = ar
        ? `تذكير: ${t.sessionTitle} ${when}`
        : `Reminder: ${t.sessionTitle} starts ${when}`;
      return {
        subject,
        element: (
          <Layout
            {...base}
            preview={subject}
            heading={t.sessionTitle}
            paragraphs={[t.courseTitle, t.startsAt]}
            cta={{ label: ar ? 'افتح صفحة الدورة' : 'Open course page', url: t.url }}
            note={
              ar
                ? `يظهر رابط الجلسة المباشرة في صفحة الدورة قبل بدايتها. لإيقاف التذكيرات لهذه الدورة: ${t.unsubscribeUrl}`
                : `The live link appears on the course page shortly before the session starts. To stop reminders for this course: ${t.unsubscribeUrl}`
            }
          />
        ),
      };
    }
    case 'eventRegistered': {
      const subject = ar ? `تم تسجيلك: ${t.title}` : `You're registered: ${t.title}`;
      return {
        subject,
        element: (
          <Layout
            {...base}
            preview={subject}
            banner={{ text: ar ? 'تم تسجيلك!' : "You're registered!", tone: 'success' }}
            heading={t.title}
            paragraphs={[
              ar ? `الجلسة المباشرة يوم ${t.when}.` : `The live session is on ${t.when}.`,
              ar
                ? 'يظهر رابط الانضمام في صفحة الجلسة قبل بدايتها بوقت قصير، وسنرسل لك تذكيرًا قبلها بـ 24 ساعة وبساعة واحدة. يمكنك أيضًا إضافتها إلى تقويمك من الصفحة.'
                : "The join link appears on the session page shortly before it starts, and we'll remind you 24 hours and 1 hour before. You can also add it to your calendar from the page.",
              ...(t.calendarUrl
                ? [
                    <Link key="gcal" href={t.calendarUrl} style={{ textDecoration: 'underline' }}>
                      {ar ? 'أضف الجلسة إلى تقويم Google' : 'Add it to Google Calendar'}
                    </Link>,
                  ]
                : []),
            ]}
            cta={{ label: ar ? 'افتح صفحة الجلسة' : 'Open the session page', url: t.url }}
          />
        ),
      };
    }
    case 'eventReminder': {
      const when = ar ? (t.hoursBefore === 24 ? 'غدًا' : 'خلال ساعة') : t.hoursBefore === 24 ? 'tomorrow' : 'in 1 hour';
      const subject = ar ? `تذكير: ${t.title} ${when}` : `Reminder: ${t.title} starts ${when}`;
      return {
        subject,
        element: (
          <Layout
            {...base}
            preview={subject}
            heading={t.title}
            paragraphs={[t.when]}
            cta={{ label: ar ? 'افتح صفحة الجلسة' : 'Open the session page', url: t.url }}
            note={ar ? 'يظهر رابط الانضمام في صفحة الجلسة قبل بدايتها بوقت قصير.' : 'The join link appears on the session page shortly before it starts.'}
          />
        ),
      };
    }
    case 'announcement': {
      const subject = `${t.courseTitle}: ${t.subject}`;
      return {
        subject,
        element: (
          <Layout
            {...base}
            preview={t.subject}
            heading={t.subject}
            paragraphs={t.body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)}
            cta={{ label: ar ? 'افتح صفحة الدورة' : 'Open course page', url: t.url }}
            note={ar ? `أُرسلت هذه الرسالة إلى طلاب ${t.courseTitle}.` : `Sent to students of ${t.courseTitle}.`}
          />
        ),
      };
    }
    case 'profileReview': {
      const subject = ar ? 'هل ملفك الشخصي محدّث؟' : 'Is your profile still up to date?';
      return {
        subject,
        element: (
          <Layout
            {...base}
            preview={subject}
            heading={subject}
            paragraphs={[
              ar
                ? 'مرّت ستة أشهر منذ آخر تحديث لملفك الشخصي. يساعدنا الملف المحدّث على اقتراح الدورات المناسبة لك وتخطيط الدورات القادمة.'
                : "It's been six months since you last updated your profile. An up-to-date profile helps us suggest the right courses and plan future ones.",
            ]}
            cta={{ label: ar ? 'راجع ملفك الشخصي' : 'Review my profile', url: t.url }}
          />
        ),
      };
    }
    case 'accountDeleted': {
      const subject = ar ? 'تم حذف حسابك' : 'Your account has been deleted';
      return {
        subject,
        element: (
          <Layout
            {...base}
            preview={subject}
            heading={subject}
            paragraphs={[
              ar
                ? 'حذفنا حسابك كما طلبت. ستُجهَّل بياناتك الشخصية خلال 30 يومًا. نحتفظ بسجلات الدفع بشكل مجهول الهوية لأغراض محاسبية.'
                : "We've deleted your account as requested. Your personal data will be anonymised within 30 days. Payment records are kept in anonymised form for accounting.",
            ]}
          />
        ),
      };
    }
    case 'securityNotice': {
      const copy = {
        emailChanged: {
          en: ['Your login email was changed', 'The login email for your MLOps MENA Academy account was just changed to a new address. You have been signed out everywhere.'],
          ar: ['تم تغيير بريد تسجيل الدخول', 'تم تغيير بريد تسجيل الدخول لحسابك في أكاديمية MLOps MENA إلى عنوان جديد. تم تسجيل خروجك من جميع الأجهزة.'],
        },
        passwordChanged: {
          en: ['Your password was changed', 'The password for your MLOps MENA Academy account was just changed or set. You have been signed out everywhere.'],
          ar: ['تم تغيير كلمة المرور', 'تم تغيير أو تعيين كلمة المرور لحسابك في أكاديمية MLOps MENA. تم تسجيل خروجك من جميع الأجهزة.'],
        },
      }[t.kind][locale];
      const [subject, body] = copy as [string, string];
      return {
        subject,
        element: (
          <Layout
            {...base}
            preview={subject}
            heading={subject}
            paragraphs={[body]}
            cta={{ label: ar ? 'لم أقم بذلك' : "This wasn't me", url: t.url }}
            note={
              ar
                ? 'إذا قمت بهذا التغيير فلا داعي لأي إجراء. إذا لم تقم به، تواصل معنا فورًا.'
                : "If you made this change, you don't need to do anything. If you didn't, contact us right away."
            }
          />
        ),
      };
    }
    case 'adminAlert': {
      const subject = `[Admin] ${t.message}`;
      return {
        subject,
        element: (
          <Layout
            {...base}
            preview={subject}
            heading={ar ? 'تنبيه للإدارة' : 'Admin alert'}
            paragraphs={[t.message]}
            cta={{ label: ar ? 'فتح' : 'Open', url: t.url }}
          />
        ),
      };
    }
  }
}

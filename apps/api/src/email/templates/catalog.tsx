import { applicationStatusLabels, applicationStatusMessages, type ApplicationStatus, type Locale } from '@academy/shared';
import { Link } from '@react-email/components';
import type { ReactElement } from 'react';
import { Layout } from './Layout';

/** Every email the academy sends, with the data each one needs. */
export type EmailTemplate =
  | { name: 'verifyEmail'; url: string }
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
  /** byTeam: an admin deleted it (the student didn't ask on the site). */
  | { name: 'accountDeleted'; byTeam?: boolean }
  /** "Add student": the team created an account for this address; the link chooses a password. */
  | { name: 'accountCreated'; url: string; days: number }
  /** Sent to the account's (old) address after a sensitive change. */
  | { name: 'securityNotice'; kind: 'emailChanged' | 'passwordChanged'; url: string }
  | { name: 'adminAlert'; message: string; url: string }
  /** Registration confirmation for a free live session. */
  /** Live sessions. calendarUrl/icsUrl point at the public page, never at the join link. */
  | { name: 'eventRegistered'; title: string; when: string; url: string; calendarUrl: string; icsUrl: string }
  | { name: 'eventRescheduled'; title: string; when: string; url: string; calendarUrl: string; icsUrl: string }
  | { name: 'eventCancelled'; title: string; when: string; url: string }
  | { name: 'eventReminder'; title: string; when: string; hoursBefore: 24 | 1; url: string }
  /** Speaker portal: the team's decision on a speaker application. */
  | { name: 'speakerReviewed'; decision: 'APPROVED' | 'REJECTED'; note: string | null; url: string }
  /** Speaker portal: to the speaker after booking a slot. Calendar links never hold a join link. `course`: a course booking. */
  | { name: 'speakerBookingConfirmed'; title: string; when: string; cancelUntil: string; url: string; calendarUrl: string; icsUrl: string; course?: boolean }
  /** Speaker portal: to the speaker when the team publishes their booked session. `url` is its public page. */
  | { name: 'speakerSessionPublished'; title: string; when: string; url: string; calendarUrl: string; icsUrl: string }
  /** Speaker portal: to every address in the sessionTeamEmails setting. */
  | {
      name: 'speakerBookingTeam';
      kind: 'booked' | 'cancelled';
      /** What the booking became: a draft session (sessions, podcasts) or a draft course. */
      draft?: 'session' | 'course';
      /** Cancelled: the course was already published (its status), so it was kept. */
      courseKept?: string | null;
      speakerName: string;
      speakerEmail: string;
      title: string;
      abstract: string;
      when: string;
      url: string;
    }
  /**
   * Sent by an admin to a course's students, or by a speaker to an assigned course's students
   * or to their live session's registrants (`session`). `from` is the speaker's name.
   */
  | { name: 'announcement'; courseTitle: string; subject: string; body: string; url: string; from?: string | null; session?: boolean }
  /** Waiting list ("Notify me"): may go to people without an account, so every one has a leave link. */
  | { name: 'waitlistJoined'; courseTitle: string; courseUrl: string; leaveUrl: string }
  | { name: 'waitlistOpen'; courseTitle: string; subject: string; body: string; url: string; leaveUrl: string }
  /** Assessments: a lab or assignment was graded (the feedback stays on the site). */
  | { name: 'assessmentGraded'; courseTitle: string; title: string; score: number; maxScore: number; url: string }
  /** 24 hours before an assessment is due, to students who haven't submitted. */
  | { name: 'assessmentDue'; courseTitle: string; title: string; dueAt: string; url: string; unsubscribeUrl: string }
  /** Points and badges: a badge was awarded (automatically or by the team). */
  | { name: 'badgeAwarded'; icon: string; badgeName: string; description: string; courseTitle: string | null; url: string }
  /** Enrol by email: an admin enrolled this account directly (no application, no payment). */
  | {
      name: 'courseAdded';
      courseTitle: string;
      courseUrl: string;
      /** First session, already formatted in the student's time zone. */
      startsAt?: string | null;
      hasPreparation?: boolean;
      /** Set when the profile isn't complete yet: a gentle nudge, never a requirement. */
      profileUrl?: string | null;
    }
  /** Enrol by email: an address without a (verified) account. It may belong to someone with no account, so the footer says why. */
  | {
      name: 'courseInvite';
      courseTitle: string;
      email: string;
      /** Sign-up (no account yet) or sign-in (an account that hasn't confirmed its email). */
      url: string;
      hasAccount: boolean;
      courseUrl: string;
    }
  /** Certificates: issued (or re-issued) by the course team. Links to the public page, the PDF and LinkedIn. */
  | { name: 'certificateIssued'; courseTitle: string; serial: string; verifyUrl: string; downloadUrl: string; linkedInUrl: string };

type Built = { subject: string; element: ReactElement };

/** "Add to Google Calendar · Download the calendar file (.ics)". */
function calendarLinks(t: { calendarUrl: string; icsUrl: string }, ar: boolean): ReactElement {
  return (
    <>
      <Link href={t.calendarUrl} style={{ textDecoration: 'underline' }}>
        {ar ? 'أضف إلى تقويم Google' : 'Add to Google Calendar'}
      </Link>
      {' · '}
      <Link href={t.icsUrl} style={{ textDecoration: 'underline' }}>
        {ar ? 'نزّل ملف التقويم (ics)' : 'Download the calendar file (.ics)'}
      </Link>
    </>
  );
}

const footer: Record<Locale, string> = {
  en: 'MLOps MENA Academy · academy.mlopsmena.com. You are receiving this because you have an account with us.',
  ar: 'أكاديمية MLOps MENA · academy.mlopsmena.com. وصلتك هذه الرسالة لأن لديك حسابًا لدينا.',
};

/** Waiting-list emails: why you got this, and how to stop. */
function waitlistFooter(courseTitle: string, leaveUrl: string, ar: boolean): string {
  return ar
    ? `أكاديمية MLOps MENA · وصلتك هذه الرسالة لأنك انضممت إلى قائمة الانتظار لدورة ${courseTitle}. لمغادرة القائمة: ${leaveUrl}`
    : `MLOps MENA Academy · You're receiving this because you joined the waiting list for ${courseTitle}. To leave the list: ${leaveUrl}`;
}

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
                ? 'سنرسل إليك تذكيرًا قبلها بـ 24 ساعة وبساعة واحدة. يظهر رابط الانضمام في صفحة الجلسة قبل بدايتها بوقت قصير.'
                : "We'll remind you 24 hours and 1 hour before. The join link appears on the session page shortly before it starts.",
              calendarLinks(t, ar),
            ]}
            cta={{ label: ar ? 'افتح صفحة الجلسة' : 'Open the session page', url: t.url }}
          />
        ),
      };
    }
    case 'eventRescheduled': {
      const subject = ar ? `موعد جديد: ${t.title}` : `New time: ${t.title}`;
      return {
        subject,
        element: (
          <Layout
            {...base}
            preview={subject}
            banner={{ text: ar ? 'تغيّر موعد الجلسة' : 'The session has moved', tone: 'info' }}
            heading={t.title}
            paragraphs={[
              ar ? `الموعد الجديد: ${t.when}.` : `The new time is ${t.when}.`,
              ar
                ? 'ما زلت مسجّلًا، ولا تحتاج إلى فعل أي شيء. إذا أضفت الجلسة إلى تقويمك، فاحذف الموعد القديم وأضف الجديد:'
                : "You're still registered and don't need to do anything. If you added the session to your calendar, remove the old entry and add the new one:",
              calendarLinks(t, ar),
              ar
                ? 'سنرسل إليك تذكيرًا قبل الموعد الجديد بـ 24 ساعة وبساعة واحدة.'
                : "We'll remind you 24 hours and 1 hour before the new time.",
            ]}
            cta={{ label: ar ? 'افتح صفحة الجلسة' : 'Open the session page', url: t.url }}
          />
        ),
      };
    }
    case 'eventCancelled': {
      const subject = ar ? `أُلغيت الجلسة: ${t.title}` : `Cancelled: ${t.title}`;
      return {
        subject,
        element: (
          <Layout
            {...base}
            preview={subject}
            banner={{ text: ar ? 'أُلغيت الجلسة' : 'This session is cancelled', tone: 'neutral' }}
            heading={t.title}
            paragraphs={[
              ar ? `نأسف لإبلاغك بإلغاء الجلسة التي كانت مقررة يوم ${t.when}.` : `We're sorry: the session planned for ${t.when} is cancelled.`,
              ar
                ? 'إذا أضفتها إلى تقويمك، يمكنك حذفها. نتمنى أن نراك في جلسة قادمة.'
                : 'If you added it to your calendar, you can remove it. We hope to see you at another session soon.',
            ]}
            cta={{ label: ar ? 'تصفّح الجلسات القادمة' : 'See upcoming sessions', url: t.url }}
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
    case 'speakerReviewed': {
      const approved = t.decision === 'APPROVED';
      const subject = approved
        ? ar
          ? 'تمت الموافقة على طلبك للتحدث'
          : "You're approved to speak at MLOps MENA"
        : ar
          ? 'بخصوص طلبك للتحدث'
          : 'About your speaker application';
      return {
        subject,
        element: (
          <Layout
            {...base}
            preview={subject}
            banner={approved ? { text: ar ? 'أهلًا بك متحدثًا!' : 'Welcome aboard!', tone: 'success' } : undefined}
            heading={subject}
            paragraphs={[
              approved
                ? ar
                  ? 'راجع فريق الجلسات طلبك ووافق عليه. يمكنك الآن اختيار موعد متاح وحجزه من صفحة المتحدث.'
                  : 'The sessions team reviewed your application and approved it. You can now pick an open slot and book it from your speaker page.'
                : ar
                  ? 'شكرًا لاهتمامك بالتحدث في مجتمع MLOps MENA. لم نتمكن من قبول طلبك هذه المرة.'
                  : "Thank you for offering to speak at MLOps MENA. We can't accept your application this time.",
              ...(!approved
                ? [ar ? 'يمكنك تعديل طلبك وإرساله مرة أخرى من صفحة المتحدث.' : 'You can update your application and send it again from your speaker page.']
                : []),
            ]}
            callout={t.note ? { title: ar ? 'ملاحظة من الفريق' : 'A note from the team', body: t.note } : undefined}
            cta={{ label: ar ? 'افتح صفحة المتحدث' : 'Open your speaker page', url: t.url }}
          />
        ),
      };
    }
    case 'speakerBookingConfirmed': {
      const subject = t.course
        ? ar
          ? `تم حجز دورتك: ${t.title}`
          : `Your course is booked: ${t.title}`
        : ar
          ? `تم حجز موعدك: ${t.title}`
          : `Your session is booked: ${t.title}`;
      return {
        subject,
        element: (
          <Layout
            {...base}
            preview={subject}
            banner={{ text: ar ? 'تم الحجز!' : "You're booked!", tone: 'success' }}
            heading={t.title}
            paragraphs={[
              t.course ? (ar ? `تبدأ دورتك يوم ${t.when}.` : `Your course starts on ${t.when}.`) : ar ? `موعد جلستك: ${t.when}.` : `Your session is on ${t.when}.`,
              t.course
                ? ar
                  ? 'مسودة دورتك الآن لدى الفريق: سيكملون صفحة الدورة معك وينشرونها. يمكنك إلغاء الحجز من صفحة المتحدث حتى ' + t.cancelUntil + '.'
                  : `Your course draft is now with the team: they'll finish the course page with you and publish it. You can cancel from your speaker page until ${t.cancelUntil}.`
                : ar
                  ? 'سيتواصل معك فريق الجلسات لتجهيز الجلسة ونشرها. يمكنك إلغاء الحجز من صفحة المتحدث حتى ' + t.cancelUntil + '.'
                  : `The sessions team will be in touch to prepare and publish it. You can cancel from your speaker page until ${t.cancelUntil}.`,
              calendarLinks(t, ar),
            ]}
            cta={{ label: ar ? 'افتح صفحة المتحدث' : 'Open your speaker page', url: t.url }}
          />
        ),
      };
    }
    case 'speakerSessionPublished': {
      const subject = ar ? `جلستك منشورة الآن: ${t.title}` : `Your session is live on the site: ${t.title}`;
      return {
        subject,
        element: (
          <Layout
            {...base}
            preview={subject}
            banner={{ text: ar ? 'جلستك منشورة!' : 'Your session is published!', tone: 'success' }}
            heading={t.title}
            paragraphs={[
              ar
                ? `نشر الفريق جلستك، وأصبحت في صفحة الجلسات العامة. موعدها: ${t.when}.`
                : `The team published your session: it's now on the public sessions page. It's on ${t.when}.`,
              ar
                ? 'شارك الرابط مع شبكتك ليسجّل الناس. يحصل المسجّلون على رابط الانضمام قبل البداية بوقت قصير.'
                : 'Share the link with your network so people can register. Registered people get the join link shortly before it starts.',
              calendarLinks(t, ar),
            ]}
            cta={{ label: ar ? 'افتح صفحة الجلسة' : 'Open the session page', url: t.url }}
          />
        ),
      };
    }
    case 'speakerBookingTeam': {
      const booked = t.kind === 'booked';
      const course = t.draft === 'course';
      const subject = booked ? `New speaker booking: ${t.title}` : `Speaker cancelled: ${t.title}`;
      return {
        subject,
        element: (
          <Layout
            {...base}
            preview={subject}
            heading={subject}
            paragraphs={[
              `${t.speakerName} (${t.speakerEmail})`,
              t.when,
              booked
                ? course
                  ? 'A draft course was created from the booking, with the speaker as its instructor. Add the Arabic texts and check the details, then publish it (Status: Open or Coming soon).'
                  : 'A draft session was created. Add the Meet link, the Arabic title and a cover, then press Publish.'
                : t.courseKept
                  ? `The slot is open again. The course was kept as it is (status: ${t.courseKept}) because it is already published or has students: decide what happens to it in Courses.`
                  : course
                    ? 'The slot is open again and the draft course was deleted.'
                    : 'The slot is open again and the draft session was cancelled.',
            ]}
            callout={booked ? { title: 'Abstract', body: t.abstract } : undefined}
            cta={{ label: booked ? (course ? 'Open the draft course' : 'Open the draft session') : t.courseKept ? 'Open the course' : 'Open availability', url: t.url }}
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
            banner={t.from ? { text: ar ? `من ${t.from}` : `From ${t.from}`, tone: 'neutral' } : undefined}
            paragraphs={t.body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)}
            cta={
              t.session
                ? { label: ar ? 'افتح صفحة الجلسة' : 'Open session page', url: t.url }
                : { label: ar ? 'افتح صفحة الدورة' : 'Open course page', url: t.url }
            }
            note={
              t.session
                ? ar
                  ? `أُرسلت هذه الرسالة إلى المسجلين في ${t.courseTitle}.`
                  : `Sent to people registered for ${t.courseTitle}.`
                : ar
                  ? `أُرسلت هذه الرسالة إلى طلاب ${t.courseTitle}.`
                  : `Sent to students of ${t.courseTitle}.`
            }
          />
        ),
      };
    }
    case 'waitlistJoined': {
      const subject = ar ? `أنت في قائمة الانتظار: ${t.courseTitle}` : `You're on the waiting list: ${t.courseTitle}`;
      return {
        subject,
        element: (
          <Layout
            locale={locale}
            footer={waitlistFooter(t.courseTitle, t.leaveUrl, ar)}
            preview={subject}
            heading={ar ? 'أنت في قائمة الانتظار' : "You're on the waiting list"}
            paragraphs={[
              ar
                ? `سنراسلك مرة واحدة عند فتح باب التسجيل في ${t.courseTitle}. لن نستخدم بريدك لأي شيء آخر.`
                : `We'll email you once when ${t.courseTitle} opens for applications. We won't use your email for anything else.`,
            ]}
            cta={{ label: ar ? 'صفحة الدورة' : 'View the course', url: t.courseUrl }}
            note={ar ? `غيّرت رأيك؟ غادر القائمة: ${t.leaveUrl}` : `Changed your mind? Leave the list: ${t.leaveUrl}`}
          />
        ),
      };
    }
    case 'waitlistOpen': {
      const subject = `${t.courseTitle}: ${t.subject}`;
      return {
        subject,
        element: (
          <Layout
            locale={locale}
            footer={waitlistFooter(t.courseTitle, t.leaveUrl, ar)}
            preview={t.subject}
            heading={t.subject}
            paragraphs={t.body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)}
            cta={{ label: ar ? 'افتح صفحة الدورة' : 'Open course page', url: t.url }}
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
              t.byTeam
                ? ar
                  ? 'حذف فريق الأكاديمية حسابك. ستُجهَّل بياناتك الشخصية خلال 30 يومًا. نحتفظ بسجلات الدفع بشكل مجهول الهوية لأغراض محاسبية. إذا لم تطلب ذلك، فراسلنا بالرد على هذه الرسالة.'
                  : 'The academy team deleted your account. Your personal data will be anonymised within 30 days. Payment records are kept in anonymised form for accounting. If you did not ask for this, reply to this email.'
                : ar
                  ? 'حذفنا حسابك كما طلبت. ستُجهَّل بياناتك الشخصية خلال 30 يومًا. نحتفظ بسجلات الدفع بشكل مجهول الهوية لأغراض محاسبية.'
                  : "We've deleted your account as requested. Your personal data will be anonymised within 30 days. Payment records are kept in anonymised form for accounting.",
            ]}
          />
        ),
      };
    }
    case 'accountCreated': {
      const subject = ar ? 'أنشأنا لك حسابًا في أكاديمية MLOps MENA' : 'Your MLOps MENA Academy account is ready';
      return {
        subject,
        element: (
          <Layout
            {...base}
            preview={subject}
            heading={subject}
            paragraphs={[
              ar
                ? 'أنشأ فريق أكاديمية MLOps MENA حسابًا لك بعنوان بريدك هذا. اختر كلمة المرور الخاصة بك للدخول، ثم أكمل ملفك الشخصي. لا أحد غيرك يعرف كلمة المرور أو يضعها.'
                : 'The MLOps MENA Academy team created an account for you with this email address. Choose your own password to sign in, then complete your profile. Nobody else sets or knows your password.',
              ar ? 'يمكنك أيضًا الدخول بحساب Google بالعنوان نفسه.' : 'You can also sign in with Google using this same address.',
            ]}
            cta={{ label: ar ? 'اختر كلمة المرور' : 'Choose your password', url: t.url }}
            note={
              ar
                ? `ينتهي هذا الرابط خلال ${t.days} أيام؛ بعدها استخدم "نسيت كلمة المرور". إذا لم تكن تتوقع هذه الرسالة، تجاهلها أو احذف الحساب من ملفك الشخصي.`
                : `This link expires in ${t.days} days; after that, use "Forgot password". If you didn't expect this, ignore it, or delete the account from your profile.`
            }
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
                ? t.kind === 'passwordChanged'
                  ? 'إذا قمت بهذا التغيير فلا داعي لأي إجراء. إذا لم تقم به، أعد تعيين كلمة المرور فورًا من الزر أعلاه.'
                  : 'إذا قمت بهذا التغيير فلا داعي لأي إجراء. إذا لم تقم به، تواصل معنا فورًا.'
                : t.kind === 'passwordChanged'
                  ? "If you made this change, you don't need to do anything. If you didn't, reset your password right away with the button above."
                  : "If you made this change, you don't need to do anything. If you didn't, contact us right away."
            }
          />
        ),
      };
    }
    case 'assessmentGraded': {
      const subject = ar ? `تم تقييم ${t.title}` : `Graded: ${t.title}`;
      return {
        subject,
        element: (
          <Layout
            {...base}
            preview={subject}
            banner={{ text: ar ? `درجتك: ${t.score} من ${t.maxScore}` : `Your score: ${t.score}/${t.maxScore}`, tone: 'info' }}
            heading={t.title}
            paragraphs={[
              ar
                ? `قيّم فريق ${t.courseTitle} عملك. افتح الصفحة لقراءة الملاحظات.`
                : `The ${t.courseTitle} team has graded your work. Open it to read their feedback.`,
            ]}
            cta={{ label: ar ? 'اقرأ الملاحظات' : 'Read the feedback', url: t.url }}
          />
        ),
      };
    }
    case 'courseAdded': {
      const c = t.courseTitle;
      const subject = ar ? `تمت إضافتك إلى ${c}` : `You've been added to ${c}`;
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
      return {
        subject,
        element: (
          <Layout
            {...base}
            preview={subject}
            banner={{ text: ar ? 'أنت مسجّل في الدورة!' : "You're enrolled!", tone: 'success' }}
            heading={c}
            paragraphs={[
              ar
                ? `أضافك فريق أكاديمية MLOps MENA إلى ${c}. لا تحتاج إلى التقديم أو الدفع: أنت مسجّل الآن.`
                : `The MLOps MENA Academy team has added you to ${c}. There's no application or payment to do: you're enrolled.`,
              ...(t.startsAt ? [ar ? `تبدأ الدورة ${t.startsAt}.` : `The course starts ${t.startsAt}.`] : []),
            ]}
            list={{ title: ar ? 'قبل الجلسة الأولى:' : 'Before the first session:', items }}
            after={
              t.profileUrl
                ? [
                    ar
                      ? `ساعدنا على التعرف إليك: أكمل ملفك الشخصي في دقيقتين (اختياري، ولا يمنعك من حضور الدورة): ${t.profileUrl}`
                      : `Help the course team get to know you: complete your profile in two minutes (optional, and it never blocks the course): ${t.profileUrl}`,
                  ]
                : []
            }
            cta={{ label: ar ? 'افتح صفحة الدورة' : 'Open your course page', url: t.courseUrl }}
          />
        ),
      };
    }
    case 'courseInvite': {
      const c = t.courseTitle;
      const subject = ar ? `تمت إضافتك إلى ${c}` : `You've been added to ${c}`;
      return {
        subject,
        element: (
          <Layout
            locale={locale}
            footer={
              ar
                ? `أكاديمية MLOps MENA · وصلتك هذه الرسالة لأن فريق الأكاديمية أضاف هذا العنوان إلى ${c}. إن لم تكن مهتمًا، تجاهلها: نحذف الدعوات غير المستخدمة بعد 180 يومًا.`
                : `MLOps MENA Academy · You're receiving this because the academy team added this address to ${c}. Not interested? Ignore it: unused invitations are deleted after 180 days.`
            }
            preview={subject}
            banner={{ text: ar ? 'لديك مقعد محجوز' : 'A seat is waiting for you', tone: 'success' }}
            heading={c}
            paragraphs={[
              ar
                ? `أضافك فريق أكاديمية MLOps MENA إلى ${c}. لا تحتاج إلى التقديم أو الدفع.`
                : `The MLOps MENA Academy team has added you to ${c}. There's no application or payment to do.`,
              t.hasAccount
                ? ar
                  ? 'لديك حساب بهذا العنوان، لكن لم يُؤكَّد بريده بعد. سجّل الدخول وأكّد بريدك الإلكتروني، وسنسجّلك في الدورة فورًا.'
                  : "You have an account with this address, but its email isn't confirmed yet. Sign in and confirm your email, and you'll be enrolled right away."
                : ar
                  ? 'أنشئ حسابك المجاني وأكّد بريدك الإلكتروني (أو سجّل الدخول باستخدام Google)، وسنسجّلك في الدورة تلقائيًا.'
                  : "Create your free account and confirm your email (or sign in with Google), and you'll be enrolled automatically.",
            ]}
            callout={{
              title: ar ? 'استخدم هذا العنوان نفسه' : 'Use this same email address',
              body: ar
                ? `المقعد مرتبط بالعنوان ${t.email}. إذا سجّلت بعنوان آخر فلن نتمكن من ربطه بالدورة.`
                : `Your seat is tied to ${t.email}. If you sign up with a different address, we can't match it to the course.`,
            }}
            cta={{ label: t.hasAccount ? (ar ? 'سجّل الدخول' : 'Sign in') : ar ? 'أنشئ حسابك' : 'Create your account', url: t.url }}
            note={ar ? `عن الدورة: ${t.courseUrl}` : `About the course: ${t.courseUrl}`}
          />
        ),
      };
    }
    case 'certificateIssued': {
      const subject = ar ? `شهادتك في ${t.courseTitle} جاهزة` : `Your ${t.courseTitle} certificate is ready`;
      return {
        subject,
        element: (
          <Layout
            {...base}
            preview={subject}
            banner={{ text: ar ? 'مبروك!' : 'Congratulations!', tone: 'success' }}
            heading={subject}
            paragraphs={[
              ar
                ? `أصدر فريق الدورة شهادة إتمامك لدورة ${t.courseTitle}. رقمها التسلسلي ${t.serial}، ويمكن لأي شخص التحقق منها عبر الرابط العام.`
                : `The course team has issued your certificate of completion for ${t.courseTitle}. Its serial number is ${t.serial}, and anyone can verify it at its public link.`,
              <>
                <Link href={t.downloadUrl} style={{ textDecoration: 'underline' }}>
                  {ar ? 'نزّل الشهادة (PDF)' : 'Download the PDF'}
                </Link>
                {' · '}
                <Link href={t.linkedInUrl} style={{ textDecoration: 'underline' }}>
                  {ar ? 'أضفها إلى LinkedIn' : 'Add it to LinkedIn'}
                </Link>
              </>,
            ]}
            cta={{ label: ar ? 'اعرض الشهادة' : 'View your certificate', url: t.verifyUrl }}
          />
        ),
      };
    }
    case 'assessmentDue': {
      const subject = ar ? `موعد التسليم غدًا: ${t.title}` : `Due in 24 hours: ${t.title}`;
      return {
        subject,
        element: (
          <Layout
            {...base}
            preview={subject}
            heading={t.title}
            paragraphs={[
              ar ? `موعد تسليم «${t.title}» في ${t.courseTitle} هو ${t.dueAt}.` : `"${t.title}" in ${t.courseTitle} is due ${t.dueAt}.`,
              ar ? 'لم تسلّمه بعد. سلّمه قبل الموعد ليُحتسب في وقته.' : "You haven't submitted it yet. Hand it in before then so it counts as on time.",
            ]}
            cta={{ label: ar ? 'افتح التقييم' : 'Open the assessment', url: t.url }}
            note={ar ? `لإيقاف تذكيرات هذه الدورة: ${t.unsubscribeUrl}` : `To stop reminders for this course: ${t.unsubscribeUrl}`}
          />
        ),
      };
    }
    case 'badgeAwarded': {
      const subject = ar ? `شارة جديدة: ${t.badgeName}` : `You earned a badge: ${t.badgeName}`;
      return {
        subject,
        element: (
          <Layout
            {...base}
            preview={subject}
            heading={`${t.icon} ${t.badgeName}`}
            paragraphs={[
              t.description,
              t.courseTitle
                ? ar
                  ? `في ${t.courseTitle}. أحسنت!`
                  : `In ${t.courseTitle}. Well done!`
                : ar
                  ? 'أحسنت!'
                  : 'Well done!',
            ].filter(Boolean)}
            cta={{ label: ar ? 'شاهد نقاطك وشاراتك' : 'See your points and badges', url: t.url }}
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

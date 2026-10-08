import { applicationStatusLabels, applicationStatusMessages, type ApplicationStatus, type Locale } from '@academy/shared';
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
      reason?: string | null;
      url: string;
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
  | { name: 'adminAlert'; message: string; url: string };

type Built = { subject: string; element: ReactElement };

const footer: Record<Locale, string> = {
  en: 'MLOps MENA Academy · academy.mlopsmena.com. You are receiving this because you have an account with us.',
  ar: 'أكاديمية MLOps MENA · academy.mlopsmena.com. وصلتك هذه الرسالة لأن لديك حسابًا لدينا.',
};

function statusCopy(status: ApplicationStatus, locale: Locale, reason?: string | null): string[] {
  const lines = [applicationStatusMessages[status][locale]];
  if (reason) lines.push(locale === 'ar' ? `السبب: ${reason}` : `Reason: ${reason}`);
  return lines;
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
    case 'applicationStatus': {
      const statusLabel = applicationStatusLabels[t.status][locale];
      const subject = ar ? `${t.courseTitle}: ${statusLabel}` : `${t.courseTitle}: ${statusLabel}`;
      return {
        subject,
        element: (
          <Layout
            {...base}
            preview={subject}
            heading={t.courseTitle}
            paragraphs={statusCopy(t.status, locale, t.reason)}
            cta={{ label: ar ? 'افتح لوحة التحكم' : 'Open your dashboard', url: t.url }}
          />
        ),
      };
    }
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

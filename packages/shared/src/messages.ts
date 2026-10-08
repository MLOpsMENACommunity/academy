import type { ApplicationStatus } from './enums';
import type { Localized } from './labels';

/** What each status means for the student; used in emails and in-app notifications. */
export const applicationStatusMessages: Record<ApplicationStatus, Localized> = {
  SUBMITTED: {
    en: "We've received your application. We'll email you as soon as it has been reviewed.",
    ar: 'استلمنا طلبك. سنراسلك فور الانتهاء من مراجعته.',
  },
  SHORTLISTED: {
    en: "Good news: you've been shortlisted. We'll confirm your place shortly.",
    ar: 'أخبار سارة: أنت ضمن القائمة المختصرة. سنؤكد مقعدك قريبًا.',
  },
  AWAITING_PAYMENT: {
    en: "You've been accepted. To confirm your seat, complete the payment and upload your proof of payment from your dashboard.",
    ar: 'تم قبولك. لتأكيد مقعدك، أكمل الدفع وارفع إثبات الدفع من لوحة التحكم.',
  },
  PAYMENT_SUBMITTED: {
    en: "We've received your payment proof. An admin will verify it, usually within 2 working days.",
    ar: 'استلمنا إثبات الدفع. سيتحقق منه أحد المسؤولين عادةً خلال يومي عمل.',
  },
  PAYMENT_REJECTED: {
    en: "We couldn't verify your payment, so it wasn't accepted. You can submit a new proof of payment from your dashboard.",
    ar: 'لم نتمكن من التحقق من عملية الدفع، لذا لم يتم قبولها. يمكنك إرسال إثبات دفع جديد من لوحة التحكم.',
  },
  ENROLLED: {
    en: "You're enrolled. Session links, the schedule and calendar invites are on your course page.",
    ar: 'تم تسجيلك. روابط الجلسات والجدول ودعوات التقويم موجودة في صفحة الدورة.',
  },
  REJECTED: {
    en: "Thank you for applying. Unfortunately we can't offer you a place in this cohort. We hope to see you in a future course.",
    ar: 'شكرًا لتقديمك. للأسف لا يمكننا منحك مقعدًا في هذه المجموعة، ونأمل أن نراك في دورة قادمة.',
  },
  WAITLISTED: {
    en: "The course is currently full, so you've been placed on the waitlist. We'll email you if a seat opens up.",
    ar: 'الدورة مكتملة حاليًا، لذا تمت إضافتك إلى قائمة الانتظار. سنراسلك إذا توفر مقعد.',
  },
};

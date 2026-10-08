import type { Locale } from '@academy/shared';

/**
 * [PLACEHOLDER] Policy text pending legal review. It describes what the
 * platform actually does today so the review starts from facts, but it is not
 * legal advice and must be reviewed before launch.
 */

export const POLICY_SLUGS = ['privacy', 'terms', 'refund-policy', 'code-of-conduct', 'contact'] as const;
export type PolicySlug = (typeof POLICY_SLUGS)[number];

interface Section {
  heading: string;
  body: string[];
}
interface Policy {
  title: string;
  description: string;
  updated: string;
  sections: Section[];
}

export const policies: Record<PolicySlug, Record<Locale, Policy>> = {
  privacy: {
    en: {
      title: 'Privacy Policy',
      description: 'How MLOps MENA Academy collects, uses and protects your personal data.',
      updated: '[PLACEHOLDER] October 2026',
      sections: [
        {
          heading: 'Who we are',
          body: [
            '[PLACEHOLDER] MLOps MENA Academy (academy.mlopsmena.com) is operated by MLOps MENA Community. We process personal data in line with Egypt\'s Personal Data Protection Law (Law No. 151 of 2020).',
          ],
        },
        {
          heading: 'What we collect',
          body: [
            'Account data: your email address, a hashed password (or your Google account identifier if you sign in with Google), and your language preference.',
            'Profile data you choose to give us: name, phone, location, professional background, education, skills, learning goals, links and an optional CV.',
            'Course data: your applications and answers, enrolment, session progress and feedback.',
            'Payment proof for paid courses: method, amount, transaction reference, sender name and phone, payment date and a screenshot.',
          ],
        },
        {
          heading: 'Why we use it',
          body: [
            'To run the courses you apply to: screening applications, verifying payments, giving enrolled students their session links and sending course emails and reminders.',
            'To plan future courses for the community, using aggregated profile data.',
            'Only if you opt in: to share your profile with MLOps MENA hiring partners, and to email you about new courses and events. Both are off by default and you can turn them off at any time.',
          ],
        },
        {
          heading: 'Payment screenshots and CVs',
          body: [
            'Screenshots and CVs are stored in a private storage bucket. Only academy administrators can open them, through links that expire within five minutes, and every view is logged.',
            'Payment screenshots are deleted automatically after 180 days. The payment record itself (amount, reference, method, dates and decision) is kept for accounting.',
          ],
        },
        {
          heading: 'Who we share it with',
          body: [
            'We do not sell your data. We use service providers to operate the academy: email delivery (Resend), private file storage (Cloudflare R2), hosting, and Google (Meet, YouTube and Drive) to deliver sessions and recordings. For paid courses, your Google account email is shared with the course Drive folder so you can access recordings.',
          ],
        },
        {
          heading: 'Your rights',
          body: [
            'You can view and edit your profile at any time, download all your data as a JSON file, and delete your account from your profile page. Deleted accounts are blocked immediately and anonymised after 30 days; payment records are kept in anonymised form for accounting. Encrypted database backups are kept for up to 30 days, so deleted data disappears from them within 30 days after anonymisation.',
            'To exercise any other right, contact academy@mlopsmena.com.',
          ],
        },
        {
          heading: 'Cookies',
          body: [
            'We only use essential cookies: your sign-in session and your language preference. Analytics, if enabled, are cookieless.',
          ],
        },
      ],
    },
    ar: {
      title: 'سياسة الخصوصية',
      description: 'كيف تجمع أكاديمية MLOps MENA بياناتك الشخصية وتستخدمها وتحميها.',
      updated: '[PLACEHOLDER] أكتوبر 2026',
      sections: [
        {
          heading: 'من نحن',
          body: [
            '[PLACEHOLDER] يدير مجتمع MLOps MENA أكاديمية MLOps MENA (academy.mlopsmena.com). نعالج البيانات الشخصية وفقًا لقانون حماية البيانات الشخصية المصري (القانون رقم 151 لسنة 2020).',
          ],
        },
        {
          heading: 'ما الذي نجمعه',
          body: [
            'بيانات الحساب: بريدك الإلكتروني، وكلمة مرور مشفرة (أو معرّف حساب Google إذا سجلت الدخول عبر Google)، ولغتك المفضلة.',
            'بيانات الملف الشخصي التي تختار مشاركتها: الاسم والهاتف والموقع والخلفية المهنية والتعليم والمهارات وأهداف التعلم والروابط وسيرة ذاتية اختيارية.',
            'بيانات الدورات: طلباتك وإجاباتك وتسجيلك وتقدمك في الجلسات وتقييماتك.',
            'إثبات الدفع للدورات المدفوعة: طريقة الدفع والمبلغ والرقم المرجعي للعملية واسم المرسل ورقمه وتاريخ الدفع ولقطة شاشة.',
          ],
        },
        {
          heading: 'لماذا نستخدمها',
          body: [
            'لتشغيل الدورات التي تقدم عليها: مراجعة الطلبات، والتحقق من المدفوعات، وإتاحة روابط الجلسات للطلاب المسجلين، وإرسال رسائل الدورة والتذكيرات.',
            'لتخطيط الدورات المستقبلية للمجتمع باستخدام بيانات مجمّعة.',
            'فقط بموافقتك: مشاركة ملفك مع شركاء التوظيف لدى MLOps MENA، ومراسلتك بشأن الدورات والفعاليات الجديدة. كلاهما غير مفعّل افتراضيًا ويمكنك إيقافه في أي وقت.',
          ],
        },
        {
          heading: 'لقطات الدفع والسير الذاتية',
          body: [
            'تُخزَّن لقطات الشاشة والسير الذاتية في مساحة تخزين خاصة. لا يمكن فتحها إلا لمسؤولي الأكاديمية عبر روابط تنتهي صلاحيتها خلال خمس دقائق، ويُسجَّل كل اطلاع عليها.',
            'تُحذف لقطات الدفع تلقائيًا بعد 180 يومًا، بينما يُحتفظ بسجل الدفع نفسه (المبلغ والرقم المرجعي والطريقة والتواريخ والقرار) لأغراض محاسبية.',
          ],
        },
        {
          heading: 'مع من نشاركها',
          body: [
            'لا نبيع بياناتك. نستعين بمزودي خدمات لتشغيل الأكاديمية: إرسال البريد (Resend)، والتخزين الخاص للملفات (Cloudflare R2)، والاستضافة، وGoogle (Meet وYouTube وDrive) لتقديم الجلسات والتسجيلات. في الدورات المدفوعة، يُشارك بريد حساب Google الخاص بك مع مجلد Drive الخاص بالدورة لتتمكن من الوصول إلى التسجيلات.',
          ],
        },
        {
          heading: 'حقوقك',
          body: [
            'يمكنك عرض ملفك الشخصي وتعديله في أي وقت، وتنزيل جميع بياناتك كملف JSON، وحذف حسابك من صفحة ملفك الشخصي. تُوقف الحسابات المحذوفة فورًا وتُجهَّل بياناتها بعد 30 يومًا، مع الاحتفاظ بسجلات الدفع بشكل مجهول الهوية لأغراض محاسبية. نحتفظ بنسخ احتياطية مشفرة من قاعدة البيانات لمدة أقصاها 30 يومًا، لذا تختفي البيانات المحذوفة منها خلال 30 يومًا بعد التجهيل.',
            'لممارسة أي حق آخر، تواصل معنا عبر academy@mlopsmena.com.',
          ],
        },
        {
          heading: 'ملفات تعريف الارتباط (Cookies)',
          body: [
            'نستخدم ملفات تعريف الارتباط الأساسية فقط: جلسة تسجيل الدخول وتفضيل اللغة. أدوات التحليل، إن فُعّلت، لا تستخدم ملفات تعريف الارتباط.',
          ],
        },
      ],
    },
  },

  terms: {
    en: {
      title: 'Terms of Use',
      description: 'The rules for using MLOps MENA Academy.',
      updated: '[PLACEHOLDER] October 2026',
      sections: [
        {
          heading: 'Your account',
          body: [
            '[PLACEHOLDER] Keep your login details private and give accurate profile information. One account per person.',
          ],
        },
        {
          heading: 'Course content',
          body: [
            '[PLACEHOLDER] Session links, recordings and materials are for your personal use as an enrolled student. Do not share them, re-upload them or give others access to paid content. Sharing paid content may lead to removal from the course without a refund.',
          ],
        },
        {
          heading: 'Applications and acceptance',
          body: [
            '[PLACEHOLDER] Applying does not guarantee a place. Instructors screen applications to shape each cohort and may decline or waitlist an application.',
          ],
        },
        {
          heading: 'Payments',
          body: [
            '[PLACEHOLDER] Paid courses are paid manually by InstaPay or Vodafone Cash. Your seat is confirmed only after an administrator verifies the payment. See the Refund Policy.',
          ],
        },
        {
          heading: 'Conduct',
          body: ['[PLACEHOLDER] Everyone must follow the Code of Conduct in sessions and community spaces.'],
        },
      ],
    },
    ar: {
      title: 'شروط الاستخدام',
      description: 'قواعد استخدام أكاديمية MLOps MENA.',
      updated: '[PLACEHOLDER] أكتوبر 2026',
      sections: [
        {
          heading: 'حسابك',
          body: [
            '[PLACEHOLDER] حافظ على سرية بيانات الدخول وقدّم معلومات صحيحة في ملفك الشخصي. حساب واحد لكل شخص.',
          ],
        },
        {
          heading: 'محتوى الدورات',
          body: [
            '[PLACEHOLDER] روابط الجلسات والتسجيلات والمواد مخصصة لاستخدامك الشخصي كطالب مسجل. لا تشاركها أو تعيد رفعها أو تمنح الآخرين الوصول إلى المحتوى المدفوع. قد تؤدي مشاركة المحتوى المدفوع إلى الإزالة من الدورة دون استرداد.',
          ],
        },
        {
          heading: 'الطلبات والقبول',
          body: [
            '[PLACEHOLDER] التقديم لا يضمن الحصول على مقعد. يراجع المحاضرون الطلبات لتشكيل كل مجموعة، وقد يعتذرون عن قبول طلب أو يضعونه في قائمة الانتظار.',
          ],
        },
        {
          heading: 'المدفوعات',
          body: [
            '[PLACEHOLDER] تُدفع الدورات المدفوعة يدويًا عبر InstaPay أو فودافون كاش. لا يُؤكَّد مقعدك إلا بعد تحقق أحد المسؤولين من الدفع. راجع سياسة الاسترداد.',
          ],
        },
        {
          heading: 'السلوك',
          body: ['[PLACEHOLDER] يلتزم الجميع بقواعد السلوك في الجلسات ومساحات المجتمع.'],
        },
      ],
    },
  },

  'refund-policy': {
    en: {
      title: 'Refund Policy',
      description: 'When and how payments for paid courses can be refunded.',
      updated: '[PLACEHOLDER] October 2026',
      sections: [
        {
          heading: 'Before the course starts',
          body: ['[PLACEHOLDER] Full refund if you withdraw at least 7 days before the first session.'],
        },
        {
          heading: 'After the course starts',
          body: [
            '[PLACEHOLDER] Partial or no refund after the first session, at the academy\'s discretion.',
          ],
        },
        {
          heading: 'If we cancel',
          body: ['[PLACEHOLDER] If the academy cancels a course, you receive a full refund.'],
        },
        {
          heading: 'How refunds are paid',
          body: [
            '[PLACEHOLDER] Refunds are sent back by the same method used to pay (InstaPay or Vodafone Cash) within 14 days. Contact academy@mlopsmena.com to request one.',
          ],
        },
      ],
    },
    ar: {
      title: 'سياسة الاسترداد',
      description: 'متى وكيف يمكن استرداد مدفوعات الدورات المدفوعة.',
      updated: '[PLACEHOLDER] أكتوبر 2026',
      sections: [
        {
          heading: 'قبل بدء الدورة',
          body: ['[PLACEHOLDER] استرداد كامل إذا انسحبت قبل الجلسة الأولى بسبعة أيام على الأقل.'],
        },
        {
          heading: 'بعد بدء الدورة',
          body: ['[PLACEHOLDER] استرداد جزئي أو عدم استرداد بعد الجلسة الأولى، وفقًا لتقدير الأكاديمية.'],
        },
        {
          heading: 'إذا ألغينا الدورة',
          body: ['[PLACEHOLDER] إذا ألغت الأكاديمية دورة، تحصل على استرداد كامل.'],
        },
        {
          heading: 'كيف يُرد المبلغ',
          body: [
            '[PLACEHOLDER] يُرد المبلغ بنفس طريقة الدفع (InstaPay أو فودافون كاش) خلال 14 يومًا. تواصل مع academy@mlopsmena.com لطلب الاسترداد.',
          ],
        },
      ],
    },
  },

  'code-of-conduct': {
    en: {
      title: 'Code of Conduct',
      description: 'How we expect everyone to behave in academy sessions and community spaces.',
      updated: '[PLACEHOLDER] October 2026',
      sections: [
        {
          heading: 'Be respectful',
          body: [
            '[PLACEHOLDER] Treat instructors and fellow students with respect, in both Arabic and English. Harassment, discrimination and personal attacks are not tolerated.',
          ],
        },
        {
          heading: 'Keep sessions useful',
          body: [
            '[PLACEHOLDER] Stay on topic, keep your microphone muted unless speaking, and use the Q&A or chat for questions.',
          ],
        },
        {
          heading: 'Protect others\' privacy',
          body: [
            '[PLACEHOLDER] Do not record, screenshot or share other participants\' personal information without consent.',
          ],
        },
        {
          heading: 'Reporting',
          body: [
            '[PLACEHOLDER] Report any concern to academy@mlopsmena.com. Reports are handled confidentially. Breaking this code can lead to removal from a course or the community.',
          ],
        },
      ],
    },
    ar: {
      title: 'قواعد السلوك',
      description: 'السلوك المتوقع من الجميع في جلسات الأكاديمية ومساحات المجتمع.',
      updated: '[PLACEHOLDER] أكتوبر 2026',
      sections: [
        {
          heading: 'كن محترمًا',
          body: [
            '[PLACEHOLDER] تعامل مع المحاضرين وزملائك باحترام، بالعربية والإنجليزية. لا نتسامح مع التحرش أو التمييز أو الإساءة الشخصية.',
          ],
        },
        {
          heading: 'حافظ على فائدة الجلسات',
          body: [
            '[PLACEHOLDER] التزم بموضوع الجلسة، وأبقِ الميكروفون مغلقًا إلا عند الحديث، واستخدم الأسئلة أو المحادثة لطرح أسئلتك.',
          ],
        },
        {
          heading: 'احمِ خصوصية الآخرين',
          body: [
            '[PLACEHOLDER] لا تسجّل أو تلتقط صورًا أو تشارك معلومات شخصية لمشاركين آخرين دون موافقتهم.',
          ],
        },
        {
          heading: 'الإبلاغ',
          body: [
            '[PLACEHOLDER] أبلغ عن أي مشكلة عبر academy@mlopsmena.com. تُعالج البلاغات بسرية. قد تؤدي مخالفة هذه القواعد إلى الإزالة من الدورة أو المجتمع.',
          ],
        },
      ],
    },
  },

  contact: {
    en: {
      title: 'Contact & support',
      description: 'How to reach the MLOps MENA Academy team.',
      updated: '',
      sections: [
        {
          heading: 'Email',
          body: ['academy@mlopsmena.com. We usually reply within 2 working days.'],
        },
        {
          heading: 'Payments',
          body: [
            'Questions about a payment? Include your course name and transaction reference number. Never send your password or full card details.',
          ],
        },
        {
          heading: 'Community',
          body: ['For general questions, ask in the community Discord or Telegram.'],
        },
      ],
    },
    ar: {
      title: 'التواصل والدعم',
      description: 'كيف تتواصل مع فريق أكاديمية MLOps MENA.',
      updated: '',
      sections: [
        {
          heading: 'البريد الإلكتروني',
          body: ['academy@mlopsmena.com. نرد عادةً خلال يومي عمل.'],
        },
        {
          heading: 'المدفوعات',
          body: [
            'لديك سؤال عن عملية دفع؟ اذكر اسم الدورة والرقم المرجعي للعملية. لا ترسل كلمة المرور أو بيانات البطاقة كاملة أبدًا.',
          ],
        },
        {
          heading: 'المجتمع',
          body: ['للأسئلة العامة، اسأل في Discord أو Telegram الخاص بالمجتمع.'],
        },
      ],
    },
  },
};

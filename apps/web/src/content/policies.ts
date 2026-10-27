import type { Locale } from '@academy/shared';

/**
 * Policy texts. They describe what the platform actually does (retention, storage,
 * recordings, payments). They are launch drafts, not legal advice, so have them
 * reviewed when you can. "{contact}" is replaced on the page by the support email from
 * Admin → Settings, or by a link to the contact page while none is set. Text marked
 * "[PLACEHOLDER]" shows a "pending review" banner, so never ship any.
 */

export const POLICY_SLUGS = ['privacy', 'terms', 'refund-policy', 'code-of-conduct', 'contact'] as const;
export type PolicySlug = (typeof POLICY_SLUGS)[number];

interface Section {
  heading: string;
  body: string[];
  /** Shown only when a support email is set in Admin → Settings. */
  needsEmail?: boolean;
  /** Followed by links to the community channels (Discord, Telegram, LinkedIn, YouTube). */
  communityLinks?: boolean;
}
interface Policy {
  title: string;
  description: string;
  updated: string;
  sections: Section[];
}

const UPDATED_EN = 'Last updated: 10 October 2026';
const UPDATED_AR = 'آخر تحديث: 10 أكتوبر 2026';
/** The privacy policy changed later (course invitations; waiting lists need an account; Telegram and Discord usernames; assessments, attendance and certificates; connected Telegram accounts). */
const PRIVACY_UPDATED_EN = 'Last updated: 27 October 2026';
const PRIVACY_UPDATED_AR = 'آخر تحديث: 27 أكتوبر 2026';
/** The refund policy changed later (consultations). */
const REFUND_UPDATED_EN = 'Last updated: 24 October 2026';
const REFUND_UPDATED_AR = 'آخر تحديث: 24 أكتوبر 2026';

export const policies: Record<PolicySlug, Record<Locale, Policy>> = {
  privacy: {
    en: {
      title: 'Privacy Policy',
      description: 'How MLOps MENA Academy collects, uses and protects your personal data.',
      updated: PRIVACY_UPDATED_EN,
      sections: [
        {
          heading: 'Who we are',
          body: [
            `MLOps MENA Academy (academy.mlopsmena.com) is run by MLOps MENA Community, a volunteer-led community for ML, MLOps and AI practitioners across the Middle East and North Africa. We are responsible for the personal data described here and process it in line with Egypt's Personal Data Protection Law (Law No. 151 of 2020). You can reach us through {contact}.`,
          ],
        },
        {
          heading: 'What we collect',
          body: [
            'Account data: your email address, a hashed password (or your Google account identifier if you sign in with Google), and your language preference.',
            'Profile data you choose to give us: name, phone, country and city, professional background, education, skills, learning goals, links (LinkedIn, GitHub and similar), your Telegram and Discord usernames, and an optional CV.',
            'Your Telegram and Discord usernames are needed to apply to a course: course groups and community help happen there. The academy team uses them to add you to your course\'s groups and to recognise you in the community channels; they are shown to the team only, never on public pages or leaderboards.',
            'If you connect your Telegram account to the academy\'s bot (Profile → Community), we store its Telegram account id and when you connected it, so the bot can let you into the groups of the courses you are enrolled in. You can disconnect it at any time; it is removed when your account is deleted.',
            'Course data: your applications and answers to screening questions (with a copy of your profile as it was when you applied, for the team reviewing it), your enrolment, session progress and the feedback you submit through the academy.',
            'Assessments and attendance: your quiz answers, the links and files you submit for labs and assignments, your scores and the course team\'s feedback, and your attendance in live sessions (minutes and share of each session, from the Google Meet attendance report the team uploads). Uploaded files are deleted after the retention period set by the academy (180 days by default); scores stay with your course record.',
            'Certificates: the name printed on your certificate, the course, the date and the grade. Each certificate has a public verification page at its serial number, showing that name, the course and the date, so employers can check it; it is kept out of search engines. After your account is deleted and anonymised, the page only says the certificate is no longer available.',
            'Payment proof for paid courses: method, amount, transaction reference, sender name and phone, payment date and a screenshot.',
            'Consultations: the expert, time, length, price and status of each call you book, and the note you write for the expert. The payment method, transfer reference and screenshot you upload (seen only by the academy\'s finance team, and deleted after the retention period). The expert sees your name and note, never your email address or payment details. If the expert has connected Google Calendar, the call is added to their calendar with your email address as a guest, so Google sends you the invitation and the Meet link; the academy reads only when the expert is busy, never what is in their calendar.',
            'Waiting lists: if you ask to be told when a course opens ("Notify me"), your account email address and language. Joining needs an academy account; an entry made without one before that is kept, and linked to your account when you confirm the same address.',
            'Course invitations: if the academy team adds you to a course by your email address, that address, the course, who added you and when, and whether you joined. If you have no account yet, we email you to invite you, a few times at most; you are enrolled only after you sign up and confirm that same address.',
            'Accounts the team creates: the academy team can create a student account for your email address (for example after accepting you outside the site). We email you a link to choose your own password; nobody else sets or knows it. You can delete the account from your profile at any time.',
            'Technical data: basic request logs (page or API route, status and timing) used to keep the service secure and working. Our own logs do not contain your email address, IP address or the content you submit. Our hosting provider (Cloudflare) processes IP addresses to deliver and protect the site.',
          ],
        },
        {
          heading: 'Why we use it, and on what basis',
          body: [
            'To run the courses you apply to (screening applications, verifying payments, giving enrolled students their session links, sending course emails and reminders). This is necessary to provide the service you asked for.',
            'To plan future courses for the community, using aggregated and anonymised profile data. This is in our legitimate interest and does not single you out.',
            'Only with your consent: emailing you about new courses and events. It is off by default and you can withdraw consent at any time from your profile.',
            'We no longer ask whether you are open to job opportunities or want your profile shared with MLOps MENA hiring partners. An answer you gave before stays on your record; to withdraw it, write to us through {contact} and the team will clear it.',
          ],
        },
        {
          heading: 'Points, badges and leaderboards',
          body: [
            'The academy keeps a record of the points you earn (from assessment scores, completed sessions, certificates, and community help that the team adds by hand) and the badges you receive. You see all of it on your dashboard and profile; academy administrators can see it too.',
            "Each course has a leaderboard. You only appear on it if you choose \"Show me on the leaderboard\", and you can hide yourself again at any time. When you appear, other students in that course see only your first name, the first letter of your last name, your points and your badges, never your email or full name. If you don't opt in, you are counted in the number of participants but not named, and only you can see where you would rank.",
            'Leaderboard badges (such as "Top of the week") are given to the top students whether or not they opted in. They stay private to you unless you choose to appear on the leaderboard.',
            'Your points, badges and leaderboard choices are included in your data download and are deleted when your account is anonymised after deletion. A deleted account disappears from leaderboards straight away.',
          ],
        },
        {
          heading: 'Live sessions and recordings',
          body: [
            'Live sessions are held on Google Meet and are usually recorded. Recordings of free courses are published on YouTube; recordings of paid courses are shared only with enrolled students. If you speak, turn on your camera or write in the chat during a recorded session, that may appear in the recording. You can take part with your camera and microphone off and ask questions in the chat under any display name.',
          ],
        },
        {
          heading: 'Speakers',
          body: [
            'If you sign up as a speaker, we keep your speaker application (name, phone or WhatsApp, LinkedIn, an optional GitHub link, title and company, country, short bio, an optional photo link, how you heard about us and, if a community member referred you, that member\'s name, topics, whether you propose a session, a course or a podcast and its optional details, format, language and preferred months), the team\'s decision and note, and the slots you book with the title, abstract and details you give.',
            'We use it to review your application, plan and announce your session, and contact you about it. When you book or cancel a slot, the academy\'s session team is emailed your name, email, the time and the session details. When we approve you, we create a public speaker page from your name, title, bio, photo and LinkedIn; you can ask us to change it at any time.',
            'Your application and bookings are included when you download your data. Deleting your account releases your upcoming bookings and, after 30 days, removes your application. Your public speaker page and past sessions stay as part of the community\'s session history unless you ask us to remove them through {contact}.',
          ],
        },
        {
          heading: 'Payment screenshots and CVs',
          body: [
            'Screenshots and CVs are stored in a private storage bucket. Only academy administrators can open them, through links that expire within five minutes, and every view is logged.',
            'Payment screenshots and CVs are deleted automatically after 180 days. The payment record itself (amount, reference, method, dates and decision) is kept for accounting.',
          ],
        },
        {
          heading: 'Who we share it with',
          body: [
            'We do not sell your data. We use service providers to operate the academy: hosting and private file storage (Cloudflare), the database (Neon), email delivery (Resend), error tracking without personal details (Sentry, when enabled), and Google (Meet, YouTube and Drive) to deliver sessions and recordings. Some of these providers process data outside Egypt; we only use providers that protect it with appropriate security and contractual safeguards.',
            "The academy team who screen applications (administrators, who may include course instructors) can see your application and profile. For paid courses, your Google account email is shared with the course's Drive folder so you can access recordings.",
          ],
        },
        {
          heading: 'How long we keep it',
          body: [
            'Your account and profile are kept until you delete your account (an uploaded CV is deleted after 180 days). Applications and enrolments are kept for course records and certificates. Deleted accounts are blocked immediately and anonymised after 30 days; payment records are kept in anonymised form for accounting.',
            'You stay on a waiting list until you leave it (every waiting-list email has a link to leave) or delete your account. We email you about that course only.',
            'A course invitation that is never used is deleted after 180 days, or when you delete your account. Once you join through it, it is kept with your enrolment and deleted when your account is anonymised.',
            'Encrypted database backups are kept for up to 30 days, so deleted data disappears from them within 30 days after anonymisation.',
          ],
        },
        {
          heading: 'Your rights',
          body: [
            'You can view and edit your profile at any time, download all your data as a JSON file, and delete your account from your profile page. You can also ask us to correct, restrict or explain how we process your data.',
            'The academy team (administrators) can also correct or remove details in your profile or speaker application, or delete your account, for example when you ask them to. They never accept the Terms or give a consent for you, and every change is recorded in an internal audit log (who changed what, never the values).',
            `To exercise any right or raise a concern, write to us through {contact}. We respond within the time limits set by law. You may also complain to Egypt's Personal Data Protection Center.`,
          ],
        },
        {
          heading: 'Age',
          body: ['The academy is for adults. You must be at least 18 to use it, and you confirm this when you accept the Terms while completing your profile.'],
        },
        {
          heading: 'Cookies',
          body: [
            'We only use essential cookies: your sign-in session and your language preference. Analytics, if enabled, are cookieless, so we do not show a cookie banner.',
          ],
        },
        {
          heading: 'Changes',
          body: ['If we change this policy in a way that matters, we will tell you by email or on the site before it takes effect.'],
        },
      ],
    },
    ar: {
      title: 'سياسة الخصوصية',
      description: 'كيف تجمع أكاديمية MLOps MENA بياناتك الشخصية وتستخدمها وتحميها.',
      updated: PRIVACY_UPDATED_AR,
      sections: [
        {
          heading: 'من نحن',
          body: [
            `يدير مجتمع MLOps MENA أكاديمية MLOps MENA ‏(academy.mlopsmena.com)، وهو مجتمع تطوعي لممارسي تعلم الآلة وMLOps والذكاء الاصطناعي في منطقة الشرق الأوسط وشمال أفريقيا. نحن المسؤولون عن البيانات الشخصية الموضحة هنا، ونعالجها وفقًا لقانون حماية البيانات الشخصية المصري (القانون رقم 151 لسنة 2020). يمكنك التواصل معنا عبر {contact}.`,
          ],
        },
        {
          heading: 'ما الذي نجمعه',
          body: [
            'بيانات الحساب: بريدك الإلكتروني، وكلمة مرور مشفرة (أو معرّف حساب Google إذا سجلت الدخول عبر Google)، ولغتك المفضلة.',
            'بيانات الملف الشخصي التي تختار مشاركتها: الاسم والهاتف والدولة والمدينة والخلفية المهنية والتعليم والمهارات وأهداف التعلم والروابط (مثل LinkedIn وGitHub) واسما المستخدم على Telegram وDiscord وسيرة ذاتية اختيارية.',
            'نحتاج إلى اسمي المستخدم على Telegram وDiscord للتقديم على أي دورة، لأن مجموعات الدورات ومساعدة المجتمع تتم هناك. يستخدمهما فريق الأكاديمية لإضافتك إلى مجموعات دورتك والتعرف عليك في قنوات المجتمع، ولا يظهران إلا للفريق، ولا يُعرضان أبدًا في الصفحات العامة أو لوحات المتصدرين.',
            'إذا ربطت حسابك على Telegram ببوت الأكاديمية (الملف الشخصي ← المجتمع)، نحفظ معرّف حسابك على Telegram وتاريخ الربط، ليتمكن البوت من إدخالك إلى مجموعات الدورات المسجّل فيها. يمكنك إلغاء الربط في أي وقت، ويُحذف عند حذف حسابك.',
            'بيانات الدورات: طلباتك وإجاباتك على أسئلة القبول (مع نسخة من ملفك الشخصي كما كان وقت التقديم، للفريق الذي يراجع طلبك)، وتسجيلك، وتقدمك في الجلسات، والتقييمات التي ترسلها عبر الأكاديمية.',
            'التقييمات والحضور: إجاباتك في الاختبارات، والروابط والملفات التي ترسلها للمعامل والواجبات، ودرجاتك وملاحظات فريق الدورة، وحضورك في الجلسات المباشرة (الدقائق ونسبة كل جلسة، من تقرير حضور Google Meet الذي يرفعه الفريق). تُحذف الملفات المرفوعة بعد مدة الاحتفاظ التي تحددها الأكاديمية (180 يومًا افتراضيًا)، وتبقى الدرجات ضمن سجل دورتك.',
            'الشهادات: الاسم المطبوع على شهادتك والدورة والتاريخ والتقدير. لكل شهادة صفحة تحقق عامة برقمها التسلسلي تعرض ذلك الاسم والدورة والتاريخ ليتمكن أصحاب العمل من التحقق منها، وهي مستبعدة من محركات البحث. بعد حذف حسابك وتجهيل بياناته، تكتفي الصفحة بالإشارة إلى أن الشهادة لم تعد متاحة.',
            'إثبات الدفع للدورات المدفوعة: طريقة الدفع والمبلغ والرقم المرجعي للعملية واسم المرسل ورقمه وتاريخ الدفع ولقطة شاشة.',
            'الاستشارات: الخبير وموعد كل مكالمة تحجزها ومدتها وسعرها وحالتها، والملاحظة التي تكتبها للخبير. وطريقة الدفع والرقم المرجعي للتحويل وصورة التحويل التي ترفعها (لا يراها إلا فريق المالية بالأكاديمية، وتُحذف بعد مدة الاحتفاظ). يرى الخبير اسمك وملاحظتك فقط، ولا يرى بريدك الإلكتروني ولا بيانات الدفع. إذا ربط الخبير تقويم Google، تُضاف المكالمة إلى تقويمه وبريدك ضيفًا فيها، فيرسل Google إليك الدعوة ورابط Meet؛ ولا تقرأ الأكاديمية من تقويمه إلا أوقات انشغاله، لا محتواه.',
            'قوائم الانتظار: إذا طلبت إبلاغك عند فتح التسجيل في دورة («أبلغني»)، بريد حسابك الإلكتروني ولغتك. الانضمام يحتاج إلى حساب في الأكاديمية؛ وما سُجّل قبل ذلك بدون حساب نحتفظ به، ونربطه بحسابك عندما تؤكد العنوان نفسه.',
            'دعوات الدورات: إذا أضافك فريق الأكاديمية إلى دورة بعنوان بريدك الإلكتروني، نحفظ هذا العنوان والدورة ومن أضافك ومتى، وهل انضممت. إن لم يكن لديك حساب بعد، نراسلك لدعوتك بضع مرات على الأكثر، ولا نسجّلك إلا بعد أن تنشئ حسابًا وتؤكد العنوان نفسه.',
            'الحسابات التي ينشئها الفريق: يمكن لفريق الأكاديمية إنشاء حساب طالب بعنوان بريدك (مثلًا بعد قبولك خارج الموقع). نرسل إليك رابطًا لتختار كلمة مرورك بنفسك، ولا أحد غيرك يضعها أو يعرفها. ويمكنك حذف الحساب من ملفك الشخصي في أي وقت.',
            'بيانات تقنية: سجلات طلبات أساسية (الصفحة أو مسار الواجهة البرمجية، وحالة الطلب، ومدته) لإبقاء الخدمة آمنة وتعمل. لا تتضمن سجلاتنا بريدك الإلكتروني أو عنوان IP أو المحتوى الذي ترسله. ويعالج مزود الاستضافة لدينا (Cloudflare) عناوين IP لتقديم الموقع وحمايته.',
          ],
        },
        {
          heading: 'لماذا نستخدمها وعلى أي أساس',
          body: [
            'لتشغيل الدورات التي تقدم عليها (مراجعة الطلبات، والتحقق من المدفوعات، وإتاحة روابط الجلسات للطلاب المسجلين، وإرسال رسائل الدورة والتذكيرات). وهذا ضروري لتقديم الخدمة التي طلبتها.',
            'لتخطيط الدورات المستقبلية للمجتمع باستخدام بيانات مجمّعة ومجهولة الهوية، وهذا في إطار مصلحتنا المشروعة ولا يحدد هويتك.',
            'فقط بموافقتك: مراسلتك بشأن الدورات والفعاليات الجديدة. هذا غير مفعّل افتراضيًا، ويمكنك سحب موافقتك في أي وقت من ملفك الشخصي.',
            'لم نعد نسأل إن كنت منفتحًا على فرص العمل أو تريد مشاركة ملفك مع شركاء التوظيف لدى MLOps MENA. تبقى إجابتك السابقة محفوظة في سجلك؛ ولسحبها راسلنا عبر {contact} وسيحذفها الفريق.',
          ],
        },
        {
          heading: 'النقاط والشارات ولوحات الصدارة',
          body: [
            'تحتفظ الأكاديمية بسجل للنقاط التي تكسبها (من درجات التقييمات والجلسات المكتملة والشهادات، ومن مساعدة المجتمع التي يضيفها الفريق يدويًا) وبالشارات التي تحصل عليها. تراها كلها في لوحة التحكم وملفك الشخصي، ويمكن لمسؤولي الأكاديمية الاطلاع عليها أيضًا.',
            'لكل دورة لوحة صدارة، ولا تظهر فيها إلا إذا اخترت «أظهرني في لوحة الصدارة»، ويمكنك إخفاء نفسك مرة أخرى في أي وقت. وعند ظهورك لا يرى طلاب الدورة الآخرون إلا اسمك الأول والحرف الأول من اسم العائلة ونقاطك وشاراتك، ولا يرون بريدك الإلكتروني أو اسمك الكامل أبدًا. وإن لم تختر الظهور فإنك تُحتسب ضمن عدد المشاركين دون ذكر اسمك، ولا يرى ترتيبك المحتمل غيرك.',
            'تُمنح شارات لوحة الصدارة (مثل «الأفضل هذا الأسبوع») لأصحاب أعلى النقاط سواء اختاروا الظهور أم لا، وتبقى خاصة بك ما لم تختر الظهور في اللوحة.',
            'تُضمَّن نقاطك وشاراتك واختياراتك للوحات الصدارة في ملف بياناتك عند تنزيله، وتُحذف عند تجهيل بيانات حسابك بعد حذفه. ويختفي الحساب المحذوف من لوحات الصدارة فورًا.',
          ],
        },
        {
          heading: 'الجلسات المباشرة والتسجيلات',
          body: [
            'تُعقد الجلسات المباشرة على Google Meet وتُسجَّل عادةً. تُنشر تسجيلات الدورات المجانية على YouTube، بينما تُتاح تسجيلات الدورات المدفوعة للطلاب المسجلين فقط. إذا تحدثت أو فتحت الكاميرا أو كتبت في المحادثة أثناء جلسة مسجلة، فقد يظهر ذلك في التسجيل. يمكنك المشاركة والكاميرا والميكروفون مغلقان، وطرح أسئلتك في المحادثة بأي اسم عرض تختاره.',
          ],
        },
        {
          heading: 'المتحدثون',
          body: [
            'إذا سجلت متحدثًا، نحتفظ بطلبك (الاسم، والهاتف أو واتساب، وLinkedIn، ورابط GitHub اختياري، والمسمى الوظيفي والشركة، والدولة، ونبذة قصيرة، ورابط صورة اختياري، وكيف عرفت عنا، واسم عضو المجتمع الذي رشّحك إن وُجد، والمجالات، وهل تقترح جلسة أو دورة أو بودكاست وتفاصيله الاختيارية، وشكلها ولغتها، والأشهر المفضلة)، وقرار الفريق وملاحظته، والمواعيد التي تحجزها مع العنوان والملخص والتفاصيل التي تقدمها.',
            'نستخدم هذه البيانات لمراجعة طلبك وتخطيط جلستك والإعلان عنها والتواصل معك بشأنها. عند حجز موعد أو إلغائه، يصل فريقَ الجلسات في الأكاديمية بريدٌ فيه اسمك وبريدك الإلكتروني والموعد وتفاصيل الجلسة. وعند الموافقة على طلبك ننشئ لك صفحة متحدث عامة من اسمك ومسماك الوظيفي ونبذتك وصورتك ورابط LinkedIn، ويمكنك أن تطلب تعديلها في أي وقت.',
            'يُضمَّن طلبك وحجوزاتك عند تنزيل بياناتك. وعند حذف حسابك تُلغى حجوزاتك القادمة، ويُحذف طلبك بعد 30 يومًا. تبقى صفحتك العامة وجلساتك السابقة ضمن سجل جلسات المجتمع ما لم تطلب حذفها عبر {contact}.',
          ],
        },
        {
          heading: 'لقطات الدفع والسير الذاتية',
          body: [
            'تُخزَّن لقطات الشاشة والسير الذاتية في مساحة تخزين خاصة. لا يمكن فتحها إلا لمسؤولي الأكاديمية عبر روابط تنتهي صلاحيتها خلال خمس دقائق، ويُسجَّل كل اطلاع عليها.',
            'تُحذف لقطات الدفع والسير الذاتية تلقائيًا بعد 180 يومًا، بينما يُحتفظ بسجل الدفع نفسه (المبلغ والرقم المرجعي والطريقة والتواريخ والقرار) لأغراض محاسبية.',
          ],
        },
        {
          heading: 'مع من نشاركها',
          body: [
            'لا نبيع بياناتك. نستعين بمزودي خدمات لتشغيل الأكاديمية: الاستضافة والتخزين الخاص للملفات (Cloudflare)، وقاعدة البيانات (Neon)، وإرسال البريد (Resend)، وتتبع الأخطاء دون بيانات شخصية (Sentry، عند تفعيله)، وGoogle ‏(Meet وYouTube وDrive) لتقديم الجلسات والتسجيلات. يعالج بعض هؤلاء المزودين البيانات خارج مصر، ولا نستعين إلا بمزودين يحمونها بضمانات أمنية وتعاقدية مناسبة.',
            'يمكن لفريق الأكاديمية الذي يراجع الطلبات (المسؤولون، وقد يكون من بينهم محاضرو الدورة) الاطلاع على طلبك وملفك الشخصي. وفي الدورات المدفوعة، يُشارك بريد حساب Google الخاص بك مع مجلد Drive الخاص بالدورة لتتمكن من الوصول إلى التسجيلات.',
          ],
        },
        {
          heading: 'مدة الاحتفاظ بالبيانات',
          body: [
            'نحتفظ بحسابك وملفك الشخصي حتى تحذف حسابك (وتُحذف السيرة الذاتية المرفوعة بعد 180 يومًا). ونحتفظ بالطلبات والتسجيلات لسجلات الدورات والشهادات. تُوقف الحسابات المحذوفة فورًا وتُجهَّل بياناتها بعد 30 يومًا، مع الاحتفاظ بسجلات الدفع بشكل مجهول الهوية لأغراض محاسبية.',
            'تبقى في قائمة الانتظار حتى تغادرها (كل رسالة من قائمة الانتظار فيها رابط للمغادرة) أو تحذف حسابك. ولا نراسلك إلا بخصوص تلك الدورة.',
            'تُحذف دعوة الدورة التي لا تُستخدم بعد 180 يومًا أو عند حذف حسابك. وإذا انضممت من خلالها، تُحفظ مع تسجيلك وتُحذف عند تجهيل بيانات حسابك.',
            'نحتفظ بنسخ احتياطية مشفرة من قاعدة البيانات لمدة أقصاها 30 يومًا، لذا تختفي البيانات المحذوفة منها خلال 30 يومًا بعد التجهيل.',
          ],
        },
        {
          heading: 'حقوقك',
          body: [
            'يمكنك عرض ملفك الشخصي وتعديله في أي وقت، وتنزيل جميع بياناتك كملف JSON، وحذف حسابك من صفحة ملفك الشخصي. ويمكنك أيضًا أن تطلب منا تصحيح بياناتك أو تقييد معالجتها أو توضيح كيفية معالجتها.',
            'يستطيع فريق الأكاديمية (المشرفون) أيضًا تصحيح بيانات ملفك أو طلبك متحدثًا أو حذف بعضها، أو حذف حسابك، مثلًا عندما تطلب ذلك. لا يقبلون الشروط ولا يمنحون أي موافقة نيابةً عنك، وكل تغيير يُسجَّل في سجل تدقيق داخلي (من غيّر ماذا، دون القيم نفسها).',
            `لممارسة أي حق أو تقديم شكوى، راسلنا عبر {contact}، وسنرد خلال المدد التي يحددها القانون. ويمكنك أيضًا تقديم شكوى إلى مركز حماية البيانات الشخصية في مصر.`,
          ],
        },
        {
          heading: 'السن',
          body: ['الأكاديمية مخصصة للبالغين. يجب ألا يقل عمرك عن 18 عامًا لاستخدامها، وتؤكد ذلك عند موافقتك على الشروط أثناء إكمال ملفك الشخصي.'],
        },
        {
          heading: 'ملفات تعريف الارتباط (Cookies)',
          body: [
            'نستخدم ملفات تعريف الارتباط الأساسية فقط: جلسة تسجيل الدخول وتفضيل اللغة. أدوات التحليل، إن فُعّلت، لا تستخدم ملفات تعريف الارتباط، لذا لا نعرض شريط موافقة عليها.',
          ],
        },
        {
          heading: 'التغييرات',
          body: ['إذا غيّرنا هذه السياسة بشكل مهم، فسنخبرك عبر البريد الإلكتروني أو على الموقع قبل سريان التغيير.'],
        },
      ],
    },
  },

  terms: {
    en: {
      title: 'Terms of Use',
      description: 'The rules for using MLOps MENA Academy.',
      updated: UPDATED_EN,
      sections: [
        {
          heading: 'About these terms',
          body: [
            'By creating an account or applying to a course on academy.mlopsmena.com you agree to these terms, the Privacy Policy and the Code of Conduct. The academy is run by MLOps MENA Community.',
          ],
        },
        {
          heading: 'Your account',
          body: [
            'You must be at least 18. Give accurate profile information, keep your login details private, and use one account per person. You are responsible for activity on your account; tell us at once if you think someone else has used it.',
          ],
        },
        {
          heading: 'Applications and acceptance',
          body: [
            'Applying does not guarantee a place. Instructors screen applications to shape each cohort, and may accept, waitlist or decline an application. Seats can be limited, and the decision is final for that cohort.',
          ],
        },
        {
          heading: 'Courses, schedules and certificates',
          body: [
            "We may change a course's schedule, session links, instructors or content when needed, and will tell enrolled students as early as we can. Each course page lists what is required to earn its certificate; certificates are issued only when those requirements are met.",
          ],
        },
        {
          heading: 'Course content and your work',
          body: [
            'Course materials, slides and recordings belong to their instructors and MLOps MENA Community. Session links and paid-course recordings are for your personal use as an enrolled student: do not share, re-upload or sell them, or give others access. Sharing paid content can lead to removal from the course without a refund.',
            'Work you create during a course (assignments, diagrams, your capstone) stays yours. By submitting it you allow the instructors to review and grade it, and with your permission to show it as an example.',
          ],
        },
        {
          heading: 'Payments',
          body: [
            'Paid courses are paid by InstaPay or Vodafone Cash using the details shown in your application. Your seat is confirmed only after an administrator verifies the payment. Refunds follow the Refund Policy.',
          ],
        },
        {
          heading: 'Acceptable use',
          body: [
            'Do not misuse the academy: no attempts to access other accounts or data, no automated scraping, no uploading of malicious or unlawful content, and no submitting payment proof that is not genuine. We may suspend or close accounts that break these terms or the Code of Conduct.',
          ],
        },
        {
          heading: 'Liability',
          body: [
            'The academy and its courses are provided as they are, largely by volunteers. We work to keep them accurate and available but cannot guarantee uninterrupted service or specific career outcomes. To the extent the law allows, our liability is limited to the amount you paid for the course concerned.',
          ],
        },
        {
          heading: 'Law and changes',
          body: [
            `These terms are governed by the laws of the Arab Republic of Egypt. We may update them; if a change matters, we will tell you before it takes effect. Questions: {contact}.`,
          ],
        },
      ],
    },
    ar: {
      title: 'شروط الاستخدام',
      description: 'قواعد استخدام أكاديمية MLOps MENA.',
      updated: UPDATED_AR,
      sections: [
        {
          heading: 'عن هذه الشروط',
          body: [
            'بإنشاء حساب أو التقديم على دورة في academy.mlopsmena.com فإنك توافق على هذه الشروط وعلى سياسة الخصوصية وقواعد السلوك. يدير الأكاديمية مجتمع MLOps MENA.',
          ],
        },
        {
          heading: 'حسابك',
          body: [
            'يجب ألا يقل عمرك عن 18 عامًا. قدّم معلومات صحيحة في ملفك الشخصي، وحافظ على سرية بيانات الدخول، واستخدم حسابًا واحدًا لكل شخص. أنت مسؤول عن النشاط الذي يتم عبر حسابك، وأبلغنا فورًا إذا اعتقدت أن غيرك استخدمه.',
          ],
        },
        {
          heading: 'الطلبات والقبول',
          body: [
            'التقديم لا يضمن الحصول على مقعد. يراجع المحاضرون الطلبات لتشكيل كل دفعة، وقد يقبلون الطلب أو يضعونه في قائمة الانتظار أو يعتذرون عنه. قد تكون المقاعد محدودة، والقرار نهائي بالنسبة لتلك الدفعة.',
          ],
        },
        {
          heading: 'الدورات والمواعيد والشهادات',
          body: [
            'قد نغيّر مواعيد الدورة أو روابط الجلسات أو المحاضرين أو المحتوى عند الحاجة، وسنُبلغ الطلاب المسجلين في أقرب وقت ممكن. توضح صفحة كل دورة متطلبات الحصول على شهادتها، ولا تُمنح الشهادة إلا عند استيفاء هذه المتطلبات.',
          ],
        },
        {
          heading: 'محتوى الدورات وأعمالك',
          body: [
            'مواد الدورات والعروض والتسجيلات مملوكة لمحاضريها ولمجتمع MLOps MENA. روابط الجلسات وتسجيلات الدورات المدفوعة مخصصة لاستخدامك الشخصي كطالب مسجل: لا تشاركها أو تعيد رفعها أو تبيعها أو تمنح الآخرين الوصول إليها. قد تؤدي مشاركة المحتوى المدفوع إلى الإزالة من الدورة دون استرداد.',
            'الأعمال التي تُنجزها خلال الدورة (الواجبات والمخططات ومشروعك الختامي) تبقى ملكك. وبتسليمها فإنك تسمح للمحاضرين بمراجعتها وتقييمها، وبإذنك عرضها كمثال.',
          ],
        },
        {
          heading: 'المدفوعات',
          body: [
            'تُدفع الدورات المدفوعة عبر InstaPay أو فودافون كاش باستخدام البيانات المعروضة في طلبك. لا يُؤكَّد مقعدك إلا بعد تحقق أحد المسؤولين من الدفع. ويخضع الاسترداد لسياسة الاسترداد.',
          ],
        },
        {
          heading: 'الاستخدام المقبول',
          body: [
            'لا تسئ استخدام الأكاديمية: لا محاولات للوصول إلى حسابات أو بيانات الآخرين، ولا جمع آلي للبيانات، ولا رفع لمحتوى ضار أو مخالف للقانون، ولا تقديم إثبات دفع غير حقيقي. قد نوقف أو نغلق الحسابات التي تخالف هذه الشروط أو قواعد السلوك.',
          ],
        },
        {
          heading: 'المسؤولية',
          body: [
            'تُقدَّم الأكاديمية ودوراتها كما هي، ويقوم عليها متطوعون إلى حد كبير. نعمل على إبقائها دقيقة ومتاحة، لكن لا يمكننا ضمان استمرار الخدمة دون انقطاع أو تحقيق نتائج مهنية بعينها. وفي الحدود التي يسمح بها القانون، تقتصر مسؤوليتنا على المبلغ الذي دفعته للدورة المعنية.',
          ],
        },
        {
          heading: 'القانون والتغييرات',
          body: [
            `تخضع هذه الشروط لقوانين جمهورية مصر العربية. قد نحدّثها، وإذا كان التغيير مهمًا فسنخبرك قبل سريانه. للأسئلة: {contact}.`,
          ],
        },
      ],
    },
  },

  'refund-policy': {
    en: {
      title: 'Refund Policy',
      description: 'When and how payments for paid courses and consultations can be refunded.',
      updated: REFUND_UPDATED_EN,
      sections: [
        {
          heading: 'Free courses',
          body: ['Free courses involve no payment, so there is nothing to refund. If you can no longer attend, withdraw so your seat can go to someone on the waitlist.'],
        },
        {
          heading: 'Before a paid course starts',
          body: ['Full refund if you withdraw at least 7 days before the first session.'],
        },
        {
          heading: 'After a paid course starts',
          body: ["Partial or no refund after the first session, at the academy's discretion."],
        },
        {
          heading: 'If we cancel',
          body: ['If the academy cancels a course, you receive a full refund.'],
        },
        {
          heading: 'Consultations',
          body: [
            'You pay for a consultation first and book its time once the academy has confirmed your payment. If we can\'t confirm a payment, we tell you why.',
            'Paid consultations are not refunded if you change your mind or miss the call. Instead, you can move a booked call to another open time of the same expert once, up to 24 hours before it starts.',
            'If the expert or the academy cancels a paid call, you receive a full refund.',
          ],
        },
        {
          heading: 'How refunds are paid',
          body: [
            `Refunds are sent back by the same method used to pay (InstaPay or a mobile wallet such as Vodafone Cash) within 14 days. Contact us through {contact} to request one.`,
          ],
        },
      ],
    },
    ar: {
      title: 'سياسة الاسترداد',
      description: 'متى وكيف يمكن استرداد مدفوعات الدورات المدفوعة والاستشارات.',
      updated: REFUND_UPDATED_AR,
      sections: [
        {
          heading: 'الدورات المجانية',
          body: ['لا تتطلب الدورات المجانية أي دفع، لذا لا يوجد ما يُسترد. إذا لم يعد بإمكانك الحضور، فانسحب ليذهب مقعدك إلى أحد المنتظرين.'],
        },
        {
          heading: 'قبل بدء الدورة المدفوعة',
          body: ['استرداد كامل إذا انسحبت قبل الجلسة الأولى بسبعة أيام على الأقل.'],
        },
        {
          heading: 'بعد بدء الدورة المدفوعة',
          body: ['استرداد جزئي أو عدم استرداد بعد الجلسة الأولى، وفقًا لتقدير الأكاديمية.'],
        },
        {
          heading: 'إذا ألغينا الدورة',
          body: ['إذا ألغت الأكاديمية دورة، تحصل على استرداد كامل.'],
        },
        {
          heading: 'الاستشارات',
          body: [
            'تدفع مقابل الاستشارة أولًا، ثم تحجز موعدها بعد أن تؤكد الأكاديمية الدفع. وإذا لم نتمكن من تأكيد الدفع نخبرك بالسبب.',
            'لا تُسترد قيمة الاستشارة المدفوعة إذا غيّرت رأيك أو لم تحضر. بدلًا من ذلك يمكنك نقل المكالمة المحجوزة مرة واحدة إلى موعد متاح آخر مع نفس الخبير، حتى 24 ساعة قبل بدئها.',
            'إذا ألغى الخبير أو الأكاديمية مكالمة مدفوعة، تحصل على استرداد كامل.',
          ],
        },
        {
          heading: 'كيف يُرد المبلغ',
          body: [`يُرد المبلغ بنفس طريقة الدفع (InstaPay أو محفظة إلكترونية مثل فودافون كاش) خلال 14 يومًا. تواصل معنا عبر {contact} لطلب الاسترداد.`],
        },
      ],
    },
  },

  'code-of-conduct': {
    en: {
      title: 'Code of Conduct',
      description: 'How we expect everyone to behave in academy sessions and community spaces.',
      updated: UPDATED_EN,
      sections: [
        {
          heading: 'Where it applies',
          body: [
            'In live sessions, course chats and study groups (including Telegram), feedback and submissions, and any other academy or community space. It applies to students, instructors, volunteers and guests alike.',
          ],
        },
        {
          heading: 'Be respectful',
          body: [
            'Treat instructors and fellow students with respect, in Arabic and in English. Disagree with ideas, not people. Harassment, discrimination, hate speech, sexual content, threats and personal attacks are not tolerated.',
          ],
        },
        {
          heading: 'Keep sessions useful',
          body: [
            'Stay on topic, keep your microphone muted unless you are speaking, and use the chat or Q&A for questions. No advertising, recruiting or self-promotion in sessions or study groups without the organisers\' permission.',
          ],
        },
        {
          heading: 'Do your own work',
          body: [
            'Learning from others is encouraged, but quizzes and the work you submit for a certificate must be your own. Copying someone else\'s work, or submitting AI-generated work as if you wrote it without saying so, can lead to losing the certificate.',
          ],
        },
        {
          heading: "Protect others' privacy",
          body: [
            "Do not record, screenshot or share other participants' personal information or messages without their consent. Do not share session links or paid-course content outside the course.",
          ],
        },
        {
          heading: 'Reporting and consequences',
          body: [
            `Report any concern through {contact}, or privately to an organiser in the study group. Reports are handled confidentially. Depending on what happened, we may give a warning, remove someone from a session or study group, or remove them from the course or the community.`,
          ],
        },
      ],
    },
    ar: {
      title: 'قواعد السلوك',
      description: 'السلوك المتوقع من الجميع في جلسات الأكاديمية ومساحات المجتمع.',
      updated: UPDATED_AR,
      sections: [
        {
          heading: 'أين تُطبَّق',
          body: [
            'في الجلسات المباشرة، ومحادثات الدورات ومجموعات الدراسة (بما فيها Telegram)، والتقييمات والتسليمات، وأي مساحة أخرى للأكاديمية أو المجتمع. وتنطبق على الطلاب والمحاضرين والمتطوعين والضيوف على حد سواء.',
          ],
        },
        {
          heading: 'كن محترمًا',
          body: [
            'تعامل مع المحاضرين وزملائك باحترام، بالعربية والإنجليزية. اختلف مع الأفكار لا مع الأشخاص. لا نتسامح مع التحرش أو التمييز أو خطاب الكراهية أو المحتوى الجنسي أو التهديد أو الإساءة الشخصية.',
          ],
        },
        {
          heading: 'حافظ على فائدة الجلسات',
          body: [
            'التزم بموضوع الجلسة، وأبقِ الميكروفون مغلقًا إلا عند الحديث، واستخدم المحادثة أو قسم الأسئلة لطرح أسئلتك. لا إعلانات أو توظيف أو ترويج شخصي في الجلسات أو مجموعات الدراسة دون إذن المنظمين.',
          ],
        },
        {
          heading: 'أنجز عملك بنفسك',
          body: [
            'نشجع التعلم من الآخرين، لكن الاختبارات والأعمال التي تسلّمها للحصول على الشهادة يجب أن تكون من عملك. نسخ عمل غيرك، أو تقديم عمل أنتجه الذكاء الاصطناعي على أنه من كتابتك دون الإفصاح عن ذلك، قد يؤدي إلى فقدان الشهادة.',
          ],
        },
        {
          heading: 'احمِ خصوصية الآخرين',
          body: [
            'لا تسجّل أو تلتقط صورًا أو تشارك معلومات شخصية أو رسائل لمشاركين آخرين دون موافقتهم. ولا تشارك روابط الجلسات أو محتوى الدورات المدفوعة خارج الدورة.',
          ],
        },
        {
          heading: 'الإبلاغ والعواقب',
          body: [
            `أبلغ عن أي مشكلة عبر {contact}، أو بشكل خاص لأحد المنظمين في مجموعة الدراسة. تُعالج البلاغات بسرية. وبحسب ما حدث، قد نوجّه تحذيرًا، أو نزيل الشخص من جلسة أو مجموعة دراسة، أو من الدورة أو المجتمع.`,
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
          needsEmail: true,
          body: [`{contact}. We usually reply within 2 working days.`],
        },
        {
          heading: 'Applications and courses',
          body: [
            'Questions about a course or your application? Include the course name and the email address you registered with. Your application status is always visible on your dashboard.',
          ],
        },
        {
          heading: 'Payments',
          body: [
            'Questions about a payment? Include your course name and transaction reference number. Never send your password or full card details.',
          ],
        },
        {
          heading: 'Your data',
          body: [`To download or delete your data, use your profile page. For anything else about your personal data, write to us through {contact}.`],
        },
        {
          heading: 'Community',
          communityLinks: true,
          body: ['For general questions, ask in the MLOps MENA community channels. Enrolled students also get a course study group.'],
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
          needsEmail: true,
          body: [`{contact}. نرد عادةً خلال يومي عمل.`],
        },
        {
          heading: 'الطلبات والدورات',
          body: ['لديك سؤال عن دورة أو عن طلبك؟ اذكر اسم الدورة والبريد الإلكتروني الذي سجلت به. تظهر حالة طلبك دائمًا في لوحة التحكم الخاصة بك.'],
        },
        {
          heading: 'المدفوعات',
          body: ['لديك سؤال عن عملية دفع؟ اذكر اسم الدورة والرقم المرجعي للعملية. لا ترسل كلمة المرور أو بيانات البطاقة كاملة أبدًا.'],
        },
        {
          heading: 'بياناتك',
          body: [`لتنزيل بياناتك أو حذفها، استخدم صفحة ملفك الشخصي. ولأي أمر آخر يخص بياناتك الشخصية، راسلنا عبر {contact}.`],
        },
        {
          heading: 'المجتمع',
          communityLinks: true,
          body: ['للأسئلة العامة، اسأل في قنوات مجتمع MLOps MENA. ويحصل الطلاب المسجلون أيضًا على مجموعة دراسة خاصة بالدورة.'],
        },
      ],
    },
  },
};

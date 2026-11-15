import {
  Body,
  Button,
  Column,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Row,
  Section,
  Text,
} from '@react-email/components';
import type { Locale } from '@academy/shared';

/** The same palette as Layout, plus the certificate's accent. */
const c = {
  ink: '#08142e',
  primary: '#0b7a71',
  primarySoft: '#e6f4f2',
  muted: '#566580',
  body: '#33415a',
  bg: '#f1f5fa',
  line: '#e2e8f0',
  linkedIn: '#0a66c2',
};

export interface CertificateEmailProps {
  locale: Locale;
  preview: string;
  footer: string;
  /** Attendance (self-paced, automatic) or completion (issued by the course team). */
  attendance: boolean;
  holderName: string;
  courseTitle: string;
  serial: string;
  /** Already formatted in the student's language. */
  issuedOn: string;
  verifyUrl: string;
  downloadUrl: string;
  linkedInUrl: string;
  /** Self-paced courses: the testimonial form on the learning page. */
  testimonialUrl?: string;
}

/**
 * The certificate email: a header band, a certificate card (name, course, date, ID), download and
 * LinkedIn buttons, how to verify, and an invitation to share. Inline styles and tables only, for
 * Gmail and Outlook. Arabic is right-to-left with physical sides, like Layout.
 */
export function CertificateEmail(p: CertificateEmailProps) {
  const ar = p.locale === 'ar';
  const dir = ar ? 'rtl' : 'ltr';
  const align = ar ? 'right' : 'left';
  const font = ar
    ? "'IBM Plex Sans Arabic', Tahoma, 'Segoe UI', Arial, sans-serif"
    : "Inter, 'Segoe UI', Arial, sans-serif";
  const kind = p.attendance
    ? ar
      ? 'شهادة حضور'
      : 'Certificate of Attendance'
    : ar
      ? 'شهادة إتمام'
      : 'Certificate of Completion';
  const text = {
    color: c.body,
    fontSize: 15,
    lineHeight: '24px',
    textAlign: align,
    margin: '0 0 14px',
  } as const;
  const label = {
    color: c.muted,
    fontSize: 11,
    letterSpacing: ar ? 0 : 1.2,
    textTransform: 'uppercase',
    fontWeight: 600,
    margin: 0,
  } as const;

  return (
    <Html lang={p.locale} dir={dir}>
      <Head />
      <Preview>{p.preview}</Preview>
      <Body style={{ backgroundColor: c.bg, fontFamily: font, margin: 0, padding: '24px 0' }}>
        <Container
          style={{
            maxWidth: 560,
            backgroundColor: '#ffffff',
            borderRadius: 14,
            overflow: 'hidden',
          }}
        >
          {/* Header band */}
          <Section style={{ backgroundColor: c.ink, padding: '22px 28px' }}>
            <Text
              style={{
                color: '#ffffff',
                fontSize: 15,
                fontWeight: 700,
                margin: 0,
                textAlign: align,
              }}
            >
              {ar ? 'أكاديمية MLOps MENA' : 'MLOps MENA Academy'}
            </Text>
            <Text style={{ color: '#9fd8d2', fontSize: 12, margin: '2px 0 0', textAlign: align }}>
              {ar ? 'مجتمع MLOps MENA' : 'MLOps MENA Community'}
            </Text>
          </Section>

          <Section style={{ padding: '30px 28px 8px' }}>
            <Text
              style={{
                color: c.primary,
                fontSize: 13,
                fontWeight: 700,
                letterSpacing: ar ? 0 : 1.5,
                textTransform: 'uppercase',
                margin: '0 0 6px',
                textAlign: align,
              }}
            >
              {ar ? 'مبروك!' : 'Congratulations!'}
            </Text>
            <Heading
              as="h1"
              style={{
                color: c.ink,
                fontSize: 24,
                lineHeight: '32px',
                margin: '0 0 16px',
                textAlign: align,
              }}
            >
              {p.attendance
                ? ar
                  ? `أتممت ${p.courseTitle}`
                  : `You've completed ${p.courseTitle}`
                : ar
                  ? `شهادتك في ${p.courseTitle} جاهزة`
                  : `Your certificate for ${p.courseTitle} is ready`}
            </Heading>
            <Text style={text}>
              {p.attendance
                ? ar
                  ? `مبروك يا ${p.holderName}! أنهيت كل الدروس المطلوبة في ${p.courseTitle} ونجحت في اختباراتها، وشهادة الحضور الخاصة بك جاهزة.`
                  : `Congratulations, ${p.holderName}! You've finished every required lesson in ${p.courseTitle} and passed its quizzes. Your Certificate of Attendance is ready.`
                : ar
                  ? `مبروك يا ${p.holderName}! أصدر فريق الدورة شهادة إتمامك لدورة ${p.courseTitle}.`
                  : `Congratulations, ${p.holderName}! The course team has issued your Certificate of Completion for ${p.courseTitle}.`}
            </Text>
          </Section>

          {/* The certificate card */}
          <Section style={{ padding: '0 28px' }}>
            <Section
              style={{
                border: `1px solid ${c.line}`,
                borderTop: `4px solid ${c.primary}`,
                borderRadius: 10,
                backgroundColor: '#fbfdfe',
              }}
            >
              <Section style={{ padding: '22px 22px 6px', textAlign: 'center' }}>
                <Text style={{ ...label, color: c.primary, textAlign: 'center', fontSize: 12 }}>
                  {kind}
                </Text>
                <Text
                  style={{
                    color: c.muted,
                    fontSize: 13,
                    margin: '14px 0 2px',
                    textAlign: 'center',
                  }}
                >
                  {ar ? 'مُنحت إلى' : 'Awarded to'}
                </Text>
                <Text
                  style={{
                    color: c.ink,
                    fontSize: 22,
                    lineHeight: '30px',
                    fontWeight: 700,
                    margin: 0,
                    textAlign: 'center',
                  }}
                >
                  {p.holderName}
                </Text>
                <Text
                  style={{
                    color: c.muted,
                    fontSize: 13,
                    margin: '12px 0 2px',
                    textAlign: 'center',
                  }}
                >
                  {ar ? 'في دورة' : 'for'}
                </Text>
                <Text
                  style={{
                    color: c.ink,
                    fontSize: 16,
                    lineHeight: '24px',
                    fontWeight: 600,
                    margin: 0,
                    textAlign: 'center',
                  }}
                >
                  {p.courseTitle}
                </Text>
              </Section>
              <Section style={{ padding: '18px 22px 18px' }}>
                <Row style={{ borderTop: `1px solid ${c.line}` }}>
                  <Column
                    style={{ width: '50%', verticalAlign: 'top', textAlign: align, paddingTop: 14 }}
                  >
                    <Text style={{ ...label, textAlign: align }}>
                      {ar ? 'تاريخ الإصدار' : 'Issued on'}
                    </Text>
                    <Text
                      style={{
                        color: c.ink,
                        fontSize: 14,
                        fontWeight: 600,
                        margin: '4px 0 0',
                        textAlign: align,
                      }}
                    >
                      {p.issuedOn}
                    </Text>
                  </Column>
                  <Column
                    style={{ width: '50%', verticalAlign: 'top', textAlign: align, paddingTop: 14 }}
                  >
                    <Text style={{ ...label, textAlign: align }}>
                      {ar ? 'رقم الشهادة' : 'Certificate ID'}
                    </Text>
                    <Text
                      style={{
                        color: c.ink,
                        fontSize: 14,
                        fontWeight: 600,
                        fontFamily: "'SFMono-Regular', Menlo, Consolas, monospace",
                        margin: '4px 0 0',
                        textAlign: align,
                        direction: 'ltr',
                      }}
                    >
                      {p.serial}
                    </Text>
                  </Column>
                </Row>
              </Section>
            </Section>
          </Section>

          {/* Buttons */}
          <Section style={{ padding: '24px 28px 4px', textAlign: 'center' }}>
            <Button
              href={p.downloadUrl}
              style={{
                backgroundColor: c.primary,
                color: '#ffffff',
                borderRadius: 8,
                padding: '13px 22px',
                fontWeight: 600,
                fontSize: 15,
                margin: '0 6px 10px',
              }}
            >
              {ar ? 'نزّل شهادتك' : 'Download your certificate'}
            </Button>
            <Button
              href={p.linkedInUrl}
              style={{
                backgroundColor: c.linkedIn,
                color: '#ffffff',
                borderRadius: 8,
                padding: '13px 22px',
                fontWeight: 600,
                fontSize: 15,
                margin: '0 6px 10px',
              }}
            >
              {ar ? 'أضفها إلى LinkedIn' : 'Add it to LinkedIn'}
            </Button>
          </Section>

          <Section style={{ padding: '8px 28px 0' }}>
            <Text style={text}>
              {ar
                ? 'يمكن لأي شخص التأكد من صحة شهادتك بمسح رمز QR عليها، أو عبر '
                : "Anyone can confirm it's genuine by scanning the QR code on the certificate, or at "}
              <Link href={p.verifyUrl} style={{ color: c.primary, textDecoration: 'underline' }}>
                {ar ? 'صفحة التحقق' : 'its verification page'}
              </Link>
              .
            </Text>
          </Section>

          {/* Share */}
          <Section style={{ padding: '4px 28px 8px' }}>
            <Section
              style={{
                backgroundColor: c.primarySoft,
                // Physical side: Outlook and Gmail ignore logical properties.
                ...(ar
                  ? { borderRight: `4px solid ${c.primary}` }
                  : { borderLeft: `4px solid ${c.primary}` }),
                borderRadius: 8,
                padding: '14px 18px',
              }}
            >
              <Text style={{ ...text, margin: 0 }}>
                {ar
                  ? 'شاركها على LinkedIn وأشِر إلى MLOps MENA Community لنحتفل معك.'
                  : 'Share it on LinkedIn and tag MLOps MENA Community, so we can celebrate with you.'}
                {p.testimonialUrl && (
                  <>
                    {ar ? ' وإن أفادتك الدورة، ' : ' And if the course helped you, '}
                    <Link
                      href={p.testimonialUrl}
                      style={{ color: c.primary, fontWeight: 600, textDecoration: 'underline' }}
                    >
                      {ar ? 'اكتب لنا رأيك في سطور قليلة' : 'tell us in a short testimonial'}
                    </Link>
                    .
                  </>
                )}
              </Text>
            </Section>
          </Section>

          <Section style={{ padding: '16px 28px 26px' }}>
            <Hr style={{ borderColor: c.line, margin: '0 0 16px' }} />
            <Text
              style={{
                color: c.muted,
                fontSize: 12,
                lineHeight: '18px',
                margin: 0,
                textAlign: align,
              }}
            >
              {p.footer}
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

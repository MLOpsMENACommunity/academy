import { Body, Button, Container, Head, Heading, Hr, Html, Preview, Section, Text } from '@react-email/components';
import type { Locale } from '@academy/shared';
import type { ReactNode } from 'react';

const brand = { ink: '#08142e', primary: '#0b7a71', muted: '#566580', bg: '#f1f5fa' };

export interface LayoutProps {
  locale: Locale;
  preview: string;
  heading: string;
  paragraphs: ReactNode[];
  cta?: { label: string; url: string };
  note?: string;
  footer: string;
  /** Big coloured banner above the heading (e.g. "Congratulations, you're in!"). */
  banner?: { text: string; tone: 'success' | 'info' | 'neutral' };
  /** A titled checklist after the paragraphs. */
  list?: { title: string; items: string[] };
  /** A highlighted box (e.g. feedback from the course team). */
  callout?: { title: string; body: string };
  /** Paragraphs shown after the list/callout and before the button. */
  after?: string[];
}

const tones = {
  success: { bg: '#e7f6ee', fg: '#0f7a3d' },
  info: { bg: '#e6f3f8', fg: '#0e6a8a' },
  neutral: { bg: '#f1f5fa', fg: '#08142e' },
};

export function Layout({ locale, preview, heading, paragraphs, cta, note, footer, banner, list, callout, after = [] }: LayoutProps) {
  const dir = locale === 'ar' ? 'rtl' : 'ltr';
  const font =
    locale === 'ar'
      ? "'IBM Plex Sans Arabic', Tahoma, 'Segoe UI', Arial, sans-serif"
      : "Inter, 'Segoe UI', Arial, sans-serif";
  const align = locale === 'ar' ? 'right' : 'left';
  return (
    <Html lang={locale} dir={dir}>
      <Head />
      <Preview>{preview}</Preview>
      <Body style={{ backgroundColor: brand.bg, fontFamily: font, margin: 0, padding: '24px 0' }}>
        <Container style={{ backgroundColor: '#ffffff', borderRadius: 12, padding: '32px 28px', maxWidth: 560 }}>
          <Text style={{ color: brand.primary, fontWeight: 700, fontSize: 14, margin: 0, textAlign: align }}>
            {locale === 'ar' ? 'أكاديمية MLOps MENA' : 'MLOps MENA Academy'}
          </Text>
          {banner && (
            <Section style={{ backgroundColor: tones[banner.tone].bg, borderRadius: 10, padding: '18px 20px', margin: '16px 0 4px' }}>
              <Text style={{ color: tones[banner.tone].fg, fontSize: 24, lineHeight: '32px', fontWeight: 700, margin: 0, textAlign: align }}>
                {banner.text}
              </Text>
            </Section>
          )}
          <Heading as="h1" style={{ color: brand.ink, fontSize: 22, lineHeight: '30px', textAlign: align }}>
            {heading}
          </Heading>
          {paragraphs.map((p, i) => (
            <Text key={i} style={{ color: '#33415a', fontSize: 15, lineHeight: '24px', textAlign: align, whiteSpace: 'pre-line' }}>
              {p}
            </Text>
          ))}
          {list && (
            <Section style={{ margin: '8px 0' }}>
              <Text style={{ color: brand.ink, fontSize: 15, fontWeight: 700, margin: '0 0 6px', textAlign: align }}>{list.title}</Text>
              {list.items.map((item, i) => (
                <Text key={i} style={{ color: '#33415a', fontSize: 15, lineHeight: '24px', margin: '0 0 6px', textAlign: align }}>
                  {`${i + 1}. ${item}`}
                </Text>
              ))}
            </Section>
          )}
          {callout && (
            <Section
              style={{
                backgroundColor: '#f8fafc',
                // Physical side: Outlook and Gmail ignore logical properties like border-inline-start.
                ...(locale === 'ar' ? { borderRight: `4px solid ${brand.primary}` } : { borderLeft: `4px solid ${brand.primary}` }),
                borderRadius: 6,
                padding: '12px 16px',
                margin: '12px 0',
              }}
            >
              <Text style={{ color: brand.ink, fontSize: 14, fontWeight: 700, margin: '0 0 4px', textAlign: align }}>{callout.title}</Text>
              <Text style={{ color: '#33415a', fontSize: 15, lineHeight: '24px', margin: 0, textAlign: align, whiteSpace: 'pre-line' }}>
                {callout.body}
              </Text>
            </Section>
          )}
          {after.map((p, i) => (
            <Text key={`a${i}`} style={{ color: '#33415a', fontSize: 15, lineHeight: '24px', textAlign: align, whiteSpace: 'pre-line' }}>
              {p}
            </Text>
          ))}
          {cta && (
            <Section style={{ textAlign: align, margin: '24px 0' }}>
              <Button
                href={cta.url}
                style={{
                  backgroundColor: brand.ink,
                  color: '#ffffff',
                  borderRadius: 8,
                  padding: '12px 20px',
                  fontWeight: 600,
                  fontSize: 15,
                }}
              >
                {cta.label}
              </Button>
            </Section>
          )}
          {note && (
            <Text style={{ color: brand.muted, fontSize: 13, lineHeight: '20px', textAlign: align }}>{note}</Text>
          )}
          <Hr style={{ borderColor: '#e2e8f0', margin: '24px 0' }} />
          <Text style={{ color: brand.muted, fontSize: 12, lineHeight: '18px', textAlign: align }}>{footer}</Text>
        </Container>
      </Body>
    </Html>
  );
}

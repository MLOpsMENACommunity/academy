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
}

export function Layout({ locale, preview, heading, paragraphs, cta, note, footer }: LayoutProps) {
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
          <Heading as="h1" style={{ color: brand.ink, fontSize: 22, lineHeight: '30px', textAlign: align }}>
            {heading}
          </Heading>
          {paragraphs.map((p, i) => (
            <Text key={i} style={{ color: '#33415a', fontSize: 15, lineHeight: '24px', textAlign: align, whiteSpace: 'pre-line' }}>
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

import '@fontsource-variable/inter';
import '@fontsource/ibm-plex-sans-arabic/400.css';
import '@fontsource/ibm-plex-sans-arabic/600.css';
import '@fontsource/ibm-plex-sans-arabic/700.css';
import type { Metadata, Viewport } from 'next';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { Analytics } from '@/components/layout/Analytics';
import { Footer } from '@/components/layout/Footer';
import { AuthProvider } from '@/components/auth/AuthProvider';
import { VerifyBanner } from '@/components/auth/VerifyBanner';
import { Header } from '@/components/layout/Header';
import { I18nProvider } from '@/i18n/client';
import { dirOf, isLocale, locales } from '@/i18n/config';
import { createTranslator } from '@/i18n/translator';
import { community, siteUrl } from '@/lib/site';

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export const viewport: Viewport = {
  themeColor: '#08142e',
  width: 'device-width',
  initialScale: 1,
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const t = createTranslator(locale);
  return {
    metadataBase: new URL(siteUrl),
    title: { default: t('meta.homeTitle'), template: `%s | ${t('meta.siteName')}` },
    description: t('meta.tagline'),
    applicationName: t('meta.siteName'),
    // Small icons: the 256px logo is for structured data only.
    icons: { icon: [{ url: '/favicon-32.png', sizes: '32x32', type: 'image/png' }], apple: '/apple-touch-icon.png' },
    openGraph: {
      siteName: t('meta.siteName'),
      locale: locale === 'ar' ? 'ar_EG' : 'en_US',
      type: 'website',
    },
    twitter: { card: 'summary_large_image', site: '@MLOpsMENA' },
  };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = createTranslator(locale);

  const organization = {
    '@context': 'https://schema.org',
    '@type': 'EducationalOrganization',
    name: t('meta.siteName'),
    url: siteUrl,
    logo: `${siteUrl}/logo-mark.png`,
    parentOrganization: { '@type': 'Organization', name: 'MLOps MENA Community', url: community.mainSite },
    sameAs: [community.linkedin, community.youtube, community.github, community.x],
  };

  return (
    <html lang={locale} dir={dirOf(locale)}>
      <body className="flex min-h-screen flex-col">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:start-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-ink focus:px-4 focus:py-2 focus:text-white"
        >
          {t('common.skipToContent')}
        </a>
        <I18nProvider locale={locale}>
          <AuthProvider>
            <Header locale={locale} />
            <VerifyBanner />
            <main id="main" className="flex-1">
              {children}
            </main>
            <Footer locale={locale} />
          </AuthProvider>
        </I18nProvider>
        <script
          type="application/ld+json"
          // JSON.stringify output is safe here: no user-controlled strings.
          dangerouslySetInnerHTML={{ __html: JSON.stringify(organization) }}
        />
        <Analytics />
      </body>
    </html>
  );
}

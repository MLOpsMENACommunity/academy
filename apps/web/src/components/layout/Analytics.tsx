import Script from 'next/script';

const provider = process.env.NEXT_PUBLIC_ANALYTICS_PROVIDER;
const domain = process.env.NEXT_PUBLIC_ANALYTICS_DOMAIN;
const src = process.env.NEXT_PUBLIC_ANALYTICS_SRC;
const websiteId = process.env.NEXT_PUBLIC_ANALYTICS_WEBSITE_ID;

/**
 * Cookieless, privacy-friendly page analytics (Plausible or Umami), off unless
 * configured at build time. Neither sets cookies, so no cookie banner is needed.
 */
export function Analytics() {
  if (provider === 'plausible' && domain) {
    return <Script defer data-domain={domain} src={src || 'https://plausible.io/js/script.js'} strategy="afterInteractive" />;
  }
  if (provider === 'umami' && src && websiteId) {
    return <Script defer data-website-id={websiteId} data-do-not-track="true" src={src} strategy="afterInteractive" />;
  }
  return null;
}

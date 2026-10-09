import path from 'node:path';
import type { NextConfig } from 'next';

const isDev = process.env.NODE_ENV !== 'production';
/** Only production may be indexed (see src/lib/site.ts `indexable`). */
const indexable = process.env.NEXT_PUBLIC_ACADEMY_ENVIRONMENT === 'production';
/**
 * Signed storage URLs are https (R2) everywhere except the local stacks, where MinIO serves
 * them from http://localhost:9000. Allow plain-http localhost images only there: in dev, or
 * in a production build whose site is itself on localhost (docker compose, CI e2e).
 */
const localImages = isDev || /^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000');
/** Origin of the analytics script (and its event endpoint), when analytics is configured. */
function analyticsOrigin(): string | null {
  const provider = process.env.NEXT_PUBLIC_ANALYTICS_PROVIDER;
  if (provider !== 'plausible' && provider !== 'umami') return null;
  const src = process.env.NEXT_PUBLIC_ANALYTICS_SRC || (provider === 'plausible' ? 'https://plausible.io/js/script.js' : '');
  return src ? new URL(src).origin : null;
}
const analytics = analyticsOrigin();
// Cloudflare Web Analytics (cookieless) is injected by Cloudflare when enabled on the zone.
const cfInsights = { script: 'https://static.cloudflareinsights.com', connect: 'https://cloudflareinsights.com' };

/**
 * Content Security Policy. Next.js inlines its hydration scripts, so scripts need
 * 'unsafe-inline'. A nonce is not an option: it must differ per response, so every page
 * would render per request, and the ISR pages and Cloudflare edge cache (#29) that serve
 * one cached HTML to every visitor would stop working. The rest
 * is locked down: no plugins, no framing by other sites, forms and connections only
 * to this origin, and embeds only from YouTube's privacy-enhanced domain.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' ${cfInsights.script}${isDev ? " 'unsafe-eval'" : ''}${analytics ? ` ${analytics}` : ''}`,
  "style-src 'self' 'unsafe-inline'",
  // Signed storage URLs: R2 over https in production, MinIO on localhost in the local stacks only.
  `img-src 'self' data: blob: https:${localImages ? ' http://localhost:* http://127.0.0.1:*' : ''}`,
  "font-src 'self' data:",
  `connect-src 'self' ${cfInsights.connect}${analytics ? ` ${analytics}` : ''}${isDev ? ' ws:' : ''}`,
  'frame-src https://www.youtube-nocookie.com',
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  // Staging and local builds: keep every page out of search engines.
  ...(indexable ? [] : [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }]),
];

const nextConfig: NextConfig = {
  async headers() {
    // /api/* is proxied to the API, which sets its own (stricter) headers.
    return [{ source: '/((?!api/).*)', headers: securityHeaders }];
  },
  output: 'standalone',
  // Set per deploy (the git SHA, by deploy/cloudflare/configure-host.mjs through the image
  // build): asset URLs carry it, and a client navigation from a page of another build turns
  // into a full page load instead of asking this build for chunks it doesn't have.
  deploymentId: process.env.NEXT_DEPLOYMENT_ID || undefined,
  // Trace files from the monorepo root so the standalone build includes workspace packages.
  outputFileTracingRoot: path.resolve(process.cwd(), '../..'),
  // The open-source roadmaps are read from Markdown when a page renders (the header's Learn
  // menu lists them on every page, and ISR re-renders pages at run time): ship the files.
  outputFileTracingIncludes: { '/**': ['./src/content/roadmaps/*.md'] },
  poweredByHeader: false,
  // Inline the (small) CSS into the HTML: no render-blocking stylesheet round trips on slow mobile networks.
  experimental: { inlineCss: true },
  // Always render metadata in <head> (no streaming), so every crawler and link
  // preview (LinkedIn, WhatsApp, Telegram) sees titles, descriptions and OG tags.
  htmlLimitedBots: /.*/,
  reactStrictMode: true,
  images: {
    formats: ['image/avif', 'image/webp'],
    remotePatterns: [
      { protocol: 'https', hostname: 'i.ytimg.com' },
      { protocol: 'https', hostname: 'mlopsmena.com' },
      { protocol: 'https', hostname: '**.mlopsmena.com' },
      { protocol: 'https', hostname: 'images.unsplash.com' },
      { protocol: 'https', hostname: 'lh3.googleusercontent.com' },
    ],
  },
};

export default nextConfig;

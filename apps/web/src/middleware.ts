import { NextResponse, type NextRequest } from 'next/server';
import { defaultLocale, isLocale, LOCALE_COOKIE } from './i18n/config';

/**
 * 1. Paths without a locale prefix (e.g. the main site's /courses/<slug>?ref=main-site
 *    links) are redirected to /<locale>/..., keeping the query string.
 * 2. Private areas require an auth cookie; otherwise we send the visitor to
 *    login with a returnTo so they land back where they started. (The API is
 *    still the real gatekeeper; this only avoids rendering an empty shell.)
 */
const PROTECTED = /^\/(en|ar)\/(dashboard|profile|onboarding|admin|learn|teach)(\/|$)|^\/(en|ar)\/courses\/[^/]+\/(apply|notify)(\/|$)/;

export function middleware(req: NextRequest) {
  const { search } = req.nextUrl;
  let pathname = req.nextUrl.pathname;
  try {
    pathname = decodeURIComponent(pathname);
  } catch {
    // malformed escape: match on the raw path
  }
  pathname = pathname.replace(/\/{2,}/g, '/');
  const first = pathname.split('/')[1];

  if (!isLocale(first)) {
    const cookieLocale = req.cookies.get(LOCALE_COOKIE)?.value;
    const locale = isLocale(cookieLocale) ? cookieLocale : defaultLocale;
    const url = req.nextUrl.clone();
    url.pathname = `/${locale}${pathname === '/' ? '' : pathname}`;
    // Temporary (307): the target depends on the locale cookie, so it must not be cached.
    const res = NextResponse.redirect(url);
    res.headers.set('Cache-Control', 'private, no-store');
    res.headers.set('Vary', 'Cookie');
    return res;
  }

  if (PROTECTED.test(pathname)) {
    const hasSession = req.cookies.has('access_token') || req.cookies.has('has_session');
    if (!hasSession) {
      const url = req.nextUrl.clone();
      url.pathname = `/${first}/login`;
      url.search = `?returnTo=${encodeURIComponent(pathname + search)}`;
      return NextResponse.redirect(url);
    }
  }

  const res = NextResponse.next();
  if (req.cookies.get(LOCALE_COOKIE)?.value !== first) {
    res.cookies.set(LOCALE_COOKIE, first, { path: '/', maxAge: 31536000, sameSite: 'lax' });
  }
  return res;
}

export const config = {
  // Skip API proxy, Next internals and files with an extension (images, robots.txt, sitemap.xml…).
  matcher: ['/((?!api(?:/|$)|_next/|.*\\.[\\w]+$).*)'],
};

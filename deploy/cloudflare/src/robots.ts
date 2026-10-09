/**
 * Search engines index production only. Every other deployment (staging) answers
 * /robots.txt with "Disallow: /" and marks every response `X-Robots-Tag: noindex, nofollow`,
 * here in the Worker, so nothing behind it (pages, API, redirects, images, the edge cache)
 * can leak into an index whatever the containers send.
 *
 * Production is decided by ACADEMY_ENVIRONMENT, which wrangler.jsonc commits per
 * environment and configure-host.mjs sets from the deploy target, rather than by hostname,
 * so moving production to another host can't make it unindexable by accident.
 * Anything other than exactly "production" counts as not production.
 */
export const NOINDEX = 'noindex, nofollow';

export const DISALLOW_ALL = 'User-agent: *\nDisallow: /\n';

export function isProduction(environment: string | undefined): boolean {
  return environment === 'production';
}

/** The robots.txt a non-production Worker serves itself, without asking the web container. */
export function disallowAllRobots(): Response {
  return new Response(DISALLOW_ALL, {
    status: 200,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': NOINDEX },
  });
}

/** The response with X-Robots-Tag set (a copy: redirects and fetched responses have immutable headers). */
export function withNoindex(response: Response): Response {
  const out = new Response(response.body, response);
  out.headers.set('x-robots-tag', NOINDEX);
  return out;
}

import { revalidatePath, revalidateTag } from 'next/cache';
import { PUBLIC_TAG, REVALIDATE_HEADER, revalidateTokenMatches } from '@/lib/revalidate';

/**
 * POST /api/internal/revalidate (x-revalidate-token: REVALIDATE_TOKEN): drops this instance's
 * cached public API reads and rendered pages, so the next visit renders with current data.
 * Called by the API after an admin edit (via the Worker on Cloudflare, which never lets
 * /api/internal/* in from outside). 404 when REVALIDATE_TOKEN isn't set.
 */
export const dynamic = 'force-dynamic';

const json = (body: unknown, status: number) =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store' } });

export async function POST(req: Request): Promise<Response> {
  const expected = process.env.REVALIDATE_TOKEN;
  if (!expected) return json({ statusCode: 404, message: 'Not found' }, 404);
  if (!revalidateTokenMatches(req.headers.get(REVALIDATE_HEADER), expected)) {
    return json({ statusCode: 401, message: 'Unauthorized' }, 401);
  }
  // The data (every public API read is tagged), then every page and route under the root
  // layout: both locales, the OG images and the sitemap.
  revalidateTag(PUBLIC_TAG);
  revalidatePath('/', 'layout');
  return json({ revalidated: true, at: new Date().toISOString() }, 200);
}

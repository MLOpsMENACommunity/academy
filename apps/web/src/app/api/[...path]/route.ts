import type { NextRequest } from 'next/server';

/**
 * Same-origin proxy to the NestJS API, so auth cookies stay first-party and
 * host-only on the academy domain. Reads API_INTERNAL_URL at runtime (a
 * next.config rewrite would freeze it at build time). In production the
 * reverse proxy (Caddy) sends /api/* straight to the API and this is unused.
 */
export const dynamic = 'force-dynamic';

const HOP_BY_HOP = ['connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'host', 'content-length'];

async function proxy(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const base = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';
  const target = `${base}/api/${path.map(encodeURIComponent).join('/')}${req.nextUrl.search}`;

  const headers = new Headers(req.headers);
  for (const h of HOP_BY_HOP) headers.delete(h);
  headers.set('x-forwarded-host', req.headers.get('host') ?? '');
  headers.set('x-forwarded-proto', req.nextUrl.protocol.replace(':', ''));

  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: req.method,
      headers,
      body: hasBody ? req.body : undefined,
      redirect: 'manual',
      cache: 'no-store',
      // Required by undici when streaming a request body.
      ...(hasBody ? { duplex: 'half' } : {}),
    } as RequestInit);
  } catch {
    return Response.json({ statusCode: 502, message: 'API unavailable' }, { status: 502 });
  }

  const out = new Headers(upstream.headers);
  // fetch() already decompressed the body.
  out.delete('content-encoding');
  out.delete('content-length');
  return new Response(upstream.body, { status: upstream.status, headers: out });
}

export { proxy as GET, proxy as POST, proxy as PUT, proxy as PATCH, proxy as DELETE };

import type { NextRequest } from 'next/server';

/**
 * Same-origin proxy to the NestJS API, so auth cookies stay first-party and
 * host-only on the academy domain. Reads API_INTERNAL_URL at runtime (a
 * next.config rewrite would freeze it at build time). In production the
 * reverse proxy (Caddy) sends /api/* straight to the API and this is unused.
 */
export const dynamic = 'force-dynamic';

const HOP_BY_HOP = [
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
];
/** Client-supplied forwarding headers are untrusted; we set our own. */
const SPOOFABLE = ['x-forwarded-for', 'x-real-ip', 'forwarded', 'x-forwarded-host', 'x-forwarded-proto'];

/**
 * The client IP as reported by the nearest trusted hop. This is only reliable
 * behind a reverse proxy that rewrites X-Forwarded-For (Caddy does): Next.js
 * fills the header from the socket only when it is absent, so with Next as the
 * edge a client could choose this value. Production routes /api straight from
 * Caddy to the API, so rate limiting never depends on this proxy.
 */
function clientIp(req: NextRequest): string | null {
  const parts = (req.headers.get('x-forwarded-for') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return parts.at(-1) ?? null;
}

async function proxy(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const base = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';
  const target = `${base}/api/${path.map(encodeURIComponent).join('/')}${req.nextUrl.search}`;

  const headers = new Headers(req.headers);
  const ip = clientIp(req);
  const proto = req.headers.get('x-forwarded-proto') ?? req.nextUrl.protocol.replace(':', '');
  for (const h of [...HOP_BY_HOP, ...SPOOFABLE, 'host', 'content-length']) headers.delete(h);
  if (ip) headers.set('x-forwarded-for', ip);
  headers.set('x-forwarded-host', req.headers.get('host') ?? '');
  headers.set('x-forwarded-proto', proto === 'https' ? 'https' : 'http');

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
  for (const h of HOP_BY_HOP) out.delete(h);
  // fetch() already decompressed the body.
  out.delete('content-encoding');
  out.delete('content-length');
  return new Response(upstream.body, { status: upstream.status, headers: out });
}

export { proxy as GET, proxy as POST, proxy as PUT, proxy as PATCH, proxy as DELETE };

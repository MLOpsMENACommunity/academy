import { Container } from '@cloudflare/containers';
import { cacheKind, localeCookie, storableCacheControl, type CacheKind } from './edge-cache';
import { MAIN_INSTANCE, webInstanceCount, webInstanceName } from './instances';

/**
 * Entry Worker for academy on Cloudflare.
 *
 *   https://<host>/api/*  ->  ApiContainer (NestJS, apps/api/Dockerfile)
 *   https://<host>/*      ->  WebContainer (Next.js, apps/web/Dockerfile)
 *   http://*, other hosts ->  301/308 to https://<host>
 *   Cron Trigger          ->  POST /api/internal/jobs/tick on the API (containers sleep when idle)
 *
 * One API instance (max_instances: 1): rate limits and the login lockout are in-memory
 * in the API. The web app is stateless, so requests are spread over WEB_INSTANCES
 * containers (each with its own ISR cache; they converge within the revalidate window).
 * Anonymous page views of static/ISR pages are answered from Cloudflare's edge cache
 * when possible: see edge-cache.ts for exactly what is and isn't cached.
 * Secrets come from `wrangler secret put` and are handed to the containers as
 * environment variables at start.
 */
export interface Env {
  API: DurableObjectNamespace<ApiContainer>;
  WEB: DurableObjectNamespace<WebContainer>;
  // vars
  ACADEMY_HOSTNAME: string;
  EMAIL_FROM: string;
  S3_BUCKET: string;
  /** How many web containers to spread requests over (<= the WebContainer max_instances). */
  WEB_INSTANCES?: string;
  /** Idle time before a container sleeps (default 2h; staging uses less so it sleeps between hourly crons). */
  SLEEP_AFTER?: string;
  /** Staging only: see EMAIL_ALLOWLIST / EMAIL_REDIRECT_TO in apps/api/src/config/env.ts. */
  EMAIL_ALLOWLIST?: string;
  EMAIL_REDIRECT_TO?: string;
  // secrets
  DATABASE_URL: string;
  /** Unpooled connection, used only for migrations at container start. */
  DIRECT_DATABASE_URL?: string;
  JWT_ACCESS_SECRET: string;
  JOBS_TOKEN: string;
  RESEND_API_KEY: string;
  S3_ENDPOINT: string;
  S3_ACCESS_KEY_ID: string;
  S3_SECRET_ACCESS_KEY: string;
  SEED_ADMIN_EMAIL: string;
  SEED_ADMIN_PASSWORD: string;
  SEED_PLACEHOLDER_STATUS?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  SENTRY_DSN?: string;
  SENTRY_ENVIRONMENT?: string;
}

const optional = (pairs: Record<string, string | undefined>): Record<string, string> =>
  Object.fromEntries(Object.entries(pairs).filter((e): e is [string, string] => Boolean(e[1])));

/**
 * Restarts a running container when its configuration changes (new hostname, rotated
 * secret): env vars are only read when a container starts, so without this a config-only
 * deploy would keep serving with the old values until the container next slept.
 * Only a hash of the configuration is stored.
 */
async function restartIfConfigChanged(container: Container<Env>, ctx: DurableObjectState<Env>): Promise<void> {
  const bytes = new TextEncoder().encode(JSON.stringify(container.envVars));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const key = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  const previous = await ctx.storage.get<string>('configKey');
  if (previous !== key) {
    // Also on the first run of this code (no stored hash): one harmless restart picks up the current config.
    if (ctx.container?.running) await container.destroy();
    await ctx.storage.put('configKey', key);
  }
}

export class ApiContainer extends Container<Env> {
  defaultPort = 4000;
  constructor(ctx: DurableObjectState<Env>, env: Env) {
    super(ctx, env);
    // Long enough that a launch day (or a quiet evening) doesn't pay cold starts.
    this.sleepAfter = env.SLEEP_AFTER || '2h';
    this.envVars = {
      NODE_ENV: 'production',
      PORT: '4000',
      WEB_URL: `https://${env.ACADEMY_HOSTNAME}`,
      DATABASE_URL: env.DATABASE_URL,
      JWT_ACCESS_SECRET: env.JWT_ACCESS_SECRET,
      JOBS_TOKEN: env.JOBS_TOKEN,
      // In-process cron is off: the Worker's Cron Trigger drives jobs.
      JOBS_ENABLED: 'false',
      EMAIL_PROVIDER: 'resend',
      EMAIL_FROM: env.EMAIL_FROM,
      RESEND_API_KEY: env.RESEND_API_KEY,
      S3_ENDPOINT: env.S3_ENDPOINT,
      S3_REGION: 'auto',
      S3_BUCKET: env.S3_BUCKET,
      S3_ACCESS_KEY_ID: env.S3_ACCESS_KEY_ID,
      S3_SECRET_ACCESS_KEY: env.S3_SECRET_ACCESS_KEY,
      S3_FORCE_PATH_STYLE: 'true',
      S3_CREATE_BUCKET: 'false',
      SEED_ADMIN_EMAIL: env.SEED_ADMIN_EMAIL,
      SEED_ADMIN_PASSWORD: env.SEED_ADMIN_PASSWORD,
      RUN_MIGRATIONS: 'true',
      RUN_SEED: 'true',
      ...optional({
        SEED_PLACEHOLDER_STATUS: env.SEED_PLACEHOLDER_STATUS,
        GOOGLE_CLIENT_ID: env.GOOGLE_CLIENT_ID,
        GOOGLE_CLIENT_SECRET: env.GOOGLE_CLIENT_SECRET,
        DIRECT_DATABASE_URL: env.DIRECT_DATABASE_URL,
        SENTRY_DSN: env.SENTRY_DSN,
        SENTRY_ENVIRONMENT: env.SENTRY_ENVIRONMENT,
        EMAIL_ALLOWLIST: env.EMAIL_ALLOWLIST,
        EMAIL_REDIRECT_TO: env.EMAIL_REDIRECT_TO,
      }),
    };
    void ctx.blockConcurrencyWhile(() => restartIfConfigChanged(this, ctx));
  }
}

export class WebContainer extends Container<Env> {
  defaultPort = 3000;

  constructor(ctx: DurableObjectState<Env>, env: Env) {
    super(ctx, env);
    this.sleepAfter = env.SLEEP_AFTER || '2h';
    this.envVars = {
      NODE_ENV: 'production',
      // Server-side fetches go back through the public hostname (and this Worker) to the API.
      API_INTERNAL_URL: `https://${env.ACADEMY_HOSTNAME}`,
    };
    void ctx.blockConcurrencyWhile(() => restartIfConfigChanged(this, ctx));
  }
}

const INSTANCE = MAIN_INSTANCE;

/** A random one of the WEB_INSTANCES web containers (see instances.ts). Every instance serves every page. */
function pickWebInstance(env: Env): number {
  return Math.floor(Math.random() * webInstanceCount(env.WEB_INSTANCES));
}

/** Forwarded headers are set here, never trusted from the client. */
function forwardable(request: Request): Request {
  const headers = new Headers(request.headers);
  for (const h of ['x-forwarded-for', 'x-real-ip', 'forwarded', 'x-forwarded-proto', 'x-forwarded-host']) headers.delete(h);
  const ip = request.headers.get('cf-connecting-ip');
  if (ip) headers.set('x-forwarded-for', ip);
  headers.set('x-forwarded-proto', 'https');
  headers.set('x-forwarded-host', new URL(request.url).host);
  return new Request(request, { headers });
}

/** A container that can't be reached (starting, overloaded, restarting) answers 503, not an opaque 500. */
async function fromContainer(stub: { fetch(request: Request): Promise<Response> }, request: Request, name: string): Promise<Response> {
  try {
    return await stub.fetch(forwardable(request));
  } catch (err) {
    console.error(`${name} container fetch failed: ${(err as Error).message}`);
    return new Response('The academy is busy, please try again in a moment.', {
      status: 503,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'retry-after': '5', 'cache-control': 'no-store' },
    });
  }
}

function withHeaders(response: Response, set: Record<string, string>, append: Record<string, string | null> = {}): Response {
  const out = new Response(response.body, response);
  for (const [k, v] of Object.entries(set)) out.headers.set(k, v);
  for (const [k, v] of Object.entries(append)) if (v) out.headers.append(k, v);
  return out;
}

/**
 * One web request to a random instance. During a rolling deploy instances run different
 * builds for a while, and a build asset (/_next/static/<hash>) exists only on the build
 * that made it: a 404 for one is retried on the other instances before it is returned.
 */
async function webFetch(request: Request, env: Env, kind: CacheKind | null): Promise<Response> {
  const count = webInstanceCount(env.WEB_INSTANCES);
  const first = pickWebInstance(env);
  let response = await fromContainer(env.WEB.getByName(webInstanceName(first)), request, 'web');
  if (kind !== 'asset' || response.status !== 404) return response;
  for (let k = 1; k < count; k++) {
    await response.body?.cancel();
    const retry = await fromContainer(env.WEB.getByName(webInstanceName((first + k) % count)), request, 'web');
    if (retry.ok) return retry;
    response = retry;
  }
  return response;
}

/** Web requests, through the edge cache where edge-cache.ts allows it. */
async function web(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const kind: CacheKind | null = cacheKind(request);
  if (!kind) return withHeaders(await webFetch(request, env, null), { 'x-edge-cache': 'BYPASS' });

  const cache = caches.default;
  // Only the URL: never the visitor's cookies or other headers.
  const key = new Request(request.url, { method: 'GET' });
  const hit = await cache.match(key);
  if (hit) return withHeaders(hit, { 'x-edge-cache': 'HIT' }, { 'set-cookie': kind === 'page' ? localeCookie(request) : null });

  const response = await webFetch(request, env, kind);
  const cacheControl = storableCacheControl(kind, response);
  if (!cacheControl) return withHeaders(response, { 'x-edge-cache': 'MISS' });
  const stored = withHeaders(response.clone(), { 'cache-control': cacheControl });
  ctx.waitUntil(cache.put(key, stored));
  return withHeaders(response, { 'x-edge-cache': 'MISS' });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    // Old or alternative hostnames (e.g. staging after going live) redirect to the canonical one,
    // and plain http to https. Some calendar clients turn webcal:// into http://, and the private
    // feed URL is a bearer credential: the redirect answers before anything reaches the API.
    // (The cron handler talks to the API container directly and never passes through here.)
    if (url.hostname !== env.ACADEMY_HOSTNAME || url.protocol === 'http:') {
      url.hostname = env.ACADEMY_HOSTNAME;
      url.protocol = 'https:';
      url.port = '';
      const permanent = request.method === 'GET' || request.method === 'HEAD' ? 301 : 308;
      return Response.redirect(url.toString(), permanent);
    }
    const isApi = url.pathname === '/api' || url.pathname.startsWith('/api/');
    if (isApi && url.pathname.startsWith('/api/internal/')) {
      // Internal endpoints are only reachable from the cron handler below.
      return new Response('Not found', { status: 404 });
    }
    if (isApi) return fromContainer(env.API.getByName(INSTANCE), request, 'api');
    return web(request, env, ctx);
  },

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      env.API.getByName(INSTANCE)
        .fetch(
          new Request(`https://${env.ACADEMY_HOSTNAME}/api/internal/jobs/tick`, {
            method: 'POST',
            headers: { 'x-jobs-token': env.JOBS_TOKEN },
          }),
        )
        // eslint-disable-next-line no-console -- Workers logs are the record of each tick
        .then(async (res) => console.log(`jobs tick: ${res.status} ${await res.text()}`))
        .catch((err: unknown) => console.error(`jobs tick failed: ${(err as Error).message}`)),
    );
  },
} satisfies ExportedHandler<Env>;

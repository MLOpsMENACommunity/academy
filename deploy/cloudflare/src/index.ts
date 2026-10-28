import { Container } from '@cloudflare/containers';
import { fetchContainer, timeoutFor } from './container-fetch';
import { browserCacheControl, cacheKind, EDGE_TAG, localeCookie, storableCacheControl, storedCopy, type CacheKind } from './edge-cache';
import { isInternalApiPath, isManualJobsTick, tokenMatches } from './jobs';
import { MAIN_INSTANCE, webInstanceCount, webInstanceName } from './instances';
import { isRevalidateRequest, purgeRequest, REVALIDATE_HEADER, REVALIDATE_PATH, revalidateToken, WEB_REVALIDATE_URL } from './revalidate';
import { disallowAllRobots, isProduction, withNoindex } from './robots';
import { stagingDatabaseProblem, stagingMisconfigured } from './staging-guard';

/**
 * Entry Worker for academy on Cloudflare.
 *
 *   https://<host>/api/*  ->  ApiContainer (NestJS, apps/api/Dockerfile)
 *   https://<host>/*      ->  WebContainer (Next.js, apps/web/Dockerfile)
 *   http://*, other hosts ->  301/308 to https://<host>
 *   Cron Trigger          ->  POST /api/internal/jobs/tick on the API (containers sleep when idle;
 *                             production only, staging runs jobs on demand: see jobs.ts)
 *   not production        ->  robots.txt "Disallow: /", X-Robots-Tag: noindex on everything (robots.ts)
 *
 * One API instance (max_instances: 1): rate limits and the login lockout are in-memory
 * in the API. The web app is stateless, so requests are spread over WEB_INSTANCES
 * containers, each with its own ISR cache: after an admin edit the API calls
 * POST /_internal/revalidate here, which revalidates every running one and purges the edge
 * (revalidate.ts), so the edit shows within seconds.
 * Anonymous page views of static/ISR pages, and anonymous reads of the public catalog API,
 * are answered from Cloudflare's edge cache when possible: see edge-cache.ts for exactly
 * what is and isn't cached. Container failures and stuck requests become a 503 with
 * Retry-After, never a hang or an opaque 500: see container-fetch.ts.
 * Secrets come from `wrangler secret put` and are handed to the containers as
 * environment variables at start.
 */
export interface Env {
  API: DurableObjectNamespace<ApiContainer>;
  WEB: DurableObjectNamespace<WebContainer>;
  // vars
  /** "production" or "staging" (set per target by configure-host.mjs). Only production is indexed. */
  ACADEMY_ENVIRONMENT?: string;
  ACADEMY_HOSTNAME: string;
  EMAIL_FROM: string;
  S3_BUCKET: string;
  /** How many web containers to spread requests over (<= the WebContainer max_instances). */
  WEB_INSTANCES?: string;
  /** Idle time before a container sleeps (default 2h; staging uses less so it sleeps between hourly crons). */
  SLEEP_AFTER?: string;
  /** The deployed commit (set by configure-host.mjs from SHA). Part of the containers' config, so a deploy restarts them. */
  ACADEMY_RELEASE?: string;
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
  GOOGLE_DRIVE_SERVICE_ACCOUNT?: string;
  SENTRY_DSN?: string;
  SENTRY_ENVIRONMENT?: string;
  /** Optional: the revalidation secret (otherwise derived from JOBS_TOKEN, see revalidate.ts). */
  REVALIDATE_TOKEN?: string;
  /** Optional var (configure-host.mjs): the zone of ACADEMY_HOSTNAME, for purging the edge cache after an edit. */
  EDGE_PURGE_ZONE_ID?: string;
  /** Optional secret: a Cloudflare API token with Zone → Cache Purge on that zone. */
  EDGE_PURGE_API_TOKEN?: string;
}

const optional = (pairs: Record<string, string | undefined>): Record<string, string> =>
  Object.fromEntries(Object.entries(pairs).filter((e): e is [string, string] => Boolean(e[1])));

/**
 * Restarts a running container when its configuration changes (new hostname, rotated
 * secret, or a new release: ACADEMY_RELEASE is the deployed commit, so every deploy of new
 * code counts): env vars are only read when a container starts, so without this a deploy
 * would keep serving the old container until it next slept or the rollout replaced it.
 * Only a hash of the configuration is stored.
 */
async function restartIfConfigChanged(container: Container<Env>, ctx: DurableObjectState<Env>): Promise<void> {
  const bytes = new TextEncoder().encode(JSON.stringify(container.envVars));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const key = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  const previous = await ctx.storage.get<string>('configKey');
  if (previous !== key) {
    // Also on the first run of this code (no stored hash): one harmless restart picks up the current config.
    if (ctx.container?.running) await stopGracefully(container, ctx);
    await ctx.storage.put('configKey', key);
  }
}

/** The API drains in-flight requests for up to 10 s on SIGTERM (apps/api/src/main.ts). */
const STOP_GRACE_MS = 12_000;

/**
 * SIGTERM first, so requests in progress finish and the database pool closes cleanly; a kill
 * only if the container is still up after STOP_GRACE_MS. Requests arriving meanwhile wait (this
 * runs inside blockConcurrencyWhile) and then start the new container.
 */
async function stopGracefully(container: Container<Env>, ctx: DurableObjectState<Env>): Promise<void> {
  try {
    await container.stop('SIGTERM');
    const deadline = Date.now() + STOP_GRACE_MS;
    while (ctx.container?.running && Date.now() < deadline) await new Promise((r) => setTimeout(r, 250));
  } catch {
    // fall through to destroy
  }
  if (ctx.container?.running) await container.destroy();
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
      // After an admin edit the API asks this Worker to revalidate the public pages (revalidate.ts).
      REVALIDATE_URL: `https://${env.ACADEMY_HOSTNAME}${REVALIDATE_PATH}`,
      ...optional({
        SEED_PLACEHOLDER_STATUS: env.SEED_PLACEHOLDER_STATUS,
        GOOGLE_CLIENT_ID: env.GOOGLE_CLIENT_ID,
        GOOGLE_CLIENT_SECRET: env.GOOGLE_CLIENT_SECRET,
        GOOGLE_DRIVE_SERVICE_ACCOUNT: env.GOOGLE_DRIVE_SERVICE_ACCOUNT,
        DIRECT_DATABASE_URL: env.DIRECT_DATABASE_URL,
        SENTRY_DSN: env.SENTRY_DSN,
        SENTRY_ENVIRONMENT: env.SENTRY_ENVIRONMENT,
        ACADEMY_RELEASE: env.ACADEMY_RELEASE,
        EMAIL_ALLOWLIST: env.EMAIL_ALLOWLIST,
        EMAIL_REDIRECT_TO: env.EMAIL_REDIRECT_TO,
      }),
    };
    void ctx.blockConcurrencyWhile(async () => {
      await withRevalidateToken(this, env);
      await restartIfConfigChanged(this, ctx);
    });
  }
}

/** Adds REVALIDATE_TOKEN to a container's environment (async: it may be derived with Web Crypto). */
async function withRevalidateToken(container: Container<Env>, env: Env): Promise<void> {
  const token = await revalidateToken(env);
  if (token) container.envVars = { ...container.envVars, REVALIDATE_TOKEN: token };
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
      ...optional({ ACADEMY_RELEASE: env.ACADEMY_RELEASE }),
    };
    void ctx.blockConcurrencyWhile(async () => {
      await withRevalidateToken(this, env);
      await restartIfConfigChanged(this, ctx);
    });
  }

  /**
   * Revalidates this container's pages if it is running (RPC from the Worker). A sleeping one
   * is left asleep: it starts from its image with nothing cached. Talks to the port directly,
   * so it neither starts the container nor counts as activity that keeps it awake.
   */
  async revalidate(token: string): Promise<string> {
    const running = this.ctx.container;
    if (!running?.running) return 'asleep';
    try {
      const res = await running.getTcpPort(this.defaultPort).fetch(WEB_REVALIDATE_URL, {
        method: 'POST',
        headers: { [REVALIDATE_HEADER]: token },
        signal: AbortSignal.timeout(10_000),
      });
      await res.body?.cancel();
      return String(res.status);
    } catch (err) {
      // Still starting (it will render fresh anyway), or stuck: its pages catch up within 60 s.
      return `unreachable (${(err as Error).name})`;
    }
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

/**
 * A container that can't be reached (starting, restarting, overloaded) or doesn't answer in
 * time gets a 503 with Retry-After, logged as a warning: never a hang, never an opaque 500.
 */
async function fromContainer(stub: { fetch(request: Request): Promise<Response> }, request: Request, name: string): Promise<Response> {
  const forwarded = forwardable(request);
  const { response } = await fetchContainer(() => stub.fetch(forwarded), { ms: timeoutFor(request.method, new URL(request.url).pathname), name });
  return response;
}

function withHeaders(response: Response, set: Record<string, string | null>, append: Record<string, string | null> = {}): Response {
  const out = new Response(response.body, response);
  for (const [k, v] of Object.entries(set)) if (v !== null) out.headers.set(k, v);
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

/** One request through the edge cache, where edge-cache.ts allows it; `origin` fetches from a container. */
async function throughEdgeCache(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  origin: (kind: CacheKind | null) => Promise<Response>,
): Promise<Response> {
  const kind: CacheKind | null = cacheKind(request);
  if (!kind) return withHeaders(await origin(null), { 'x-edge-cache': 'BYPASS' });

  const cache = caches.default;
  // Only the URL: never the visitor's cookies or other headers.
  const key = new Request(request.url, { method: 'GET' });
  const hit = await cache.match(key);
  if (hit) {
    const out = withHeaders(
      hit,
      { 'x-edge-cache': 'HIT', 'cache-control': browserCacheControl(kind, hit.headers.get('cache-control')) },
      { 'set-cookie': kind === 'page' ? localeCookie(request) : null },
    );
    // The purge tag is for Cloudflare, not for visitors.
    out.headers.delete('cache-tag');
    return out;
  }

  const response = await origin(kind);
  // With the purge configured an edit clears every copy, so copies can live much longer (edge-cache.ts).
  const cacheControl = storableCacheControl(kind, response, purgeRequest(env, EDGE_TAG) !== null);
  if (!cacheControl) return withHeaders(response, { 'x-edge-cache': 'MISS' });
  // Stored without Set-Cookie; the visitor still gets the response as the container sent it.
  const stored = storedCopy(response.clone(), cacheControl, kind);
  ctx.waitUntil(cache.put(key, stored));
  return withHeaders(response, { 'x-edge-cache': 'MISS', 'cache-control': browserCacheControl(kind, response.headers.get('cache-control')) });
}

/** Web requests, through the edge cache where edge-cache.ts allows it. */
function web(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  return throughEdgeCache(request, env, ctx, (kind) => webFetch(request, env, kind));
}

/** API requests: anonymous public catalog reads through the edge cache, everything else straight through. */
function api(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  return throughEdgeCache(request, env, ctx, () => fromContainer(env.API.getByName(INSTANCE), request, 'api'));
}

/** POSTs /api/internal/jobs/tick to the API container (the cron, or a manual run on staging). */
async function jobsTick(env: Env): Promise<Response> {
  const tick = new Request(`https://${env.ACADEMY_HOSTNAME}/api/internal/jobs/tick`, {
    method: 'POST',
    headers: { 'x-jobs-token': env.JOBS_TOKEN },
  });
  const { response } = await fetchContainer(() => env.API.getByName(INSTANCE).fetch(tick), { ms: 5 * 60_000, name: 'api (jobs tick)' });
  return response;
}

/**
 * POST /_internal/revalidate from the API after an admin edit (revalidate.ts): every running web
 * container drops its cached pages, then the edge copies are purged, in that order (purging
 * first could let a visitor put a page from a not-yet-revalidated container back at the edge).
 */
async function revalidateSite(request: Request, env: Env): Promise<Response> {
  const token = await revalidateToken(env);
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: { allow: 'POST' } });
  if (!token || !tokenMatches(request.headers.get(REVALIDATE_HEADER), token)) return new Response('Forbidden', { status: 403 });
  const count = webInstanceCount(env.WEB_INSTANCES);
  const web: Record<string, string> = {};
  await Promise.all(
    Array.from({ length: count }, async (_, i) => {
      const name = webInstanceName(i);
      web[name] = await env.WEB.getByName(name)
        .revalidate(token)
        .catch((err: unknown) => `failed (${(err as Error).name})`);
    }),
  );
  let edge = 'not configured: edge copies expire within 30 s';
  const purge = purgeRequest(env, EDGE_TAG);
  if (purge) {
    try {
      const res = await fetch(purge);
      edge = res.ok ? 'purged' : `purge failed (${res.status})`;
      await res.body?.cancel();
    } catch (err) {
      edge = `purge failed (${(err as Error).name})`;
    }
  }
  const failed = Object.values(web).some((s) => s !== '200' && s !== 'asleep') || edge.startsWith('purge failed');
  if (failed) console.warn(`revalidate: ${JSON.stringify({ web, edge })}`);
  return Response.json({ web, edge }, { headers: { 'cache-control': 'no-store' } });
}

/** Routes one request. Non-production deployments are kept out of search engines in fetch() below. */
async function route(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
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
  if (isRevalidateRequest(request)) return revalidateSite(request, env);
  const isApi = url.pathname === '/api' || url.pathname.startsWith('/api/');
  if (isApi && isInternalApiPath(url.pathname)) {
    // Internal endpoints are only reachable from the cron handler below. Same body as the API's own 404.
    return Response.json({ statusCode: 404, message: 'Not found' }, { status: 404 });
  }
  if (isApi) return api(request, env, ctx);
  return web(request, env, ctx);
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (isProduction(env.ACADEMY_ENVIRONMENT)) return route(request, env, ctx);
    // Staging (anything not production): never indexed. See robots.ts.
    if (new URL(request.url).pathname === '/robots.txt') return disallowAllRobots();
    // Staging never runs against production's database: no container starts until its
    // database secrets are staging's own (staging-guard.ts).
    const problem = env.ACADEMY_ENVIRONMENT === 'staging' ? stagingDatabaseProblem(env) : null;
    if (problem) {
      console.error(`staging guard: ${problem}; set it with deploy/cloudflare/set-worker-secret.sh staging`);
      return withNoindex(stagingMisconfigured());
    }
    // Staging has no cron: jobs run on demand, with the jobs token (see jobs.ts and DEPLOY.md).
    if (isManualJobsTick(request)) {
      if (!tokenMatches(request.headers.get('x-jobs-token'), env.JOBS_TOKEN)) return new Response('Forbidden', { status: 403 });
      const res = await jobsTick(env);
      return new Response(res.body, { status: res.status, headers: { 'content-type': res.headers.get('content-type') ?? 'text/plain', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } });
    }
    return withNoindex(await route(request, env, ctx));
  },

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      jobsTick(env)
        // eslint-disable-next-line no-console -- Workers logs are the record of each tick
        .then(async (res) => console.log(`jobs tick: ${res.status} ${await res.text()}`))
        .catch((err: unknown) => console.error(`jobs tick failed: ${(err as Error).message}`)),
    );
  },
} satisfies ExportedHandler<Env>;

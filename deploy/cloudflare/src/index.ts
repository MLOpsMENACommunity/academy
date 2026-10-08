import { Container } from '@cloudflare/containers';

/**
 * Entry Worker for academy on Cloudflare.
 *
 *   https://<host>/api/*  ->  ApiContainer (NestJS, apps/api/Dockerfile)
 *   https://<host>/*      ->  WebContainer (Next.js, apps/web/Dockerfile)
 *   Cron Trigger          ->  POST /api/internal/jobs/tick on the API (containers sleep when idle)
 *
 * One instance of each (max_instances: 1): rate limits and the login lockout
 * are in-memory in the API. Secrets come from `wrangler secret put` and are
 * handed to the containers as environment variables at start.
 */
export interface Env {
  API: DurableObjectNamespace<ApiContainer>;
  WEB: DurableObjectNamespace<WebContainer>;
  // vars
  ACADEMY_HOSTNAME: string;
  EMAIL_FROM: string;
  S3_BUCKET: string;
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
  sleepAfter = '30m';

  constructor(ctx: DurableObjectState<Env>, env: Env) {
    super(ctx, env);
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
  sleepAfter = '30m';

  constructor(ctx: DurableObjectState<Env>, env: Env) {
    super(ctx, env);
    this.envVars = {
      NODE_ENV: 'production',
      // Server-side fetches go back through the public hostname (and this Worker) to the API.
      API_INTERNAL_URL: `https://${env.ACADEMY_HOSTNAME}`,
    };
    void ctx.blockConcurrencyWhile(() => restartIfConfigChanged(this, ctx));
  }
}

const INSTANCE = 'main';

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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    // Old or alternative hostnames (e.g. staging after going live) redirect to the canonical one.
    if (url.hostname !== env.ACADEMY_HOSTNAME) {
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
    const target = isApi ? env.API.getByName(INSTANCE) : env.WEB.getByName(INSTANCE);
    return target.fetch(forwardable(request));
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

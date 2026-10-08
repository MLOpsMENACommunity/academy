import { Container } from '@cloudflare/containers';

/**
 * Entry Worker for academy on Cloudflare.
 *
 *   https://<host>/api/*  ->  ApiContainer (NestJS, apps/api/Dockerfile)
 *   https://<host>/*      ->  WebContainer (Next.js, apps/web/Dockerfile)
 *   Cron Trigger (hourly) ->  POST /api/internal/jobs/tick on the API
 *
 * One instance of each (max_instances: 1): rate limits and the login lockout
 * are in-memory in the API. Containers sleep after 10 idle minutes.
 *
 * Secrets reach a container only when it starts. Every deploy passes a new
 * CONFIG_VERSION; a container that started under an older version is stopped
 * on its next request and starts again with the current secrets.
 * Migrations and the seed run in the deploy workflow, not on container start.
 */
export interface Env {
  API: DurableObjectNamespace<ApiContainer>;
  WEB: DurableObjectNamespace<WebContainer>;
  // vars
  ACADEMY_HOSTNAME: string;
  EMAIL_FROM: string;
  S3_BUCKET: string;
  CONFIG_VERSION: string;
  // secrets
  DATABASE_URL: string;
  JWT_ACCESS_SECRET: string;
  JOBS_TOKEN: string;
  RESEND_API_KEY: string;
  S3_ENDPOINT: string;
  S3_ACCESS_KEY_ID: string;
  S3_SECRET_ACCESS_KEY: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  SENTRY_DSN?: string;
}

const optional = (pairs: Record<string, string | undefined>): Record<string, string> =>
  Object.fromEntries(Object.entries(pairs).filter((e): e is [string, string] => Boolean(e[1])));

/** Restarts a running container whose environment is older than the current deploy. */
abstract class VersionedContainer extends Container<Env> {
  sleepAfter = '10m';
  protected readonly configVersion: string;

  constructor(ctx: DurableObjectState<Env>, env: Env) {
    super(ctx, env);
    this.configVersion = env.CONFIG_VERSION || 'unversioned';
  }

  override async onStart(): Promise<void> {
    await this.ctx.storage.put('configVersion', this.configVersion);
  }

  override async fetch(request: Request): Promise<Response> {
    const state = await this.getState();
    if (state.status === 'running' || state.status === 'healthy') {
      const startedWith = await this.ctx.storage.get<string>('configVersion');
      if (startedWith !== this.configVersion) await this.stop();
    }
    return super.fetch(request);
  }
}

export class ApiContainer extends VersionedContainer {
  defaultPort = 4000;

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
      // Done by the deploy workflow (direct DB connection), keeping cold starts short.
      RUN_MIGRATIONS: 'false',
      RUN_SEED: 'false',
      ...optional({
        GOOGLE_CLIENT_ID: env.GOOGLE_CLIENT_ID,
        GOOGLE_CLIENT_SECRET: env.GOOGLE_CLIENT_SECRET,
        SENTRY_DSN: env.SENTRY_DSN,
      }),
    };
  }
}

export class WebContainer extends VersionedContainer {
  defaultPort = 3000;

  constructor(ctx: DurableObjectState<Env>, env: Env) {
    super(ctx, env);
    this.envVars = {
      NODE_ENV: 'production',
      // Server-side fetches go back through the public hostname (and this Worker) to the API.
      API_INTERNAL_URL: `https://${env.ACADEMY_HOSTNAME}`,
    };
  }
}

const INSTANCE = 'main';

/** Forwarded headers are set here, never trusted from the client. */
function forwardable(request: Request): Request {
  const headers = new Headers(request.headers);
  for (const h of ['x-forwarded-for', 'x-real-ip', 'forwarded', 'x-forwarded-proto', 'x-forwarded-host', 'x-jobs-token']) {
    headers.delete(h);
  }
  const ip = request.headers.get('cf-connecting-ip');
  if (ip) headers.set('x-forwarded-for', ip);
  headers.set('x-forwarded-proto', 'https');
  headers.set('x-forwarded-host', new URL(request.url).host);
  return new Request(request, { headers });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Express routes case-insensitively, so compare lower-cased and decoded.
    let path = new URL(request.url).pathname;
    try {
      path = decodeURIComponent(path);
    } catch {
      return new Response('Bad request', { status: 400 });
    }
    path = path.toLowerCase().replace(/\/{2,}/g, '/');
    const isApi = path === '/api' || path.startsWith('/api/');
    // Internal endpoints are only reachable from the cron handler below.
    if (path.startsWith('/api/internal')) return new Response('Not found', { status: 404 });
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

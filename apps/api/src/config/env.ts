import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

/** All configuration comes from the environment and is validated once at boot. */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  DATABASE_URL: z.string().min(1),
  /**
   * Prisma's connection pool. Its default is 2 x CPUs + 1, which is 3 on a small container,
   * so a burst of requests queues for a connection and fails after 10 s (P2024). Neon's
   * pooler takes thousands of client connections, so a bigger pool is safe. A
   * connection_limit / pool_timeout already in DATABASE_URL wins.
   */
  DATABASE_POOL_SIZE: z.coerce.number().int().min(1).max(100).default(10),
  /**
   * Seconds a query waits for a free connection before failing with P2024, which the API
   * answers with a fast 503 + Retry-After (common/busy.ts). Short on purpose: under overload a
   * long wait only makes every request hang that long before failing anyway.
   */
  DATABASE_POOL_TIMEOUT: z.coerce.number().int().min(0).max(120).default(5),

  /** Public origin of the academy (Next.js). Used in emails, redirects and CORS. */
  WEB_URL: z.string().url().default('http://localhost:3000'),
  /** Extra comma-separated origins allowed by CORS (the web app talks to the API same-origin through a rewrite). */
  CORS_ORIGINS: z.string().default(''),

  JWT_ACCESS_SECRET: z.string().min(32).default('dev-only-access-secret-change-me-please-32+'),
  ACCESS_TOKEN_TTL_MIN: z.coerce.number().int().default(15),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().default(30),
  /** Leave empty for host-only cookies on the academy domain. */
  COOKIE_DOMAIN: z.string().optional(),
  COOKIE_SECURE: bool.optional(),

  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),

  /**
   * Telegram course groups (telegram/): the bot's token from BotFather, and the secret Telegram
   * sends with every webhook call (its `secret_token`). Both are needed; without them the feature is off.
   */
  TELEGRAM_BOT_TOKEN: z.string().regex(/^\d+:[\w-]{20,}$/, 'expected a BotFather token (123456:ABC…)').optional(),
  TELEGRAM_WEBHOOK_SECRET: z.string().regex(/^[\w-]{32,256}$/, '32–256 letters, digits, _ or -').optional(),

  EMAIL_PROVIDER: z.enum(['smtp', 'resend', 'log']).default('smtp'),
  EMAIL_FROM: z.string().default('MLOps MENA Academy <academy@mlopsmena.com>'),
  /** Minimum gap between provider calls; defaults to 550 ms for Resend (2 requests/s account limit), 0 otherwise. */
  EMAIL_MIN_INTERVAL_MS: z.coerce.number().int().min(0).max(10_000).optional(),
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().int().default(1025),
  RESEND_API_KEY: z.string().optional(),
  /**
   * Non-production safety net (set on staging only). Mail to anyone not on EMAIL_ALLOWLIST
   * (comma-separated addresses or "@domain" entries) goes to EMAIL_REDIRECT_TO instead, with
   * the original recipient in the subject; with no EMAIL_REDIRECT_TO it is dropped.
   */
  EMAIL_ALLOWLIST: z.string().default(''),
  EMAIL_REDIRECT_TO: z.string().email().optional(),

  S3_ENDPOINT: z.string().url().optional(),
  /** Host used in signed URLs when the API reaches storage on an internal hostname (Docker). */
  S3_PUBLIC_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().default('auto'),
  S3_BUCKET: z.string().default('academy-private'),
  S3_ACCESS_KEY_ID: z.string().default('minioadmin'),
  S3_SECRET_ACCESS_KEY: z.string().default('minioadmin'),
  S3_FORCE_PATH_STYLE: bool.default('true'),
  /** Create the bucket on boot (local MinIO only). */
  S3_CREATE_BUCKET: bool.default('false'),

  SEED_ADMIN_EMAIL: z.string().email().optional(),
  SEED_ADMIN_PASSWORD: z.string().min(10).optional(),

  SENTRY_DSN: z.string().optional(),
  /** Serve Swagger at /api/docs in production too (always on in development). */
  API_DOCS: bool.default('false'),
  /** JSON log lines (default in production, so Cloudflare / Docker logs are machine-readable). */
  LOG_JSON: bool.optional(),
  /** Escape hatch for the local all-in-Docker stack, which runs production builds against MinIO. */
  ALLOW_INSECURE_PRODUCTION: bool.default('false'),
  /** Run scheduled jobs in-process (off on Cloudflare, where containers sleep; a Cron Trigger calls /api/internal/jobs/tick). */
  JOBS_ENABLED: bool.default('true'),
  /** Shared secret for POST /api/internal/jobs/tick. Unset disables the endpoint. */
  JOBS_TOKEN: z.string().min(32).optional(),

  /**
   * Where to ask the public site to revalidate its pages after an admin edit (common/revalidate.ts):
   * the Worker's /_internal/revalidate on Cloudflare, the web app's /api/internal/revalidate
   * locally. Both unset turns it off (pages then catch up within their 60 s revalidation).
   */
  REVALIDATE_URL: z.string().url().optional(),
  /** Shared secret for that call (the web app and the Worker check it). */
  REVALIDATE_TOKEN: z.string().min(32).optional(),

  // ---- Capacity (see DEPLOY.md, "Capacity and caching"). Sized for one ¼-vCPU, 1 GiB container.
  /** Prisma's pgbouncer mode, for a PgBouncer older than 1.21 or without prepared statements (Neon's pooler needs neither; see prisma/database-url.ts). Local only: on Cloudflare add pgbouncer=true to DATABASE_URL instead. */
  DB_PGBOUNCER: bool.default('false'),
  /** In-process cache of anonymous public catalog reads, in seconds (0 turns it off). */
  /** Browser-test stacks only: multiplies every rate limit (see common/throttler.guard.ts). Never set in production. */
  THROTTLE_LIMIT_MULTIPLIER: z.coerce.number().int().min(1).max(100).default(1),
  PUBLIC_CACHE_TTL_S: z.coerce.number().int().min(0).max(300).default(30),
  /** Signed-in reads (account checks, courses by address), in seconds; any write clears it (common/signed-in-cache.ts). 0 turns it off. */
  SIGNED_IN_CACHE_TTL_S: z.coerce.number().int().min(0).max(60).default(15),
  /** Requests in progress at once before new ones get a fast 503 (0 turns the limit off). */
  MAX_IN_FLIGHT: z.coerce.number().int().min(0).max(10_000).default(200),
  /** Password hashes (argon2) computed at once; more queue. One is right for a ¼ vCPU. */
  PASSWORD_HASH_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(1),
  /** Release identifier (the deployed commit), reported by /api/health and Sentry. */
  ACADEMY_RELEASE: z.string().max(64).optional(),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const env = parsed.data;
  if (env.NODE_ENV === 'production') {
    const problems: string[] = [];
    if (env.JWT_ACCESS_SECRET.startsWith('dev-only')) problems.push('JWT_ACCESS_SECRET must be set');
    if (!env.S3_ENDPOINT) problems.push('S3_ENDPOINT must be set (Cloudflare R2 endpoint)');
    if (env.S3_ACCESS_KEY_ID === 'minioadmin' || env.S3_SECRET_ACCESS_KEY === 'minioadmin') {
      problems.push('S3 credentials must be set (not the MinIO defaults)');
    }
    if (env.EMAIL_PROVIDER === 'resend' && !env.RESEND_API_KEY) problems.push('RESEND_API_KEY must be set');
    // Compose runs NODE_ENV=production locally over http; only enforce https for real domains.
    if (!env.WEB_URL.startsWith('https://') && !/localhost|127\.0\.0\.1/.test(env.WEB_URL)) {
      problems.push('WEB_URL must use https');
    }
    if (problems.length && !env.ALLOW_INSECURE_PRODUCTION) {
      throw new Error(`Invalid production configuration:\n  ${problems.join('\n  ')}`);
    }
  }
  return env;
}

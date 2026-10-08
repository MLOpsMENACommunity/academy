import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

/** All configuration comes from the environment and is validated once at boot. */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  DATABASE_URL: z.string().min(1),

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

  EMAIL_PROVIDER: z.enum(['smtp', 'resend', 'log']).default('smtp'),
  EMAIL_FROM: z.string().default('MLOps MENA Academy <academy@mlopsmena.com>'),
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().int().default(1025),
  RESEND_API_KEY: z.string().optional(),

  S3_ENDPOINT: z.string().url().optional(),
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
  /** Disable scheduled jobs (e.g. in tests or on secondary replicas). */
  JOBS_ENABLED: bool.default('true'),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const env = parsed.data;
  if (env.NODE_ENV === 'production' && env.JWT_ACCESS_SECRET.startsWith('dev-only')) {
    throw new Error('JWT_ACCESS_SECRET must be set in production');
  }
  return env;
}

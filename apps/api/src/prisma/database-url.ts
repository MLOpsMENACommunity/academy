/**
 * Connection-pool settings for Prisma, made explicit.
 *
 * Without them Prisma sizes its pool from the CPUs it detects (`num_physical_cpus * 2 + 1`)
 * and waits up to 10 s for a free connection before failing a query (P2024). On a ¼-vCPU
 * container that is a tiny pool (3 connections when it sees one CPU) and, under load, every
 * request queues for the full 10 s and then fails with a 500: exactly the plateau the staging
 * load test showed (p50 ≈ 10 s on every endpoint, /api/health included).
 *
 * Values already in DATABASE_URL always win, so the owner can tune them from the secret
 * alone; otherwise DATABASE_POOL_SIZE / DATABASE_POOL_TIMEOUT (or the defaults below) apply.
 */
export const DEFAULT_POOL_SIZE = 10;
export const DEFAULT_POOL_TIMEOUT_S = 5;

export interface PoolSettings {
  url: string;
  connectionLimit: number;
  poolTimeoutS: number;
  /** True when talking to a PgBouncer pooler (Neon's "-pooler" host), which needs pgbouncer=true. */
  pgbouncer: boolean;
}

/** Neon's pooled endpoints are `<endpoint>-pooler.<region>.aws.neon.tech`; PGBOUNCER=true forces it elsewhere. */
export function isPooledHost(host: string): boolean {
  return /-pooler\./i.test(host);
}

function positiveInt(value: string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function poolSettings(
  databaseUrl: string,
  opts: { poolSize?: number; poolTimeoutS?: number; pgbouncer?: boolean } = {},
): PoolSettings {
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    // Not a URL we can tune (e.g. a test stub): leave it to Prisma.
    return { url: databaseUrl, connectionLimit: NaN, poolTimeoutS: NaN, pgbouncer: false };
  }
  const q = url.searchParams;
  const connectionLimit = positiveInt(q.get('connection_limit')) ?? opts.poolSize ?? DEFAULT_POOL_SIZE;
  const poolTimeoutS = positiveInt(q.get('pool_timeout')) ?? opts.poolTimeoutS ?? DEFAULT_POOL_TIMEOUT_S;
  q.set('connection_limit', String(connectionLimit));
  q.set('pool_timeout', String(poolTimeoutS));
  const pgbouncer = q.get('pgbouncer') === 'true' || (q.get('pgbouncer') === null && (opts.pgbouncer || isPooledHost(url.hostname)));
  if (pgbouncer) q.set('pgbouncer', 'true');
  return { url: url.toString(), connectionLimit, poolTimeoutS, pgbouncer };
}

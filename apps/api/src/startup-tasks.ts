/* eslint-disable no-console -- a container start script: its output is the container log */
/**
 * The seed and the archive import, run in the background once the API is already serving
 * (see docker-entrypoint.sh). They used to run before the API listened, which made every
 * container start (deploy, wake from sleep, crash) a long "container is not listening" outage.
 *
 *   1. waits until the API answers /api/health/live (so they don't slow its boot),
 *   2. takes a Postgres advisory lock, so two containers (old and new during a rollout) never
 *      seed at once; if another one holds it, this one just skips,
 *   3. runs dist/prisma/seed.js, then dist/prisma/import-archive.js (unless ARCHIVE_IMPORT=false),
 *      each best effort, exactly as before.
 *
 * The lock is a session lock, so it uses the direct (unpooled) connection when there is one,
 * like migrations do: PgBouncer in transaction mode can't hold session locks.
 */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isPooledHost } from './prisma/database-url';

/** Any constant shared by all instances; arbitrary. */
export const STARTUP_LOCK_KEY = 4_177_301;
const WAIT_FOR_API_MS = 120_000;
const TASK_TIMEOUT_MS = 10 * 60_000;

/** Written when the tasks are over (done, skipped or failed): the local compose healthcheck waits for it. */
export const DONE_MARKER = '/tmp/academy-startup-tasks.done';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitForApi(port: string): Promise<boolean> {
  const deadline = Date.now() + WAIT_FOR_API_MS;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health/live`, { signal: AbortSignal.timeout(2_000) });
      if (res.ok) return true;
    } catch {
      // not listening yet
    }
    await sleep(500);
  }
  return false;
}

function run(script: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script], { stdio: 'inherit', env: process.env });
    const timer = setTimeout(() => child.kill('SIGTERM'), TASK_TIMEOUT_MS);
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve(code === 0);
    });
    child.on('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

/**
 * The connection the lock is taken on: direct, one connection only. Null when there is only
 * a PgBouncer (transaction mode) URL: a session lock taken through it could land on one server
 * connection and its unlock on another, and stay held forever. Then the tasks run unlocked,
 * as they always did before (they are idempotent).
 */
export function lockUrl(env: NodeJS.ProcessEnv): string | null {
  const raw = env.DIRECT_DATABASE_URL || env.DATABASE_URL;
  if (!raw) return null;
  const url = new URL(raw);
  if (!env.DIRECT_DATABASE_URL && (isPooledHost(url.hostname) || url.searchParams.get('pgbouncer') === 'true')) return null;
  url.searchParams.set('connection_limit', '1');
  return url.toString();
}

async function runTasks(): Promise<void> {
  const dir = join(__dirname, '..', 'prisma');
  const started = Date.now();
  // Seeding is best effort: a seed failure (e.g. after a rollback) must not affect the API.
  if (!(await run(join(dir, 'seed.js')))) console.warn('WARNING: seed failed; the API keeps running');
  // The archive (past courses, sessions, speakers from prisma/archive/*.json): idempotent, never
  // overwrites admin edits, and best effort like the seed. ARCHIVE_IMPORT=false turns it off.
  if ((process.env.ARCHIVE_IMPORT ?? 'true') !== 'false') {
    if (!(await run(join(dir, 'import-archive.js')))) console.warn('WARNING: archive import failed; the API keeps running');
  }
  console.log(`startup-tasks: done in ${Math.round((Date.now() - started) / 1000)}s`);
}

async function main(): Promise<void> {
  if (!(await waitForApi(process.env.PORT ?? '4000'))) {
    console.warn('startup-tasks: the API never came up; running the seed anyway');
  }
  const url = lockUrl(process.env);
  if (!url) {
    console.log('startup-tasks: no direct database URL for the lock; running unlocked');
    return runTasks();
  }
  // Loaded only now, so it doesn't compete with the API's own boot for the CPU.
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient({ datasourceUrl: url, errorFormat: 'minimal' });
  try {
    const rows = await prisma.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_lock(${STARTUP_LOCK_KEY}) AS locked`;
    if (!rows[0]?.locked) {
      console.log('startup-tasks: another instance is seeding; skipping');
      return;
    }
    await runTasks();
    await prisma.$queryRaw`SELECT pg_advisory_unlock(${STARTUP_LOCK_KEY})`;
  } finally {
    await prisma.$disconnect();
  }
}

function markDone(): void {
  try {
    writeFileSync(DONE_MARKER, new Date().toISOString());
  } catch {
    // read-only filesystem: only the local healthcheck uses it
  }
}

if (require.main === module) {
  main()
    .catch((err: unknown) => console.warn(`WARNING: startup tasks failed: ${(err as Error)?.message ?? err}`))
    .finally(markDone);
}

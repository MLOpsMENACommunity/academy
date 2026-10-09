import { Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * `prisma migrate deploy` before the API listens, but only when there is something to apply.
 *
 * Starting the Prisma CLI costs ~6–7 s on a ¼ vCPU even when every migration is already
 * applied, and the container starts on every wake from sleep, every deploy and every crash.
 * Comparing prisma/migrations with the _prisma_migrations table takes one query on a
 * connection the API needs anyway, so the CLI only runs on the deploy that ships a migration
 * (or on a fresh or unusual database: anything this check doesn't recognise runs the CLI,
 * which stays the authority).
 */
export function pendingMigrations(onDisk: string[], applied: string[]): string[] {
  const done = new Set(applied);
  return onDisk.filter((m) => !done.has(m));
}

/** Migration directories (the CLI's own layout: prisma/migrations/<name>/migration.sql). */
export function migrationsOnDisk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(dir, d.name, 'migration.sql')))
    .map((d) => d.name)
    .sort();
}

async function appliedMigrations(url: string): Promise<string[] | null> {
  const u = new URL(url);
  u.searchParams.set('connection_limit', '1');
  const prisma = new PrismaClient({ datasourceUrl: u.toString(), errorFormat: 'minimal' });
  try {
    const rows = await prisma.$queryRaw<{ migration_name: string }[]>`
      SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`;
    // A migration that failed half-way (finished_at null) is never "applied": the CLI decides.
    const failed = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL`;
    if (Number(failed[0]?.n ?? 0) > 0) return null;
    return rows.map((r) => r.migration_name);
  } catch {
    return null; // no table yet (fresh database), or unreachable: let the CLI handle and report it
  } finally {
    await prisma.$disconnect();
  }
}

function runCli(env: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve, reject) => {
    // Migrations take advisory locks, which need a direct (unpooled) connection on Neon.
    const child = spawn('node_modules/.bin/prisma', ['migrate', 'deploy'], {
      stdio: 'inherit',
      env: { ...env, DATABASE_URL: env.DIRECT_DATABASE_URL || env.DATABASE_URL },
    });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`prisma migrate deploy exited with ${code}`))));
  });
}

export async function migrateOnStart(env: NodeJS.ProcessEnv = process.env, dir = join(process.cwd(), 'prisma', 'migrations')): Promise<void> {
  const logger = new Logger('Migrations');
  const started = Date.now();
  const onDisk = migrationsOnDisk(dir);
  const applied = onDisk.length ? await appliedMigrations(env.DIRECT_DATABASE_URL || env.DATABASE_URL || '') : null;
  if (applied && pendingMigrations(onDisk, applied).length === 0) {
    logger.log(`Up to date (${onDisk.length} migrations, checked in ${Date.now() - started} ms)`);
    return;
  }
  logger.log(applied ? `${pendingMigrations(onDisk, applied).length} pending: running prisma migrate deploy` : 'Running prisma migrate deploy');
  await runCli(env);
  logger.log(`Applied in ${Date.now() - started} ms`);
}

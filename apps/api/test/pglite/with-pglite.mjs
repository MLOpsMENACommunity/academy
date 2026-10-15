#!/usr/bin/env node
/* eslint-disable no-console -- a CLI wrapper: its output is the test log */
// Runs a command against a throwaway in-memory Postgres (PGlite: Postgres compiled to WASM)
// and an in-memory S3, so the API e2e suite needs no Postgres or MinIO service. Used by
// scripts/ci-test.sh on Cloudflare Workers Builds, which has no service containers.
//
//   node test/pglite/with-pglite.mjs <command> [args...]
//   e.g. node test/pglite/with-pglite.mjs pnpm test:e2e      (from apps/api)
//
// It serves PGlite over the Postgres wire protocol (@electric-sql/pglite-socket) on a free
// 127.0.0.1 port, behind ready-for-query-guard.mjs (works around a protocol bug, see there),
// applies the migrations with `prisma migrate deploy`, then runs the command with
// DATABASE_URL and S3_* pointing at both. Everything is gone when it exits.
//
// PGlite has a single backend: the socket server multiplexes clients onto it query by query,
// so each Prisma client gets one connection (DATABASE_POOL_SIZE=1). Real Postgres stays the
// reference (GitHub CI and local runs use it); this mode exists for build machines without one.
//
// Debugging: PGLITE_DEBUG=1 logs connections and queries, PGLITE_INSPECT=1 dumps the wire.
import { spawn } from 'node:child_process';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { startMemoryS3 } from './memory-s3.mjs';
import { startReadyForQueryGuard } from './ready-for-query-guard.mjs';

const [cmd, ...args] = process.argv.slice(2);
if (!cmd) {
  console.error('Usage: node test/pglite/with-pglite.mjs <command> [args...]');
  process.exit(2);
}

function run(command, commandArgs, env) {
  return new Promise((resolve) => {
    const child = spawn(command, commandArgs, { stdio: 'inherit', env, shell: false });
    const forward = (signal) => child.kill(signal);
    process.on('SIGINT', forward);
    process.on('SIGTERM', forward);
    child.on('exit', (code, signal) => {
      process.off('SIGINT', forward);
      process.off('SIGTERM', forward);
      resolve(code ?? (signal ? 1 : 0));
    });
    child.on('error', (err) => {
      console.error(`Could not start ${command}: ${err.message}`);
      resolve(1);
    });
  });
}

const started = Date.now();
const db = await PGlite.create(); // in memory
const server = new PGLiteSocketServer({
  db,
  host: '127.0.0.1',
  port: 0,
  // A test may run a second app (a second Prisma client) next to the first one.
  maxConnections: Number(process.env.PGLITE_MAX_CONNECTIONS || 4),
  debug: process.env.PGLITE_DEBUG === '1',
  inspect: process.env.PGLITE_INSPECT === '1',
});
await server.start();
const guard = await startReadyForQueryGuard(server.getServerConn());
const s3 = await startMemoryS3();

const databaseUrl = `postgresql://postgres:postgres@${guard.conn}/postgres?sslmode=disable`;
const env = {
  ...process.env,
  // One connection per Prisma client (see above); a test may still set its own.
  DATABASE_POOL_SIZE: process.env.DATABASE_POOL_SIZE || '1',
  DATABASE_POOL_TIMEOUT: process.env.DATABASE_POOL_TIMEOUT || '30',
  DATABASE_URL: databaseUrl,
  // Nothing in a test run may reach a real database through the other variable.
  DIRECT_DATABASE_URL: databaseUrl,
  S3_ENDPOINT: s3.endpoint,
  S3_REGION: 'us-east-1',
  S3_BUCKET: process.env.S3_BUCKET || 'academy-private',
  S3_ACCESS_KEY_ID: 'memory',
  S3_SECRET_ACCESS_KEY: 'memory',
  S3_FORCE_PATH_STYLE: 'true',
  S3_CREATE_BUCKET: 'true',
};
console.log(`with-pglite: PGlite on ${guard.conn}, in-memory S3 on ${s3.endpoint}`);

let code = await run('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], env);
console.log(`with-pglite: migrations ${code === 0 ? 'applied' : 'FAILED'} after ${Math.round((Date.now() - started) / 1000)}s`);
if (code === 0) code = await run(cmd, args, env);

await s3.close();
await guard.close();
await server.stop();
await db.close();
console.log(
  `with-pglite: done in ${Math.round((Date.now() - started) / 1000)}s (exit ${code}; ${guard.dropped()} duplicate ReadyForQuery dropped)`,
);
process.exit(code);

#!/bin/sh
set -e
if [ "$RUN_MIGRATIONS" = "true" ]; then
  # Migrations take advisory locks, which need a direct (unpooled) connection on Neon.
  DATABASE_URL="${DIRECT_DATABASE_URL:-$DATABASE_URL}" node_modules/.bin/prisma migrate deploy
fi
if [ "$RUN_SEED" = "true" ]; then
  # Seeding is best effort: a seed failure (e.g. after a rollback) must not keep the API down.
  node dist/prisma/seed.js || echo "WARNING: seed failed; starting the API anyway" >&2
  # The archive (past courses, sessions, speakers from prisma/archive/*.json): idempotent, never
  # overwrites admin edits, and best effort like the seed. ARCHIVE_IMPORT=false turns it off.
  if [ "${ARCHIVE_IMPORT:-true}" != "false" ]; then
    node dist/prisma/import-archive.js || echo "WARNING: archive import failed; starting the API anyway" >&2
  fi
fi
exec node dist/src/main.js

#!/bin/sh
set -e
if [ "$RUN_MIGRATIONS" = "true" ]; then
  # Migrations take advisory locks, which need a direct (unpooled) connection on Neon.
  DATABASE_URL="${DIRECT_DATABASE_URL:-$DATABASE_URL}" node_modules/.bin/prisma migrate deploy
fi
if [ "$RUN_SEED" = "true" ]; then
  # Seeding is best effort: a seed failure (e.g. after a rollback) must not keep the API down.
  node dist/prisma/seed.js || echo "WARNING: seed failed; starting the API anyway" >&2
fi
exec node dist/src/main.js

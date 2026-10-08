#!/bin/sh
set -e
if [ "$RUN_MIGRATIONS" = "true" ]; then
  # Migrations take advisory locks, which need a direct (unpooled) connection on Neon.
  DATABASE_URL="${DIRECT_DATABASE_URL:-$DATABASE_URL}" node_modules/.bin/prisma migrate deploy
fi
if [ "$RUN_SEED" = "true" ]; then
  node dist/prisma/seed.js
fi
exec node dist/src/main.js

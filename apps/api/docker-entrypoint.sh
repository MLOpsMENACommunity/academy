#!/bin/sh
set -e
if [ "$RUN_MIGRATIONS" = "true" ]; then
  node_modules/.bin/prisma migrate deploy
fi
if [ "$RUN_SEED" = "true" ]; then
  node dist/prisma/seed.js
fi
exec node dist/src/main.js

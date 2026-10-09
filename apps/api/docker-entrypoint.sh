#!/bin/sh
set -e
# Container start must be fast: until the API listens, every request fails ("the container is
# not listening"), and a container starts on every deploy, every wake from sleep and every crash.
# Only migrations run before listening (the code needs its schema), and the API itself checks
# first whether any is pending, so the Prisma CLI (~7 s on a ¼ vCPU) only starts when one is
# (RUN_MIGRATIONS, src/migrate-on-start.ts). The seed and the archive import run in the
# background once the API is up (src/startup-tasks.ts).
if [ "$RUN_SEED" = "true" ]; then
  # Detached (re-parented to tini, which reaps it) and at low CPU priority, so serving comes
  # first. Best effort: a failure is logged and never stops the API.
  ( nice -n 10 node dist/src/startup-tasks.js & )
fi
# Heap sized for a 1 GiB container: leaves room for Prisma's query engine (native memory),
# buffers and the background seed. Override with API_MAX_OLD_SPACE_MB.
exec node --max-old-space-size="${API_MAX_OLD_SPACE_MB:-512}" dist/src/main.js

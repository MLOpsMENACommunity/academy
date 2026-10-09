# syntax=docker/dockerfile:1.7
# Build from the repo root: docker build -f apps/api/Dockerfile .
FROM node:24-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN apk add --no-cache openssl && corepack enable
WORKDIR /repo

FROM base AS build
# Optional CA bundle for builds behind a TLS-inspecting proxy (empty by default).
RUN --mount=type=secret,id=extra_ca,required=false \
    cp /run/secrets/extra_ca /tmp/extra-ca.pem 2>/dev/null || touch /tmp/extra-ca.pem
ENV NODE_EXTRA_CA_CERTS=/tmp/extra-ca.pem
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @academy/api...
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @academy/shared build && pnpm --filter @academy/api build
RUN pnpm --filter @academy/api deploy --prod --legacy /out \
 && cd /out && node_modules/.bin/prisma generate

FROM node:24-alpine AS runtime
RUN apk add --no-cache openssl tini
ENV NODE_ENV=production PORT=4000
WORKDIR /app
COPY --from=build --chown=node:node /out ./
COPY --chown=node:node apps/api/docker-entrypoint.sh ./docker-entrypoint.sh
# V8 compile cache, filled at build time: on a ¼ vCPU, compiling the API's JavaScript is most
# of its ~10 s boot; with the cache baked into the image every container start skips it (~4 s
# saved per start). Warmed with the same V8 flags the entrypoint uses, or V8 rejects the cache.
ENV NODE_COMPILE_CACHE=/app/.compile-cache
RUN mkdir -p /app/.compile-cache && chown node:node /app/.compile-cache
USER node
RUN node --max-old-space-size=512 -e "require('./dist/src/instrument'); require('./dist/src/app.module'); require('./dist/src/migrate-on-start'); require('./dist/src/email/templates/catalog'); require('@react-email/render'); require('node:module').flushCompileCache()" \
 && node -e "require('@prisma/client'); require('node:module').flushCompileCache()"
EXPOSE 4000
# Liveness only (no database): a saturated pool must not get a healthy process killed.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
  CMD wget -qO- http://127.0.0.1:4000/api/health/live || exit 1
ENTRYPOINT ["/sbin/tini", "--", "./docker-entrypoint.sh"]

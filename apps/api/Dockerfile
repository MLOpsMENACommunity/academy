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
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
  CMD wget -qO- http://127.0.0.1:4000/api/health || exit 1
ENTRYPOINT ["/sbin/tini", "--", "./docker-entrypoint.sh"]

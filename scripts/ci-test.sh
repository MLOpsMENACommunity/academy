#!/usr/bin/env bash
# The test gate, in one script, for any machine: Cloudflare Workers Builds (its build
# command), GitHub Actions, or your laptop before you push.
#
#   scripts/ci-test.sh            install, lint, typecheck, unit tests, API e2e
#   scripts/ci-test.sh --build    ... and `pnpm build` too (the Docker images build the apps
#                                 anyway on deploy, so Workers Builds skips this step)
#
# API e2e database:
#   - DATABASE_URL set   -> that Postgres (plus S3_* for MinIO), exactly as ci.yml does;
#   - DATABASE_URL unset -> PGlite, an in-memory Postgres, with an in-memory S3
#                           (apps/api/test/pglite/with-pglite.mjs). Workers Builds has no
#                           service containers, so it always takes this path.
#   CI_E2E_DB=pglite or CI_E2E_DB=postgres forces one.
#
# Never point DATABASE_URL at a database you care about: the e2e suite writes to it.
# Playwright (browser) tests are not run here; see DEPLOY.md, "Tests".
set -euo pipefail
cd "$(dirname "$0")/.."

BUILD=false
for arg in "$@"; do
  case "$arg" in
    --build) BUILD=true ;;
    *) echo "Unknown option: $arg (usage: scripts/ci-test.sh [--build])" >&2; exit 2 ;;
  esac
done

export NEXT_TELEMETRY_DISABLED=1
started=$SECONDS
step() { printf '\n==> %s (%ss)\n' "$1" "$((SECONDS - started))"; }

want_pnpm=$(node -p "require('./package.json').packageManager.split('@')[1]")
have_pnpm=$(pnpm --version 2>/dev/null || echo none)
if [ "$have_pnpm" != "$want_pnpm" ]; then
  echo "pnpm $have_pnpm found, package.json pins $want_pnpm. On Workers Builds set the build variable PNPM_VERSION=$want_pnpm." >&2
  case "$have_pnpm" in 10.*) ;; *) exit 1 ;; esac
fi
echo "node $(node --version), pnpm $have_pnpm, ${WORKERS_CI:+Workers Builds }commit ${WORKERS_CI_COMMIT_SHA:-$(git rev-parse --short HEAD 2>/dev/null || echo unknown)}"

# On Workers Builds, don't spend minutes testing a commit that won't be deployed: if the
# branch has moved on, the newer push's build tests and deploys instead. The marker file
# makes deploy/cloudflare/build.sh refuse to deploy this checkout untested, whatever happens.
rm -f .ci-test-skipped
if [ -n "${WORKERS_CI:-}" ] && [ -n "${WORKERS_CI_BRANCH:-}" ]; then
  # shellcheck source=lib/superseded.sh
  . scripts/lib/superseded.sh
  if superseded "$WORKERS_CI_BRANCH" "$(git rev-parse HEAD)"; then
    echo "$WORKERS_CI_BRANCH is at ${SUPERSEDED_BY:0:12} now: skipping the tests of this older commit (its build tests and deploys instead)."
    touch .ci-test-skipped
    exit 0
  fi
fi

step "Install"
pnpm install --frozen-lockfile

step "Lint"
pnpm lint

step "Typecheck"
pnpm typecheck

step "Unit tests"
pnpm test

mode=${CI_E2E_DB:-}
if [ -z "$mode" ]; then
  if [ -n "${DATABASE_URL:-}" ]; then mode=postgres; else mode=pglite; fi
fi
case "$mode" in
  postgres)
    [ -n "${DATABASE_URL:-}" ] || { echo "CI_E2E_DB=postgres needs DATABASE_URL" >&2; exit 1; }
    step "API e2e tests (Postgres from DATABASE_URL)"
    pnpm --filter @academy/api exec prisma migrate deploy
    pnpm --filter @academy/api test:e2e --passWithNoTests
    ;;
  pglite)
    step "API e2e tests (PGlite, in-memory S3)"
    # DATABASE_URL is replaced by the wrapper; unset it so nothing can reach a real database.
    env -u DATABASE_URL -u DIRECT_DATABASE_URL pnpm --filter @academy/api test:e2e:pglite --passWithNoTests
    ;;
  *) echo "CI_E2E_DB must be pglite or postgres (got '$mode')" >&2; exit 2 ;;
esac

if [ "$BUILD" = true ]; then
  step "Build"
  pnpm build
fi

step "All checks passed"

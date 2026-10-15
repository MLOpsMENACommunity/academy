#!/usr/bin/env bash
# Deploys this checkout to one environment. It is the Workers Builds deploy command of each
# Worker (see WORKERS-BUILDS.md), run from the repository root:
#
#   bash deploy/cloudflare/build.sh staging       # Worker mlops-academy-staging, branch main
#   bash deploy/cloudflare/build.sh production    # Worker mlops-academy, branch production
#
# What it does, in order (it stops at the first failure):
#   1. checks that the build is the right one: target vs. branch, the ACADEMY_ENVIRONMENT
#      build variable, the connected Worker's name, the commit;
#   2. skips the deploy when the branch has already moved on (a newer build deploys instead),
#      checked again right before step 7; refuses a checkout whose tests were skipped;
#   3. production only: refuses a commit that has no staging release record (step 9), so
#      production only ever gets code that already passed on staging;
#   4. checks that the Worker already has its runtime secrets (they live on the Worker, set
#      once; a deploy never changes them);
#   5. points wrangler.jsonc at the environment's hostname (configure-host.mjs);
#   6. creates the environment's private R2 bucket if missing;
#   7. `wrangler deploy` (builds both container images, pushes them, rolls out);
#   8. smoke-tests the environment's host (8 minutes at most, to fit the 20-minute build limit);
#   9. writes the release record <target>/<sha>.json to the R2 bucket academy-releases.
#
# Build variables it reads (Worker → Settings → Build → Variables and secrets):
#   ACADEMY_ENVIRONMENT     required, must equal the target (staging | production)
#   ACADEMY_HOSTNAME, ACADEMY_REDIRECT_HOSTS, SENTRY_ENVIRONMENT    optional, as before
#   EDGE_PURGE_ZONE_ID      optional: purge the edge cache after admin edits (configure-host.mjs)
#   EMAIL_ALLOWLIST, EMAIL_REDIRECT_TO                              optional, staging only
# Workers Builds provides WORKERS_CI, WORKERS_CI_BRANCH, WORKERS_CI_COMMIT_SHA, the API token
# and the account. Outside Workers Builds, set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID.
#
#   DRY_RUN=1 bash deploy/cloudflare/build.sh staging    runs every local check, prints the
#                                                         Cloudflare steps instead of running them
set -euo pipefail

TARGET=${1:-}
STAGING_BRANCH=${STAGING_BRANCH:-main}
PRODUCTION_BRANCH=${PRODUCTION_BRANCH:-production}
RELEASES_BUCKET=${RELEASES_BUCKET:-academy-releases}
DRY_RUN=${DRY_RUN:-0}

fail() { echo "ERROR: $*" >&2; exit 1; }
step() { printf '\n==> %s\n' "$*"; }
cf() { # a Cloudflare call: printed instead of run in a dry run
  if [ "$DRY_RUN" = 1 ]; then echo "[dry run] $*"; else "$@"; fi
}

case "$TARGET" in
  staging) BRANCH=$STAGING_BRANCH; WORKER=mlops-academy-staging; WRANGLER_ENV=staging ;;
  production) BRANCH=$PRODUCTION_BRANCH; WORKER=mlops-academy; WRANGLER_ENV="" ;;
  *) fail "usage: deploy/cloudflare/build.sh <staging|production>" ;;
esac

cd "$(dirname "$0")"
DIR=$(pwd)

# --- 1. Is this the right build? ----------------------------------------------------------
step "Checking the build is $TARGET's"
if [ -n "${WORKERS_CI:-}" ]; then
  [ "${WORKERS_CI_BRANCH:-}" = "$BRANCH" ] \
    || fail "$TARGET deploys only from the '$BRANCH' branch; this build is for '${WORKERS_CI_BRANCH:-?}'. Check the Worker's Settings → Build → Branch control (preview builds must not run this script)."
fi
# Each Worker's build says which environment it is, so a build configured on the wrong
# Worker (or copied from the other one) stops here instead of deploying the wrong target.
[ "${ACADEMY_ENVIRONMENT:-}" = "$TARGET" ] \
  || fail "the build variable ACADEMY_ENVIRONMENT is '${ACADEMY_ENVIRONMENT:-}', expected '$TARGET' (Worker → Settings → Build → Variables and secrets)."
# Workers Builds deploys to the Worker it is connected to (it sets this override itself).
if [ -n "${WRANGLER_CI_OVERRIDE_NAME:-}" ] && [ "$WRANGLER_CI_OVERRIDE_NAME" != "$WORKER" ]; then
  fail "this build belongs to the Worker '$WRANGLER_CI_OVERRIDE_NAME', but $TARGET is '$WORKER'."
fi
SHA=$(git rev-parse HEAD)
if [ -n "${WORKERS_CI_COMMIT_SHA:-}" ] && [ "$WORKERS_CI_COMMIT_SHA" != "$SHA" ]; then
  fail "checked out $SHA, but the build is for $WORKERS_CI_COMMIT_SHA."
fi
SHORT=${SHA:0:12}
echo "$TARGET: Worker $WORKER, branch $BRANCH, commit $SHA"

# --- 2. Has the branch moved on? -----------------------------------------------------------
# Builds can overlap (several merges in a row). A build whose commit is no longer the tip of
# its branch doesn't deploy, so an older build can't finish last and roll the site back.
# Best effort: if the remote can't be read here, the deploy goes ahead.
# shellcheck source=../../scripts/lib/superseded.sh
. ../../scripts/lib/superseded.sh
step "Checking $SHORT is still the tip of $BRANCH"
if superseded "$BRANCH" "$SHA"; then
  echo "$BRANCH is at ${SUPERSEDED_BY:0:12} now, not $SHORT: skipping this deploy (the build of ${SUPERSEDED_BY:0:12} deploys instead)."
  exit 0
fi
echo "Yes (or the remote can't be read from here; then the deploy goes ahead)."
# scripts/ci-test.sh leaves this marker when it skipped the tests of a superseded commit.
[ ! -e ../../.ci-test-skipped ] || fail "the tests of $SHORT were skipped (it looked superseded), so it can't be deployed. Retry the build of the branch's latest commit."

step "Installing the deploy tools"
(cd ../.. && pnpm install --frozen-lockfile --filter @academy/deploy-cloudflare...)
wrangler() { pnpm exec wrangler "$@"; }

# --- 3. Production only takes what staging has verified ------------------------------------
if [ "$TARGET" = production ]; then
  step "Checking $SHORT was released to staging"
  if [ "$DRY_RUN" = 1 ]; then
    echo "[dry run] wrangler r2 object get $RELEASES_BUCKET/staging/$SHA.json --remote --pipe"
  elif record=$(wrangler r2 object get "$RELEASES_BUCKET/staging/$SHA.json" --remote --pipe 2>/dev/null) && grep -q "\"sha\": *\"$SHA\"" <<<"$record"; then
    echo "Staging release record: $record"
  else
    fail "$SHA has no staging release record ($RELEASES_BUCKET/staging/$SHA.json). Production only deploys commits that passed on staging: merge to main, wait for the staging build, then promote that commit (scripts/promote.sh)."
  fi
fi

# --- 4. The Worker's runtime secrets -------------------------------------------------------
step "Checking $WORKER has its runtime secrets"
required="DATABASE_URL JWT_ACCESS_SECRET JOBS_TOKEN RESEND_API_KEY S3_ENDPOINT S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY SEED_ADMIN_EMAIL SEED_ADMIN_PASSWORD"
# Staging must have both database URLs: a missing one could fall back to something else.
[ "$TARGET" = staging ] && required="$required DIRECT_DATABASE_URL"
if [ "$DRY_RUN" = 1 ]; then
  echo "[dry run] wrangler secret list --env=$WRANGLER_ENV (needs: $required)"
else
  # Only the JSON array is read, in case wrangler prints anything (even "[WARNING]") before it.
  names=$(wrangler secret list --env="$WRANGLER_ENV" --format json | node -e '
    let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
      const end = s.lastIndexOf("]") + 1;
      for (let i = s.indexOf("["); i >= 0 && i < end; i = s.indexOf("[", i + 1)) {
        try {
          const list = JSON.parse(s.slice(i, end));
          if (Array.isArray(list)) return console.log(list.map((x) => x.name).join(" "));
        } catch {}
      }
      console.error("could not read the secret list from wrangler");
      process.exit(1);
    });')
  missing=""
  for k in $required; do grep -qw "$k" <<<"$names" || missing="$missing $k"; done
  [ -z "$missing" ] || fail "$WORKER is missing the secrets:$missing. Set them with deploy/cloudflare/set-worker-secret.sh (see WORKERS-BUILDS.md)."
  echo "All set."
fi

# --- 5. Hostname and per-environment values ------------------------------------------------
step "Configuring wrangler.jsonc for $TARGET"
backup=$(mktemp); out=$(mktemp)
cp wrangler.jsonc "$backup"
# configure-host.mjs rewrites wrangler.jsonc; put the committed one back afterwards.
trap 'cp "$backup" "$DIR/wrangler.jsonc"; rm -f "$backup" "$out"' EXIT
SHA=$SHA DEPLOY_OUTPUT=$out node configure-host.mjs "$TARGET"
HOST=$(grep -m1 '^host=' "$out" | cut -d= -f2-)
BUCKET=$(grep -m1 '^bucket=' "$out" | cut -d= -f2-)
[ -n "$HOST" ] && [ -n "$BUCKET" ] || fail "configure-host.mjs reported no host or bucket"

# --- 6. Buckets ----------------------------------------------------------------------------
step "Ensuring the R2 buckets $BUCKET and $RELEASES_BUCKET exist"
for b in "$BUCKET" "$RELEASES_BUCKET"; do
  if [ "$DRY_RUN" = 1 ]; then echo "[dry run] wrangler r2 bucket create $b (if missing)"; continue; fi
  if log=$(wrangler r2 bucket create "$b" 2>&1); then echo "Created $b."
  elif grep -qi "already exists" <<<"$log"; then echo "$b exists."
  else echo "$log" >&2; fail "couldn't create the R2 bucket $b"; fi
done

# --- 7. Deploy -----------------------------------------------------------------------------
if superseded "$BRANCH" "$SHA"; then
  echo "$BRANCH moved on to ${SUPERSEDED_BY:0:12} while this build ran: skipping this deploy."
  exit 0
fi
step "Deploying $SHORT to $WORKER (builds and pushes both images)"
cf wrangler deploy --env="$WRANGLER_ENV" --tag "$SHORT" --message "$TARGET release of $SHA${WORKERS_CI_BUILD_UUID:+ (build $WORKERS_CI_BUILD_UUID)}"

# --- 8. Smoke test -------------------------------------------------------------------------
step "Smoke-testing https://$HOST"
if [ "$DRY_RUN" = 1 ]; then
  echo "[dry run] curl https://$HOST/api/health, /en, http→https redirect, alias redirects"
else
  # One deadline for the whole smoke test: tests (~4 min) + deploy (~4 min) + 8 min stays
  # under Workers Builds' 20-minute limit, so a failure is reported here, not as a timeout.
  deadline=$((SECONDS + 480))
  wait_for() { # description, then a command that succeeds when ready
    local what=$1; shift
    until "$@"; do
      [ "$SECONDS" -lt "$deadline" ] || fail "$what (gave up after 8 minutes)"
      sleep 10
    done
  }
  # The first request cold-starts both containers (migrations run when the API starts), and
  # the API must report this release, not the previous container's.
  health_is_this_release() {
    health=$(curl -fsS --max-time 20 "https://$HOST/api/health" 2>/dev/null) || return 1
    grep -q "\"release\":\"$SHORT\"" <<<"$health" && return 0
    # Another release is live: if the branch moved on, a newer build deployed over this one.
    if superseded "$BRANCH" "$SHA"; then
      echo "$BRANCH moved on to ${SUPERSEDED_BY:0:12}, whose deploy replaced this one: no release record for $SHORT."
      exit 0
    fi
    return 1
  }
  wait_for "https://$HOST/api/health never reported release $SHORT" health_is_this_release
  echo "$health"
  wait_for "https://$HOST/en never came up" curl -fsS --max-time 20 -o /dev/null "https://$HOST/en"
  # Plain http never reaches the containers (private calendar feed URLs carry a token).
  code=$(curl -s -o /dev/null -w '%{http_code}' "http://$HOST/api/health" || true)
  [ "$code" = 301 ] || fail "http://$HOST returned $code, expected a 301 to https"
  for alias in $(echo "${ACADEMY_REDIRECT_HOSTS:-}" | tr ',' ' '); do
    [ "$alias" = "$HOST" ] && continue
    code=$(curl -s -o /dev/null -w '%{http_code}' "https://$alias/en" || true)
    [ "$code" = 301 ] || fail "$alias returned $code, expected a 301 to $HOST"
  done
  echo "Smoke test passed."
fi

# --- 9. Release record ---------------------------------------------------------------------
# staging/<sha>.json is what step 3 of a production build requires. The bucket holds nothing
# else, and no app credential can reach it (the app's R2 tokens are scoped to its own bucket).
step "Recording the $TARGET release of $SHORT"
record=$(mktemp)
printf '{"sha": "%s", "environment": "%s", "host": "%s", "branch": "%s", "build": "%s", "releasedAt": "%s"}\n' \
  "$SHA" "$TARGET" "$HOST" "$BRANCH" "${WORKERS_CI_BUILD_UUID:-local}" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$record"
cf wrangler r2 object put "$RELEASES_BUCKET/$TARGET/$SHA.json" --file "$record" --content-type application/json --remote
rm -f "$record"

echo
echo "Released $SHA to $TARGET: https://$HOST"
[ "$TARGET" = staging ] && echo "Promote it once it's checked: scripts/promote.sh $SHORT"
exit 0

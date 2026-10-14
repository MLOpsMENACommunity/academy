#!/usr/bin/env bash
# Sets (or rotates) runtime secrets directly on a Worker. With Workers Builds the runtime
# secrets live on each Worker and a deploy never touches them, so this replaces "change the
# GitHub environment secret, then redeploy". It asks for each value without echoing it.
#
#   deploy/cloudflare/set-worker-secret.sh staging JWT_ACCESS_SECRET
#   deploy/cloudflare/set-worker-secret.sh production RESEND_API_KEY SENTRY_DSN
#   printf %s "$value" | deploy/cloudflare/set-worker-secret.sh staging DATABASE_URL   (one name)
#
# Keeps the guard the GitHub deploy had: staging's DATABASE_URL / DIRECT_DATABASE_URL must be
# the staging role on a staging database, and production's must not be a staging one.
# Cloudflare credentials: CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID from the environment,
# or else from ~/.config/mlops-academy/deploy.env (only those two lines are read).
# No redeploy needed: setting a secret deploys a new Worker version, and the Worker restarts a
# container whose configuration changed on its next request (restartIfConfigChanged, src/index.ts).
set -euo pipefail
TARGET=${1:-}
shift || true
case "$TARGET" in
  staging) WRANGLER_ENV=staging ;;
  production) WRANGLER_ENV="" ;;
  *) echo "usage: deploy/cloudflare/set-worker-secret.sh <staging|production> NAME [NAME...]" >&2; exit 2 ;;
esac
[ $# -gt 0 ] || { echo "Name at least one secret" >&2; exit 2; }

FILE="$HOME/.config/mlops-academy/deploy.env"
for k in CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID; do
  if [ -z "${!k:-}" ] && [ -f "$FILE" ]; then
    v=$(grep -m1 "^$k=" "$FILE" | cut -d= -f2- || true)
    [ -n "$v" ] && export "$k=$v"
  fi
  [ -n "${!k:-}" ] || { echo "Set $k (or put it in $FILE)" >&2; exit 1; }
done

check_database_url() { # name value: refuse a URL that points at the other environment
  local rest role path db
  rest=${2#*://}; role=${rest%%[:@]*}; path=${rest#*@}; path=${path%%\?*}
  [[ "$path" == */* ]] || { echo "$1 has no database name" >&2; return 1; }
  db=${path##*/}
  if [ "$TARGET" = staging ]; then
    [[ "$db" == *staging* && "$role" == *staging* ]] \
      || { echo "STOP: staging's $1 must be the staging role on a staging database (see setup-staging.sh)" >&2; return 1; }
  elif [[ "$db" == *staging* || "$role" == *staging* ]]; then
    echo "STOP: production's $1 points at a staging database or role" >&2; return 1
  fi
}

cd "$(dirname "$0")"
for name in "$@"; do
  [[ "$name" =~ ^[A-Z][A-Z0-9_]*$ ]] || { echo "Not a secret name: $name" >&2; exit 2; }
  if [ -t 0 ]; then
    read -rsp "$TARGET $name (input hidden): " value; echo
  else
    [ $# -eq 1 ] || { echo "Pipe one value at a time" >&2; exit 2; }
    value=$(cat)
  fi
  [ -n "$value" ] || { echo "Empty value: $name left as it is" >&2; continue; }
  case "$name" in DATABASE_URL | DIRECT_DATABASE_URL) check_database_url "$name" "$value" ;; esac
  printf '%s' "$value" | pnpm exec wrangler secret put "$name" --env="$WRANGLER_ENV" >/dev/null
  unset value
  echo "Set $name on $TARGET."
done

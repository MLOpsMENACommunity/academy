#!/bin/bash
# Re-points the GitHub "staging" environment at its own, isolated resources. Run it ONCE,
# AFTER the release-process PR is merged (before that, the old workflows on main still
# deploy the production Worker with the "staging" environment's values).
#
#   deploy/cloudflare/setup-staging.sh
#
# 1. Creates (if missing) a Neon role and database "academy_staging" in the same Neon
#    project, using production's DIRECT_DATABASE_URL (read from deploy.env, or asked for
#    without echo). The staging role can't read production tables; this is checked.
# 2. Stores the staging connection strings in ~/.config/mlops-academy/staging.env (0600),
#    next to the staging SEED_ADMIN_PASSWORD (generated if missing).
# 3. Sets the staging environment's secrets (fresh JWT_ACCESS_SECRET and JOBS_TOKEN,
#    the staging database and admin password, and the staging R2 keys if staging.env has
#    them), removes production's R2 keys from it, sets its variables, and lets v* tags
#    deploy to it. Cloudflare token/account, RESEND_API_KEY, S3_ENDPOINT and
#    SEED_ADMIN_EMAIL stay as they are (shared). Last, it sets ACADEMY_ENVIRONMENT=staging,
#    without which deploy-cloudflare.yml refuses to deploy staging.
# No secret value is printed.
set -euo pipefail
REPO="MLOpsMENACommunity/academy"
DIR="$HOME/.config/mlops-academy"
PROD_FILE="$DIR/deploy.env"
STAGING_FILE="$DIR/staging.env"
ROLE=academy_staging
DB=academy_staging
umask 077

gen() { local s; s=$(openssl rand -base64 96 | tr -dc 'A-Za-z0-9'); printf '%s' "${s:0:$1}"; }
value() { grep -m1 "^$1=" "$2" 2>/dev/null | cut -d= -f2- || true; }
real() { [ -n "$1" ] && [ "$1" != "..." ]; }

# --- 0. Preconditions --------------------------------------------------------------
main_deploy=$(gh api "repos/$REPO/contents/.github/workflows/deploy-cloudflare.yml?ref=main" --jq .content | base64 -d)
grep -q 'workflow_call:' <<<"$main_deploy" \
  || { echo "Merge the release-process PR first: main still deploys production with the 'staging' environment."; exit 1; }
prod_secrets=$(gh secret list -R "$REPO" --env production --json name --jq '.[].name')
missing=""
for k in CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID DATABASE_URL DIRECT_DATABASE_URL JWT_ACCESS_SECRET JOBS_TOKEN \
         RESEND_API_KEY S3_ENDPOINT S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY SEED_ADMIN_EMAIL SEED_ADMIN_PASSWORD; do
  grep -qx "$k" <<<"$prod_secrets" || missing="$missing $k"
done
[ -z "$missing" ] || { echo "Fill the 'production' environment first (setup-secrets.sh). Missing:$missing"; exit 1; }

touch "$STAGING_FILE"; chmod 600 "$STAGING_FILE"
# A file saved without a final newline would glue the next appended line onto its last one.
[ -s "$STAGING_FILE" ] && [ -n "$(tail -c1 "$STAGING_FILE")" ] && echo >> "$STAGING_FILE"
grep -q '^SEED_ADMIN_PASSWORD=' "$STAGING_FILE" || printf 'SEED_ADMIN_PASSWORD=%s\n' "$(gen 24)" >> "$STAGING_FILE"

# --- 1. Database -------------------------------------------------------------------
if ! grep -q '^DATABASE_URL=' "$STAGING_FILE"; then
  PROD_URL=$(value DIRECT_DATABASE_URL "$PROD_FILE")
  if ! real "$PROD_URL"; then
    read -rsp "Production DIRECT_DATABASE_URL (Neon, unpooled; input hidden): " PROD_URL; echo
  fi
  # postgresql://user:password@ep-xxx[-pooler].region.aws.neon.tech/neondb?sslmode=require
  rest=${PROD_URL#*://}; creds=${rest%%@*}; hostpath=${rest#*@}
  host=${hostpath%%/*}; dbpath=${hostpath#*/}; prod_db=${dbpath%%\?*}
  query=""; [[ "$hostpath" == *\?* ]] && query="?${hostpath#*\?}"
  endpoint=${host%%.*}; endpoint=${endpoint%-pooler}; domain=${host#*.}
  direct_host="$endpoint.$domain"; pooled_host="$endpoint-pooler.$domain"
  export PGPASSWORD=${creds#*:}
  admin_url="postgresql://${creds%%:*}@$direct_host/$prod_db$query"

  STAGING_PW=$(gen 32)
  sql=$(mktemp); trap 'rm -f "$sql"' EXIT
  cat > "$sql" <<SQL
\set ON_ERROR_STOP on
SELECT 'CREATE ROLE $ROLE LOGIN' WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '$ROLE')\gexec
ALTER ROLE $ROLE WITH LOGIN PASSWORD '$STAGING_PW';
GRANT $ROLE TO CURRENT_USER;
SELECT 'CREATE DATABASE $DB OWNER $ROLE' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '$DB')\gexec
SQL
  psql "$admin_url" -q -X -f "$sql" >/dev/null
  rm -f "$sql"
  echo "Neon: role $ROLE and database $DB are ready."

  # The staging role must not be able to read production data.
  # Only a "permission denied" counts as proof; any other failure is inconclusive.
  export PGPASSWORD=$STAGING_PW
  if out=$(psql "postgresql://$ROLE@$direct_host/$prod_db$query" -q -X -tA -c 'SELECT 1 FROM "User" LIMIT 1' 2>&1); then
    echo "STOP: $ROLE can read production's \"User\" table. Revoke that before using staging."; exit 1
  elif grep -qi 'permission denied' <<<"$out"; then
    echo "Checked: $ROLE cannot read production tables."
  elif grep -qiE 'not permitted to log in|no pg_hba|does not have CONNECT' <<<"$out"; then
    echo "Checked: $ROLE cannot even connect to $prod_db."
  else
    echo "STOP: couldn't confirm $ROLE is kept out of production (psql: $(head -1 <<<"$out")). Check by hand."; exit 1
  fi
  unset PGPASSWORD out

  printf 'DATABASE_URL=postgresql://%s:%s@%s/%s%s\n' "$ROLE" "$STAGING_PW" "$pooled_host" "$DB" "$query" >> "$STAGING_FILE"
  printf 'DIRECT_DATABASE_URL=postgresql://%s:%s@%s/%s%s\n' "$ROLE" "$STAGING_PW" "$direct_host" "$DB" "$query" >> "$STAGING_FILE"
  unset STAGING_PW PROD_URL
fi

# --- 2. GitHub "staging" environment -------------------------------------------------
upload=$(mktemp); trap 'rm -f "$upload"' EXIT
grep -E '^(DATABASE_URL|DIRECT_DATABASE_URL|SEED_ADMIN_PASSWORD)=.+' "$STAGING_FILE" > "$upload"
gh secret set -R "$REPO" --env staging -f "$upload"
rm -f "$upload"
gen 64 | gh secret set JWT_ACCESS_SECRET -R "$REPO" --env staging
gen 48 | gh secret set JOBS_TOKEN -R "$REPO" --env staging

# Production's R2 keys must not stay in staging. Use a staging-only R2 token if there is one.
if real "$(value S3_ACCESS_KEY_ID "$STAGING_FILE")" && real "$(value S3_SECRET_ACCESS_KEY "$STAGING_FILE")"; then
  value S3_ACCESS_KEY_ID "$STAGING_FILE" | tr -d '\n' | gh secret set S3_ACCESS_KEY_ID -R "$REPO" --env staging
  value S3_SECRET_ACCESS_KEY "$STAGING_FILE" | tr -d '\n' | gh secret set S3_SECRET_ACCESS_KEY -R "$REPO" --env staging
  r2_note="staging R2 keys set"
else
  gh secret delete S3_ACCESS_KEY_ID -R "$REPO" --env staging 2>/dev/null || true
  gh secret delete S3_SECRET_ACCESS_KEY -R "$REPO" --env staging 2>/dev/null || true
  r2_note="NO staging R2 keys yet: create an R2 token for academy-staging-private, add S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY to $STAGING_FILE, and run this again (staging deploys stop at 'Check required secrets' until then)"
fi

# Backups belong to production-backup only.
for k in BACKUP_PASSPHRASE BACKUP_S3_ACCESS_KEY_ID BACKUP_S3_SECRET_ACCESS_KEY; do
  gh secret delete "$k" -R "$REPO" --env staging 2>/dev/null || true
done

gh variable set ACADEMY_HOSTNAME -R "$REPO" --env staging --body academy-staging.mlopsmena.com
gh variable set SENTRY_ENVIRONMENT -R "$REPO" --env staging --body staging
gh variable delete ACADEMY_REDIRECT_HOSTS -R "$REPO" --env staging 2>/dev/null || true

# Only main (ad-hoc runs) and v* tags may deploy to staging.
echo '{"deployment_branch_policy":{"protected_branches":false,"custom_branch_policies":true}}' \
  | gh api -X PUT "repos/$REPO/environments/staging" --input - --silent
policies=$(gh api "repos/$REPO/environments/staging/deployment-branch-policies" --jq '.branch_policies[] | "\(.type):\(.name)"')
grep -qx 'tag:v\*' <<<"$policies" || gh api -X POST "repos/$REPO/environments/staging/deployment-branch-policies" -f 'name=v*' -f type=tag --silent
grep -qx 'branch:main' <<<"$policies" || gh api -X POST "repos/$REPO/environments/staging/deployment-branch-policies" -f name=main -f type=branch --silent

# Last: the marker deploy-cloudflare.yml requires before it will deploy staging at all.
gh variable set ACADEMY_ENVIRONMENT -R "$REPO" --env staging --body staging

echo "Staging environment re-pointed: database $DB, bucket academy-staging-private, host academy-staging.mlopsmena.com; $r2_note."
echo "Staging admin login: SEED_ADMIN_EMAIL (unchanged) with the SEED_ADMIN_PASSWORD in $STAGING_FILE."

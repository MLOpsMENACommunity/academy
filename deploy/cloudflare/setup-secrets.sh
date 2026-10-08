#!/bin/sh
# One-time setup (re-runnable): reads ~/.config/mlops-academy/deploy.env, generates the
# secrets you don't need to choose, and uploads everything to the 'staging' environment
# of the GitHub repo, which only the main branch may deploy from. No secret is printed;
# the admin login is written to ~/.config/mlops-academy/admin-login.txt.
set -eu
umask 077
DIR="$HOME/.config/mlops-academy"
FILE="${1:-$DIR/deploy.env}"
REPO="MLOpsMENACommunity/academy"
ENVIRONMENT="staging"

[ -f "$FILE" ] || { echo "Create $FILE first (see DEPLOY.md)"; exit 1; }
chmod 600 "$FILE"
value() { grep "^$1=" "$FILE" | head -1 | cut -d= -f2-; }

for k in CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID DATABASE_URL DIRECT_DATABASE_URL RESEND_API_KEY S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY; do
  v=$(value "$k")
  case "$v" in ""|*...*) echo "Fill in $k in $FILE (currently empty or a placeholder)"; exit 1;; esac
done

gen() { openssl rand -base64 64 | tr -dc 'A-Za-z0-9' | head -c "$1"; }
add_if_missing() { grep -q "^$1=" "$FILE" || printf '%s=%s\n' "$1" "$2" >> "$FILE"; }
add_if_missing JWT_ACCESS_SECRET "$(gen 64)"
add_if_missing JOBS_TOKEN "$(gen 48)"
add_if_missing SEED_ADMIN_EMAIL "admin@mlopsmena.com"
add_if_missing SEED_ADMIN_PASSWORD "$(gen 20)"
# Staging shows the placeholder courses as open. Remove this line for production.
add_if_missing SEED_PLACEHOLDER_STATUS "OPEN"
# R2's S3 endpoint is derived from the account id (recomputed every run).
grep -v '^S3_ENDPOINT=' "$FILE" > "$FILE.tmp" && mv "$FILE.tmp" "$FILE"
printf 'S3_ENDPOINT=https://%s.r2.cloudflarestorage.com\n' "$(value CLOUDFLARE_ACCOUNT_ID)" >> "$FILE"

# Environment restricted to the main branch: a pushed branch can't run a modified
# workflow against these secrets.
printf '{"deployment_branch_policy":{"protected_branches":false,"custom_branch_policies":true}}' |
  gh api -X PUT "repos/$REPO/environments/$ENVIRONMENT" --input - >/dev/null
gh api "repos/$REPO/environments/$ENVIRONMENT/deployment-branch-policies" --jq '.branch_policies[].name' 2>/dev/null |
  grep -qx main || gh api -X POST "repos/$REPO/environments/$ENVIRONMENT/deployment-branch-policies" -f name=main >/dev/null

UPLOAD=$(mktemp)
trap 'rm -f "$UPLOAD"' EXIT
grep -E '^[A-Z][A-Z0-9_]*=.+' "$FILE" | grep -v '^ACADEMY_HOSTNAME=' > "$UPLOAD"
gh secret set -R "$REPO" --env "$ENVIRONMENT" -f "$UPLOAD"

printf 'Admin login for the academy:\n  email:    %s\n  password: %s\n' "$(value SEED_ADMIN_EMAIL)" "$(value SEED_ADMIN_PASSWORD)" > "$DIR/admin-login.txt"
echo "Uploaded $(wc -l < "$UPLOAD" | tr -d ' ') secrets to the '$ENVIRONMENT' environment of $REPO (main branch only)."
echo "Admin login saved to $DIR/admin-login.txt"

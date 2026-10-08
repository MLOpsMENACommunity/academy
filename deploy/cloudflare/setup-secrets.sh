#!/bin/sh
# PRODUCTION secrets: reads ~/.config/mlops-academy/deploy.env, generates the secrets you
# don't need to choose (JWT, jobs token, admin password) if missing, and uploads every
# value that is filled in to the GitHub "production" environment, plus the subset the
# nightly backup needs to "production-backup". Values left empty or as "..." are skipped,
# so they never overwrite a real secret. No secret value is printed.
# Staging has its own script and file: setup-staging.sh, ~/.config/mlops-academy/staging.env.
#
#   deploy/cloudflare/setup-secrets.sh [file]
set -eu
FILE="${1:-$HOME/.config/mlops-academy/deploy.env}"
REPO="MLOpsMENACommunity/academy"
[ -f "$FILE" ] || { echo "Create $FILE first (see DEPLOY.md)"; exit 1; }
chmod 600 "$FILE"

gen() { openssl rand -base64 64 | tr -dc 'A-Za-z0-9' | head -c "$1"; }
# A file saved without a final newline would glue the next appended line onto its last one.
[ -s "$FILE" ] && [ -n "$(tail -c1 "$FILE")" ] && echo >> "$FILE"
add_if_missing() { grep -q "^$1=" "$FILE" || printf '%s=%s\n' "$1" "$2" >> "$FILE"; }
add_if_missing JWT_ACCESS_SECRET "$(gen 64)"
add_if_missing JOBS_TOKEN "$(gen 48)"
add_if_missing SEED_ADMIN_EMAIL "admin@mlopsmena.com"
add_if_missing SEED_ADMIN_PASSWORD "$(gen 20)"

# R2's S3 endpoint is derived from the account id.
ACCOUNT_ID=$(grep '^CLOUDFLARE_ACCOUNT_ID=' "$FILE" | cut -d= -f2-)
case "$ACCOUNT_ID" in ''|'...') ;; *) add_if_missing S3_ENDPOINT "https://$ACCOUNT_ID.r2.cloudflarestorage.com" ;; esac

for env in production production-backup; do
  gh api "repos/$REPO/environments/$env" >/dev/null 2>&1 \
    || { echo "The GitHub environment '$env' doesn't exist yet (see DEPLOY.md, 'Environments')"; exit 1; }
done

umask 077
UPLOAD=$(mktemp)
trap 'rm -f "$UPLOAD" "$UPLOAD.b"' EXIT
# Hostnames are GitHub variables, not secrets. Skip blanks and anything still holding a
# "..." placeholder (e.g. the DEPLOY.md template's postgresql://...neon.tech/...).
grep -E '^[A-Z0-9_]+=.+' "$FILE" | grep -v '^ACADEMY_HOSTNAME=' | grep -vF '...' > "$UPLOAD" || true
gh secret set -R "$REPO" --env production -f "$UPLOAD"
grep -E '^(DIRECT_DATABASE_URL|S3_ENDPOINT|S3_ACCESS_KEY_ID|S3_SECRET_ACCESS_KEY|BACKUP_PASSPHRASE|BACKUP_S3_ACCESS_KEY_ID|BACKUP_S3_SECRET_ACCESS_KEY)=' "$UPLOAD" > "$UPLOAD.b" || true
if [ -s "$UPLOAD.b" ]; then gh secret set -R "$REPO" --env production-backup -f "$UPLOAD.b"; fi

echo "Uploaded to 'production' (and the backup subset to 'production-backup'): $(cut -d= -f1 "$UPLOAD" | tr '\n' ' ')"
echo "Skipped (empty or still '...'): $({ grep -E '^[A-Z0-9_]+=$' "$FILE"; grep -E '^[A-Z0-9_]+=' "$FILE" | grep -F '...'; } | cut -d= -f1 | tr '\n' ' ')"
echo "The admin login (SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD) is in $FILE."

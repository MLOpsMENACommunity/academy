#!/bin/sh
# One-time setup: reads ~/.config/mlops-academy/deploy.env, generates the secrets
# you don't need to choose (JWT, jobs token, admin password), and uploads everything
# to this repo's GitHub Actions secrets (staging environment). Nothing is printed
# except the admin login, which you need to sign in.
set -eu
FILE="${1:-$HOME/.config/mlops-academy/deploy.env}"
REPO="MLOpsMENACommunity/academy"
[ -f "$FILE" ] || { echo "Create $FILE first (see DEPLOY.md)"; exit 1; }
chmod 600 "$FILE"

gen() { openssl rand -base64 64 | tr -dc 'A-Za-z0-9' | head -c "$1"; }
add_if_missing() { grep -q "^$1=" "$FILE" || printf '%s=%s\n' "$1" "$2" >> "$FILE"; }
add_if_missing JWT_ACCESS_SECRET "$(gen 64)"
add_if_missing JOBS_TOKEN "$(gen 48)"
add_if_missing SEED_ADMIN_EMAIL "admin@mlopsmena.com"
add_if_missing SEED_ADMIN_PASSWORD "$(gen 20)"
add_if_missing SEED_PLACEHOLDER_STATUS "OPEN"

# R2's S3 endpoint is derived from the account id.
ACCOUNT_ID=$(grep '^CLOUDFLARE_ACCOUNT_ID=' "$FILE" | cut -d= -f2-)
add_if_missing S3_ENDPOINT "https://$ACCOUNT_ID.r2.cloudflarestorage.com"

gh api -X PUT "repos/$REPO/environments/staging" >/dev/null
# ACADEMY_HOSTNAME is configured in wrangler.jsonc, not as a secret.
grep -v '^ACADEMY_HOSTNAME=' "$FILE" | grep -E '^[A-Z_]+=.+' > "$FILE.upload"
gh secret set -R "$REPO" --env staging -f "$FILE.upload"
rm -f "$FILE.upload"

echo "Secrets uploaded to the 'staging' environment of $REPO."
echo "Admin login: $(grep '^SEED_ADMIN_EMAIL=' "$FILE" | cut -d= -f2-) / $(grep '^SEED_ADMIN_PASSWORD=' "$FILE" | cut -d= -f2-)"

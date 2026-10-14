#!/usr/bin/env bash
# Promotes a commit that is already on staging to production, by moving the `production`
# branch to it. Workers Builds then deploys that branch to the production Worker, and its
# build refuses any commit without a staging release record (deploy/cloudflare/build.sh).
#
#   scripts/promote.sh                  promote what main's latest commit is (after staging)
#   scripts/promote.sh 1a2b3c4d5e6f     promote that commit (any commit of main)
#   scripts/promote.sh 1a2b3c4 --rollback   move production BACK to an older staged commit
#   add --yes to skip the confirmation
#
# Normal promotions only move production forward (a fast-forward on main's history). A
# rollback is the one case that moves it back, so it needs --rollback, and it is accepted
# only for a commit that was itself released to staging before.
set -euo pipefail
REMOTE=${REMOTE:-origin}
BRANCH=${PRODUCTION_BRANCH:-production}
ref=""; rollback=false; yes=false
for arg in "$@"; do
  case "$arg" in
    --rollback) rollback=true ;;
    --yes|-y) yes=true ;;
    -*) echo "Unknown option: $arg" >&2; exit 2 ;;
    *) [ -z "$ref" ] || { echo "One commit at a time" >&2; exit 2; }; ref=$arg ;;
  esac
done

git fetch --quiet "$REMOTE" main
git fetch --quiet "$REMOTE" "$BRANCH" 2>/dev/null || true
main=$(git rev-parse "$REMOTE/main")
sha=$(git rev-parse --verify --quiet "${ref:-$main}^{commit}") || { echo "Unknown commit: $ref" >&2; exit 1; }
current=$(git rev-parse --verify --quiet "$REMOTE/$BRANCH" || true)

git merge-base --is-ancestor "$sha" "$main" \
  || { echo "STOP: ${sha:0:12} is not on main. Only commits merged to main reach staging, and only those can be promoted." >&2; exit 1; }
if [ -n "$current" ]; then
  if [ "$current" = "$sha" ]; then echo "production is already at ${sha:0:12}."; exit 0; fi
  if git merge-base --is-ancestor "$current" "$sha"; then
    $rollback && { echo "${sha:0:12} is newer than production: that's a promotion, drop --rollback." >&2; exit 1; }
  else
    $rollback || { echo "STOP: ${sha:0:12} is older than production (${current:0:12}). To go back on purpose, add --rollback." >&2; exit 1; }
  fi
fi

echo "Promote to production: $(git log -1 --format='%h %s (%cs)' "$sha")"
[ -n "$current" ] && echo "production is now at:   $(git log -1 --format='%h %s (%cs)' "$current")"
if [ -n "$current" ] && ! $rollback; then
  echo "Changes going out:"
  git log --oneline --first-parent "$current..$sha" | sed 's/^/  /'
fi
# Informational: the staging build's GitHub check on this commit (the real gate is the
# release record the production build checks).
if command -v gh >/dev/null; then
  url=$(git remote get-url "$REMOTE"); repo=$(sed -E 's#(git@github.com:|https://github.com/)##; s#\.git$##' <<<"$url")
  checks=$(gh api "repos/$repo/commits/$sha/check-runs" --jq '.check_runs[] | "\(.name): \(.conclusion // .status)"' 2>/dev/null || true)
  [ -n "$checks" ] && { echo "Checks on this commit:"; sed 's/^/  /' <<<"$checks"; }
fi
if ! $yes; then
  read -rp "Push ${sha:0:12} to $BRANCH? [y/N] " answer
  [[ "$answer" =~ ^[Yy]$ ]] || { echo "Nothing pushed."; exit 1; }
fi

if $rollback; then
  git push --force-with-lease="$BRANCH:$current" "$REMOTE" "$sha:refs/heads/$BRANCH"
else
  git push "$REMOTE" "$sha:refs/heads/$BRANCH"
fi
echo "Pushed. Workers Builds now deploys ${sha:0:12} to production (Workers & Pages → mlops-academy → Deployments)."
echo "If the build stops at 'Checking ... was released to staging', that commit never passed on staging."

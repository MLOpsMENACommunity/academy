# shellcheck shell=bash
# Sourced by scripts/ci-test.sh and deploy/cloudflare/build.sh (Workers Builds).
#
#   superseded <branch> <sha>
#
# Succeeds when origin/<branch> can be read and points at another commit than <sha>, i.e. a
# newer push will build and deploy instead (every push to main and production builds: the
# guide sets no watch-path excludes on purpose). Sets SUPERSEDED_BY to that commit.
# Fails (returns 1) when <sha> is still the tip, or when the remote can't be read from the
# build machine: then the caller goes ahead, so a network hiccup never blocks a release.
superseded() {
  local tip
  tip=$(GIT_TERMINAL_PROMPT=0 git -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=15 \
    ls-remote --heads origin "refs/heads/$1" 2>/dev/null | cut -f1)
  [ -n "$tip" ] || return 1
  SUPERSEDED_BY=$tip
  [ "$tip" != "$2" ]
}

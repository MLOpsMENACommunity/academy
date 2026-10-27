# Build, test and deploy on Cloudflare Workers Builds

This guide moves the academy's pipeline from GitHub Actions to
[Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/), Cloudflare's
Git-connected build service. It's included in the Workers Paid plan the academy already pays
for ($5/month), so the repository can go private without buying GitHub Actions minutes.

You do every step here once, in the Cloudflare dashboard and on your laptop. Nothing in this
repository turns Workers Builds on by itself, and the GitHub workflows keep working until
step 7.

## How it works

```
merge a PR to main ──► Worker mlops-academy-staging builds the commit:
                         build command   scripts/ci-test.sh              lint, typecheck, unit, API e2e (PGlite)
                         deploy command  deploy/cloudflare/build.sh staging
                                           deploy → smoke test → record academy-releases/staging/<sha>.json
                                                                   │
you test https://academy-staging.mlopsmena.com                     │ required
                                                                   ▼
scripts/promote.sh <sha> ──► branch `production` ──► Worker mlops-academy builds it:
                                                       deploy command  deploy/cloudflare/build.sh production
                                                         refuses a commit with no staging record,
                                                         deploy → smoke test → record production/<sha>.json
```

- **Tests run before every staging deploy.** If `scripts/ci-test.sh` fails, Workers Builds
  never runs the deploy command.
- **Staging comes before production.** Production deploys only the `production` branch,
  and `build.sh production` refuses any commit without a staging release record. That
  record is written only after the commit was deployed to staging and passed the smoke
  test. It lives in the R2 bucket `academy-releases`, which no app credential can reach.
- **Staging never runs on production's database.** The staging Worker checks its own
  `DATABASE_URL` and `DIRECT_DATABASE_URL` on every request (staging role, staging
  database, as the GitHub deploy did). If they're wrong it answers 503 and never starts a
  container (`deploy/cloudflare/src/staging-guard.ts`).
- **Each Worker builds only itself.** A build checks the branch, the `ACADEMY_ENVIRONMENT`
  build variable and the Worker it's connected to. A build configured on the wrong Worker
  stops before it deploys anything.
- **Overlapping builds can't roll the site back.** A build whose commit is no longer the tip
  of its branch skips its tests and its deploy (checked before the tests, before the deploy
  and during the smoke test); the newer commit's build deploys.
- **Runtime secrets stay on the Workers.** They're already there (every GitHub deploy set
  them), and a deploy never changes them. The build itself needs no secrets: the tests use
  an in-memory database, and the API runs its migrations when its container starts.

## What Workers Builds gives us (checked October 2026)

| | Workers Paid | Source |
|---|---|---|
| Build minutes | 6,000/month included, then $0.005/minute | [Limits & pricing](https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/) |
| Build timeout | 20 minutes per build | same |
| Concurrent builds | 6 | same |
| Machine | 4 vCPU, 8 GB RAM, 20 GB disk, Ubuntu 24.04 x86_64 | same, [Build image](https://developers.cloudflare.com/workers/ci-cd/builds/build-image/) |
| Node / pnpm | Node from `.nvmrc` (24); pnpm from `PNPM_VERSION` | [Build image](https://developers.cloudflare.com/workers/ci-cd/builds/build-image/) |
| Cache | pnpm store, 10 GB, kept 7 days after last use (no Docker layer cache documented) | [Build caching](https://developers.cloudflare.com/workers/ci-cd/builds/build-caching/) |
| Containers | "Dockerfile builds can run in the Workers Builds environment"; `wrangler deploy` on the production branch builds, pushes and rolls out the images | [Deploy Containers](https://developers.cloudflare.com/containers/guides/deploy/#deploy-with-workers-builds) |
| Two environments | One Worker per Wrangler environment, each connected to the repo with its own deploy command (`--env staging`) | [Advanced setups](https://developers.cloudflare.com/workers/ci-cd/builds/advanced-setups/#wrangler-environments) |
| Previews | Not available for Workers with Durable Objects (containers): leave preview builds **off** | [Deploy Containers](https://developers.cloudflare.com/containers/guides/deploy/#before-production) |

The pipeline is designed so that a staging build takes about 9 minutes and a production
build about 6 (see [Minutes and cost](#minutes-and-cost)), well under the 20-minute limit.

## Before you start

You need:

- the Cloudflare dashboard (account owner) and admin rights on the GitHub organisation;
- your laptop with this repository, `gh`, and `~/.config/mlops-academy/deploy.env`;
- the current values of the GitHub environment **variables** (not secrets): GitHub →
  Settings → Environments → `staging` / `production` → Variables. You'll copy them into the
  build settings below.

Once the staging build is connected (step 2), release only through Workers Builds: don't
push `v*` tags or run the GitHub release workflows any more. Both would deploy the same
Workers, and the GitHub one would also re-upload the runtime secrets from GitHub.

### 0. Create the build API token

Workers Builds can make its own token, but that token can't touch containers. So create one:
Cloudflare dashboard → **My Profile → API Tokens → Create Token → Custom token**.
Only user tokens work for builds today.

- Name: `workers-builds-academy`
- Permissions:
  - Account → **Workers Scripts: Edit**
  - Account → **Containers: Edit**
  - Account → **Workers R2 Storage: Edit** (app buckets and `academy-releases`)
  - Account → **Account Settings: Read**
  - Zone `mlopsmena.com` → **Workers Routes: Edit**
  - Zone `mlopsmena.com` → **DNS: Edit** (custom domains)
  - User → **User Details: Read**, User → **Memberships: Read**
- Account resources: this account only. Zone resources: `mlopsmena.com` only.

These are the scopes of today's `CLOUDFLARE_API_TOKEN` plus the two User permissions that
Cloudflare's own build token has. You select this token in each build configuration; you
never paste its value anywhere.

## 1. Connect the GitHub app

1. Cloudflare dashboard → **Workers & Pages** → `mlops-academy-staging` → **Settings → Build
   → Connect**.
2. Choose **GitHub**, and install the **Cloudflare Workers and Pages** app on the
   `MLOpsMENACommunity` organisation if asked. Under **Repository access**, choose **Only
   select repositories → academy**.
3. Pick the repository `MLOpsMENACommunity/academy`.

The app keeps working after the repository goes private.

## 2. Configure the staging build (Worker `mlops-academy-staging`)

**Settings → Build**:

| Setting | Value |
|---|---|
| Git repository | `MLOpsMENACommunity/academy` |
| Branch control → Git branch | `main` |
| Branch control → Enable preview builds | **Off** (see [Pull requests](#pull-requests)) |
| Build command | `bash scripts/ci-test.sh` |
| Deploy command | `bash deploy/cloudflare/build.sh staging` |
| Root directory | *(empty: the repository root; the images build from it)* |
| API token | `workers-builds-academy` |
| Build cache | **Enable** |
| Build watch paths | Include `*`, exclude nothing |

Keep the watch paths at "everything": a build whose commit is no longer the tip of `main`
skips its tests and deploy, because the newer commit's build deploys instead. If the newer
commit didn't build (say it only touched docs and docs were excluded), nothing would deploy
and neither commit would get a staging release record.

**Settings → Build → Variables and secrets** (build-time only; the Worker never sees them):

| Name | Value | Where it comes from today |
|---|---|---|
| `ACADEMY_ENVIRONMENT` | `staging` | GitHub `staging` environment variable of the same name |
| `ACADEMY_HOSTNAME` | `academy-staging.mlopsmena.com` | GitHub `staging` variable |
| `SENTRY_ENVIRONMENT` | `staging` | GitHub `staging` variable |
| `EMAIL_ALLOWLIST` | the testers' addresses (comma-separated) | GitHub `staging` variable. Add it as a **Secret** (it's personal data) |
| `EMAIL_REDIRECT_TO` | only if the GitHub `staging` variable is set | GitHub `staging` variable; otherwise `admin@mlopsmena.com` from `wrangler.jsonc` |
| `ACADEMY_REDIRECT_HOSTS` | only if the GitHub `staging` variable is set | GitHub `staging` variable |
| `EDGE_PURGE_ZONE_ID` | optional: the zone id of `mlopsmena.com` (purges the edge cache after an admin edit; needs the `EDGE_PURGE_API_TOKEN` secret) | GitHub `staging` variable, if set |
| `PNPM_VERSION` | `10.34.6` | `packageManager` in `package.json` |
| `SKIP_DEPENDENCY_INSTALL` | `1` | the scripts install with `--frozen-lockfile` themselves |

Not needed any more: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` (the build token
and account come from the build configuration), and `DATABASE_URL` /
`DIRECT_DATABASE_URL` (migrations run when the API container starts, with the Worker's
own secrets; the tests use PGlite). No database password is ever in a build.

**Runtime secrets** (Settings → Variables and Secrets, the Worker's own): check that they
are all listed. Every GitHub deploy set them, so they should be:
`DATABASE_URL`, `DIRECT_DATABASE_URL`, `JWT_ACCESS_SECRET`, `JOBS_TOKEN`,
`RESEND_API_KEY`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`,
`SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, plus the optional `SEED_PLACEHOLDER_STATUS`,
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SENTRY_DSN`, `REVALIDATE_TOKEN` (otherwise
derived from `JOBS_TOKEN`), `EDGE_PURGE_API_TOKEN` (see DEPLOY.md, "How fast an admin
edit shows") and `TELEGRAM_BOT_TOKEN` with `TELEGRAM_WEBHOOK_SECRET` (DEPLOY.md, "Telegram
course groups"). The deploy stops if a required
one is missing. Set or rotate any of them with
`deploy/cloudflare/set-worker-secret.sh staging NAME`.

## 3. First staging deploy, and check it

1. Start a build: merge any PR to `main`, or **Deployments → View build history → Retry
   build** once there is one.
2. Watch the log (Deployments → the build). You should see `ci-test.sh` pass, then
   `build.sh` go through: build checks → secrets present → configure → buckets → deploy
   (both images) → smoke test → *Recording the staging release*.
3. Check:
   - `curl -s https://academy-staging.mlopsmena.com/api/health` shows `"release"` = the
     first 12 characters of the commit;
   - R2 → `academy-releases` → `staging/<sha>.json` exists;
   - the commit on GitHub has a green **Workers Builds** check;
   - the build took under 15 minutes (Deployments shows the duration).

If the deploy step fails with a Docker error, see [If Docker isn't available](#if-docker-isnt-available-in-the-build).

## 4. Create the production branch

On your laptop, promote the commit staging just released (it creates the branch):

```bash
scripts/promote.sh <sha from step 3>
```

Nothing deploys yet: no Worker is listening to `production`.

## 5. Configure the production build (Worker `mlops-academy`)

Connect the repository as in step 1, on the Worker **`mlops-academy`**, then **Settings → Build**:

| Setting | Value |
|---|---|
| Branch control → Git branch | `production` |
| Branch control → Enable preview builds | **Off** |
| Build command | *(empty: this exact commit already passed the tests on staging, and the deploy checks that)* |
| Deploy command | `bash deploy/cloudflare/build.sh production` |
| Root directory | *(empty)* |
| API token | `workers-builds-academy` |
| Build cache | **Enable** |
| Build watch paths | Include `*`, exclude nothing (every promotion deploys) |

Build variables:

| Name | Value | Where it comes from today |
|---|---|---|
| `ACADEMY_ENVIRONMENT` | `production` | GitHub `production` variable |
| `ACADEMY_HOSTNAME` | `academy.mlopsmena.com` | GitHub `production` variable |
| `SENTRY_ENVIRONMENT` | `production` | GitHub `production` variable |
| `ACADEMY_REDIRECT_HOSTS` | only if the GitHub `production` variable is set | GitHub `production` variable |
| `EDGE_PURGE_ZONE_ID` | optional, as for staging | GitHub `production` variable, if set |
| `PNPM_VERSION` | `10.34.6` | `package.json` |
| `SKIP_DEPENDENCY_INSTALL` | `1` | |

Production's runtime secrets: the same list as staging, without `DIRECT_DATABASE_URL`
being required. Set or rotate them with `deploy/cloudflare/set-worker-secret.sh production NAME`.

## 6. First production deploy, rollback drill

1. Connecting may start a build of `production` at once. If it doesn't, promote the next
   staged commit (`scripts/promote.sh`), or use **Retry build**.
2. Check the log: *Checking … was released to staging* must print the staging record. Then
   check `https://academy.mlopsmena.com/api/health` (`release` = the commit) and
   R2 → `academy-releases` → `production/<sha>.json`.
3. **Rollback drill**, while nothing is at stake:
   - instant: **Workers & Pages → mlops-academy → Deployments → Rollback** to the previous
     version;
   - then put the branch back where the site is:
     `scripts/promote.sh <previous staged sha> --rollback` (a full rebuild, ~6 minutes),
     and promote the newer commit again when you're done.

## 7. Turn off the GitHub workflows, then make the repository private

Only after steps 3 and 6 worked. Open a small PR that changes the triggers (nothing is
deleted, so you can switch back):

```diff
 # .github/workflows/ci.yml
 on:
-  pull_request:
-    types: [opened, synchronize, reopened, ready_for_review]
-    paths-ignore:
-      - '**/*.md'
-      - 'docs/**'
+  # Off since Workers Builds runs the tests (deploy/cloudflare/WORKERS-BUILDS.md).
+  # Run by hand when you want the browser (Playwright) tests: Actions → CI → Run workflow.
+  workflow_dispatch:
   # release-staging.yml runs CI on a tag whose commit has no passing CI run yet.
   workflow_call:
```

```diff
 # .github/workflows/release-staging.yml
 on:
-  push:
-    tags: ['v*']
   workflow_dispatch:
```

`release-production.yml` and `deploy-cloudflare.yml` already run only by hand or when
called, so leave them. Keep `backup.yml`: it's the nightly database backup and costs about
31 minutes a month (well inside the free 2,000). From then on, stop pushing `v*` tags.

Then GitHub → **Settings → General → Danger Zone → Change repository visibility →
Private**. After that, check that a merge to `main` still starts a staging build (the
Cloudflare app keeps its access).

To switch back at any time: revert that PR, and in each Worker → Settings → Build →
**Disconnect**.

## Day to day

| Task | How |
|---|---|
| Release to staging | Merge to `main`. The staging build tests, deploys and records it. |
| Release to production | Test on staging, then `scripts/promote.sh` (latest `main`) or `scripts/promote.sh <sha>`. |
| Roll back production | Dashboard rollback (instant), then `scripts/promote.sh <older staged sha> --rollback`. |
| Re-run a deploy | Worker → Deployments → View build history → **Retry build**. |
| Rotate a secret | `deploy/cloudflare/set-worker-secret.sh <staging\|production> NAME`. No redeploy: the containers restart with the new value on their next request. |
| Change a hostname | Change `ACADEMY_HOSTNAME` / `ACADEMY_REDIRECT_HOSTS` in the Worker's build variables, then retry the latest build. |
| Test before merging | `scripts/ci-test.sh` locally (uses your `DATABASE_URL` if set, else PGlite); `pnpm e2e` against `docker compose` for browser tests. |
| Which commit is live? | `curl -s https://<host>/api/health` → `release`; or R2 `academy-releases`. |

### Pull requests

Preview builds stay **off**. They would run the full test suite on every push to every
branch, and the academy's launch week (156 PR pushes in 5 days) would have used about 4,500
minutes a month on those alone (see below). Instead:

- run `scripts/ci-test.sh` before you mark a PR ready (the same gate the build runs);
- the staging build runs it again on `main` before anything deploys, so a broken merge
  never reaches staging, let alone production;
- for UI changes, run the browser tests locally (`docker compose up -d --build --wait &&
  pnpm e2e`), or run **CI** by hand on GitHub (about 15 minutes of the free 2,000).

If you later want a check on every PR, turn on preview builds on `mlops-academy-staging`
with the Preview command `npx wrangler versions upload --env staging`. It uploads an
inactive version, never deploys or touches the containers, and the build command runs the
tests. Watch the minutes if you do.

## Minutes and cost

From the GitHub Actions history (2-vCPU runners; the 4-vCPU build machines should be at
least as fast): the tests took about 4 minutes, and `wrangler deploy` with both image
builds took 3.5 to 4 minutes, with no layer cache in either case.

| Build | Steps | Estimate |
|---|---|---|
| Staging (each merge to `main`) | clone, install (cached), lint, typecheck, unit, API e2e on PGlite, deploy both images, smoke test | about 9 min (limit 20) |
| Production (each promotion) | install deploy tools, record check, deploy both images, smoke test | about 6 min |

| Month | Staging builds | Production builds | Minutes | Cost |
|---|---|---|---|---|
| Quiet (6 merges a day, 1 promotion a day) | 180 × 9 = 1,620 | 30 × 6 = 180 | ≈ 1,800, plus ~10% retries ≈ **2,000** | $0 |
| Launch-week pace all month (12 merges a day) | 360 × 9 = 3,240 | 30 × 6 = 180 | ≈ 3,400, plus retries ≈ **3,800** | $0 |
| Same, with preview builds on (30 PR pushes a day, ~5 min each) | | | ≈ 8,300 | ≈ $11 over |

All of it fits in the 6,000 included minutes as long as preview builds stay off. A build
that is superseded while it waits or tests stops early (a minute or two instead of 9), so
bursts of merges cost less than the table. Overage would be $0.005 a minute.
Check the Workers Builds minutes on the account's billing/usage page in the Cloudflare
dashboard once a month. GitHub Actions drops to the nightly backup, about 31 minutes a month.

## If Docker isn't available in the build

Cloudflare documents that Dockerfile builds run in Workers Builds, so this shouldn't
happen. If the first staging deploy fails with "Docker is not running / not found" anyway,
use this hybrid; it isn't built yet, ask for it if needed:

1. A small GitHub workflow, on pushes to `main` and `production`, runs
   `wrangler containers build --push` for both Dockerfiles (with `image_vars` as build
   args), tagged with the commit (`registry.cloudflare.com/<account>/mlops-academy-*:<sha>`).
2. `build.sh` waits for those tags, sets `image` in `wrangler.jsonc` to them instead of the
   Dockerfiles, and deploys as now (no Docker needed at deploy time:
   [Image management](https://developers.cloudflare.com/containers/platform-details/image-management/)).

Cost: about 4 minutes of GitHub Actions per build, so 180 staging + 30 production builds
are about 850 minutes a month, inside the free 2,000. Tests and deploys stay on Workers Builds.

## Troubleshooting

| Message in the build log | Meaning |
|---|---|
| `ACADEMY_ENVIRONMENT is '…', expected '…'` | The build variable is missing or belongs to the other Worker. |
| `deploys only from the '…' branch` | Branch control points at the wrong branch, or preview builds run `build.sh`. |
| `this build belongs to the Worker '…'` | The deploy command names the other environment. |
| `… is at … now …: skipping` / `moved on to …` | A newer commit landed while this one built; its build deploys. Not an error. |
| `has no staging release record` | That commit never passed on staging. Merge to `main`, let staging release it, then promote it. |
| `is missing the secrets: …` | Set them with `set-worker-secret.sh`, then retry the build. |
| `never reported release … (gave up after 8 minutes)` | The new containers didn't start. Look at **Containers** in the dashboard and `wrangler tail`. |
| `the tests of … were skipped` | The tests were skipped because the branch had moved on, then it moved back (a force push). Retry the build of the branch's latest commit. |
| Staging answers 503 "Staging is misconfigured" | Its database secrets aren't staging's own (Worker logs say which). Fix them with `set-worker-secret.sh staging DATABASE_URL DIRECT_DATABASE_URL`. |
| `Build was timed out` | Over 20 minutes. Check for a hung test or a slow image build, and retry. |
| `The name in your Wrangler configuration file … must match` | The deploy command lacks the right environment (`build.sh staging` on `mlops-academy-staging`). |

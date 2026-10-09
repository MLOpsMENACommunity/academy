# Deploying to Cloudflare

The academy runs on Cloudflare in two separate environments. Each one is a Worker
that sits in front of two **Cloudflare Containers**:

```
academy.mlopsmena.com (production)      academy-staging.mlopsmena.com (staging)
        │                                        │
   Worker mlops-academy                    Worker mlops-academy-staging
     ├── /api/*   → ApiContainer   (apps/api/Dockerfile, NestJS)
     ├── /*       → WebContainer   (apps/web/Dockerfile, Next.js)
     └── cron     → POST /api/internal/jobs/tick (hourly)
                       │
          Neon Postgres · private R2 bucket · Resend
```

Production runs one API container and up to three web containers (`standard-1`), and
staging one `basic` container of each; see [Capacity and caching](#capacity-and-caching).
Containers sleep after 2 idle hours in production (30 minutes on staging). The first
request after a sleep takes a few seconds while the container starts. Database migrations run when the API container starts. The seed is
idempotent and also runs on start: it creates the admin, the settings and the
placeholder courses.

## Environments

Both environments are built from `deploy/cloudflare/wrangler.jsonc`: production is the
top level, staging is `env.staging`. Staging has its own Worker, containers, Durable
Objects, database (and database role), bucket (and R2 token), JWT secret and jobs token,
and it never emails real people. It shares two credentials with production: the
Cloudflare API token (Cloudflare can't limit a token to one Worker) and the Resend key.

| | Production | Staging |
|---|---|---|
| URL | https://academy.mlopsmena.com | https://academy-staging.mlopsmena.com |
| GitHub environment | `production` (only `v*` tags may deploy) | `staging` (`v*` tags and `main`) |
| Worker | `mlops-academy` | `mlops-academy-staging` |
| Containers | `mlops-academy-apicontainer`, `mlops-academy-webcontainer` | `mlops-academy-staging-apicontainer`, `mlops-academy-staging-webcontainer` |
| Database (Neon, same project) | `neondb` | `academy_staging`, owned by the role `academy_staging`, which can't read production |
| R2 bucket | `academy-private` | `academy-staging-private` |
| Secrets file on your laptop | `~/.config/mlops-academy/deploy.env` | `~/.config/mlops-academy/staging.env` |
| Email | Real recipients | Everyone not on `EMAIL_ALLOWLIST` is redirected to `EMAIL_REDIRECT_TO` (`admin@mlopsmena.com`), with the original recipient in the subject |
| Sentry environment | `production` | `staging` |

A third GitHub environment, `production-backup`, holds only what the nightly database
backup needs (see [OPERATIONS.md](OPERATIONS.md#backups-and-restore)).

The production Worker's name and container classes must never change: renaming them
would create new Durable Objects and containers instead of updating the live ones.

## Releasing

Every change reaches production the same way: **tag → staging → test → promote that tag.**
Nothing deploys from a branch, and production only accepts a tag that has already
been released to staging.

**Tags** are dated: `vYYYY.MM.DD-N`, where `N` counts the releases of that day
(`v2026.10.08-1`, `v2026.10.08-2`, …). Tag a commit on `main`.

1. **Release to staging.** Tag the commit and push the tag:

   ```bash
   git checkout main && git pull
   git tag v2026.10.08-1
   git push origin v2026.10.08-1
   ```

   The **Release to staging** workflow starts on its own. It reuses the CI run of that
   commit on `main` (waiting for it if it's still running), or runs CI on the tag if
   there is none. Then it deploys the tag to staging, smoke-tests it, and records it as
   a successful staging release. The run summary has the link.

   To re-deploy an existing tag to staging: **Actions → Release to staging → Run
   workflow**, and enter the tag.

2. **Test it** on https://academy-staging.mlopsmena.com. Sign in as `SEED_ADMIN_EMAIL`
   with the `SEED_ADMIN_PASSWORD` from `staging.env`. Emails arrive at
   `EMAIL_REDIRECT_TO`.

3. **Promote the same tag to production.** **Actions → Release to production → Run
   workflow**:
   - **Use workflow from:** switch to **Tags** and pick the tag (the production
     environment only accepts `v*` tags, so a run from `main` is refused);
   - **tag:** the same tag.

   Or from a terminal:

   ```bash
   gh workflow run release-production.yml --repo MLOpsMENACommunity/academy \
     --ref v2026.10.08-1 -f tag=v2026.10.08-1
   ```

   The workflow refuses a tag whose commit has no successful staging release. It
   deploys that exact commit to production, smoke-tests https://academy.mlopsmena.com,
   and creates a GitHub Release for the tag with generated notes.

New features always reach staging first. A fix for production is a new tag too: tag
it, let it reach staging, check it, promote it.

**Approvals.** Required reviewers on the `production` environment need a paid GitHub
plan (or a public repo), which the organisation doesn't have yet. Until then the gates
are: only people with write access can run the workflow, only `v*` tags can deploy to
production, and only tags already released to staging are accepted. Once the plan
allows it, add a reviewer and every production run waits for approval:

```bash
gh api -X PUT repos/MLOpsMENACommunity/academy/environments/production --input - <<'JSON'
{"reviewers":[{"type":"User","id":26551277}],"deployment_branch_policy":{"protected_branches":false,"custom_branch_policies":true}}
JSON
```

### Roll back

Run **Release to production** again with the previous tag (it was released to staging
before, so it's accepted). The GitHub Release of that tag already exists and is left as
it is.

For the fastest possible rollback, Cloudflare dashboard → Workers & Pages →
`mlops-academy` → Deployments → roll back. Then re-promote a good tag, so the next
release starts from a known state.

**Database migrations are forward-only.** Rolling the code back doesn't roll the
database back, so the previous version must still work with the new schema. Make
schema changes in two releases (expand, then contract):

1. **Expand:** add the new column or table, keep the old one, and write both. Both the
   old and the new code work with this schema.
2. **Contract:** once nothing reads the old column, drop it in a later release.

Never rename or drop something in the same release that stops using it. See
[OPERATIONS.md](OPERATIONS.md#incident-checklist) for the one known exception (PR #13).

## Costs

- Workers Paid: $5/month, required for Containers. It includes 25 GiB-hours
  of memory and 375 vCPU-minutes per month, shared by both environments. Staging's
  cron runs hourly so its containers can sleep.
- Neon: free tier (both databases in one project).
- R2: free tier, up to 10 GB.
- Resend: free tier at first.

See `docs/COST_ANALYSIS.md`, which is local only and not in git.

Containers are billed while awake: memory and disk for the instance size, CPU only when
busy. A `standard-1` (½ vCPU, 4 GiB, 8 GB) awake all month costs about $27 in memory and
disk plus up to $26 in CPU at full load; a `basic` (¼ vCPU, 1 GiB) about $7 plus up to $13.
Production at launch size (four `standard-1`) is roughly $110–140/month if nothing sleeps;
staging stays at two `basic`, under $20 and usually much less because it sleeps.

## Capacity and caching

The load test before launch (Locust, anonymous visitors, staging on one `basic` web
container) showed the web container as the bottleneck: course pages took 5 s at the median
with 50 visitors and 30 s with 300, while the API's `/health` stayed at 0.4 s. So:

- **Public pages are static (ISR).** Home, catalog, course, live sessions (list and
  detail), recordings, speakers, policies, login and register render once per revalidate
  window (60 s; home, login and register 300 s) and are served from Next's cache. Nothing
  personal is in their HTML: the header, my application status and Notify me load in the
  browser after the page. Catalog and recordings filters run in the browser too (the URL
  keeps them). `next build` lists these routes as ● with a revalidate time.
- **API-backed pages render on first request, not at build.** The API isn't reachable
  while the image builds, so `scripts/drop-isr-prerenders.mjs` removes those build-time
  renders; otherwise each fresh container (deploy, wake from sleep) would show its first
  visitors an empty catalog.
- **Cloudflare's edge caches anonymous page views** for up to 60 s (Workers Cache API in
  `deploy/cloudflare/src/edge-cache.ts`, which lists exactly what is and isn't cached). Never
  cached: requests with a session cookie (`access_token`, `has_session`), `/api/*`, non-GET,
  Next's client-navigation (RSC) requests, signed-in areas, and any response that sets a
  cookie, isn't a 200, is `private`/`no-store`, or is a stale ISR copy. Build assets
  (`/_next/static`, immutable) are cached for everyone. Responses carry `x-edge-cache:
  HIT|MISS|BYPASS`. Each data centre has its own cache.
- **An admin edit shows publicly within about 2 minutes** (Next's 60 s window plus the
  edge's 60 s; the home page up to ~6 minutes). There is no on-demand revalidation yet.
- **Web containers:** `max_instances: 3`, and the Worker spreads requests at random over
  `WEB_INSTANCES` of them (3 in production, 1 on staging). The Worker caps it at
  `MAX_WEB_INSTANCES` in `src/instances.ts` (a test keeps that equal to `max_instances`)
  and uses only `main` if the value is invalid. They are stateless; each has
  its own ISR cache, so two visitors may briefly see versions up to one revalidate window
  apart. Lower `WEB_INSTANCES` after launch to save cost; it never needs to exceed
  `max_instances`.
- **API container:** exactly one (`max_instances: 1`), now `standard-1`: rate limits and
  the login lockout are in memory.
- If a container can't be reached (starting, overloaded), the Worker answers 503 with
  `Retry-After: 5` instead of an opaque 500.
- **API down while a page renders:** ISR pages load their main data with `serverGet`,
  which throws, so Next keeps serving the last good copy, or (a fresh container with
  none yet) answers a 500 that neither Next nor the edge caches. They never cache an
  empty "no courses" page.
- **Recordings search** runs in the browser against `GET /api/recordings/search` (ids
  only), limited to 60 a minute per IP. Plain `/api/recordings` reads, which the web
  server makes for every visitor, stay unthrottled unless they carry `?q=`.

## One-time setup

1. **Cloudflare plan.** Upgrade the account to **Workers Paid** (Workers &
   Pages → Plans), and enable **R2** (R2 → Get started; it needs a payment
   method but stays within the free tier).
2. **Cloudflare API token** (My Profile → API Tokens → Create Custom Token):
   - Account → Workers Scripts: Edit
   - Account → Containers: Edit
   - Account → Workers R2 Storage: Edit
   - Account → Account Settings: Read
   - Zone `mlopsmena.com` → Workers Routes: Edit
   - Zone `mlopsmena.com` → DNS: Edit
3. **Neon.** Create a project in Frankfurt (`aws-eu-central-1`) and copy the
   **pooled** and the **unpooled** connection strings. Both end with `?sslmode=require`.
   The staging database is created later by `setup-staging.sh`.
4. **R2 credentials, one token per bucket.** R2 → Manage API tokens → Create
   **Account API token**, with **Object Read & Write** on `academy-private` only, for
   production. Create a second one on `academy-staging-private` only, for staging.
   Never give staging a token that can reach the production bucket.
5. **Resend.** Add the domain `mlopsmena.com`; with Resend's Cloudflare
   integration, the SPF/DKIM records are added for you. Then create an API key
   with **Sending access** only.
6. **Optional: Google sign-in.** Create an OAuth client (Web) with the redirect URIs
   `https://academy.mlopsmena.com/api/auth/google/callback` and
   `https://academy-staging.mlopsmena.com/api/auth/google/callback`.
7. **Local secrets files** (never commit them, never paste them into chat):

   ```bash
   mkdir -p ~/.config/mlops-academy
   cat > ~/.config/mlops-academy/deploy.env <<'ENV'
   CLOUDFLARE_API_TOKEN=...
   CLOUDFLARE_ACCOUNT_ID=...
   DATABASE_URL=postgresql://...-pooler...neon.tech/neondb?sslmode=require
   DIRECT_DATABASE_URL=postgresql://...neon.tech/neondb?sslmode=require
   RESEND_API_KEY=re_...
   S3_ACCESS_KEY_ID=...
   S3_SECRET_ACCESS_KEY=...
   BACKUP_PASSPHRASE=...
   # optional
   GOOGLE_CLIENT_ID=
   GOOGLE_CLIENT_SECRET=
   ENV
   chmod 600 ~/.config/mlops-academy/deploy.env
   ```

   For staging, put only the staging R2 keys in `~/.config/mlops-academy/staging.env`
   (`S3_ACCESS_KEY_ID=…`, `S3_SECRET_ACCESS_KEY=…`); `setup-staging.sh` adds the rest.
8. **Upload the production secrets** to the `production` and `production-backup`
   environments. This generates the JWT secret, the jobs token and the admin password
   if they're missing. Values left as `...` are skipped, so they never overwrite a
   real secret:

   ```bash
   deploy/cloudflare/setup-secrets.sh
   ```

9. **Set up staging** (creates the staging database and role, and fills the `staging`
   environment):

   ```bash
   deploy/cloudflare/setup-staging.sh
   ```

You can also add or change secrets by hand in Settings → Environments.

The `production` environment has the variables `ACADEMY_ENVIRONMENT=production`,
`ACADEMY_HOSTNAME=academy.mlopsmena.com` and `SENTRY_ENVIRONMENT=production`. The
`staging` environment has `ACADEMY_ENVIRONMENT=staging`,
`ACADEMY_HOSTNAME=academy-staging.mlopsmena.com` and `SENTRY_ENVIRONMENT=staging`.
A deploy refuses to run unless `ACADEMY_ENVIRONMENT` matches the environment, and a
staging deploy also refuses database URLs that don't point at a staging database.
`setup-staging.sh` sets the staging marker last, once staging's secrets are its own.

Only production is indexed by search engines. `configure-host.mjs` writes the deploy
target into the Worker's `ACADEMY_ENVIRONMENT` var and the web build's
`NEXT_PUBLIC_ACADEMY_ENVIRONMENT`. Anything other than `production` gets
`robots.txt` with `Disallow: /` and `X-Robots-Tag: noindex, nofollow` on every response
(from the Worker, `deploy/cloudflare/src/robots.ts`), and the web app's own robots.txt,
sitemap and `<meta name="robots">` say the same. Canonical and `og:url` links on staging
point at staging on purpose: staging content differs from production, and noindex already
keeps it out of search results.

## What a deploy does

Both release workflows call `.github/workflows/deploy-cloudflare.yml` with the
environment and the tag. It:

1. checks out the tag, and checks it still points at the commit that was verified;
2. checks the environment's `ACADEMY_ENVIRONMENT` marker (and, on staging, that the
   database is a staging one), and that every required secret is set;
3. points `wrangler.jsonc` at that environment's hostname (`configure-host.mjs`, which
   refuses to let staging claim a production hostname, share its bucket or drop the
   email redirect, and the other way round);
4. creates the environment's R2 bucket if it doesn't exist yet;
5. runs `wrangler deploy` (production) or `wrangler deploy --env staging`, which builds
   both images (linux/amd64) on the runner and pushes them;
6. sets the runtime secrets on that Worker;
7. waits for `/api/health` and `/en` to respond on that environment's host.

## Change a hostname

No code change is needed. In GitHub → Settings → Environments → `production` (or
`staging`) → **Variables**, set:

| Variable | Value |
|---|---|
| `ACADEMY_HOSTNAME` | the new canonical host |
| `ACADEMY_REDIRECT_HOSTS` | optional, comma-separated old hosts that 301 to the new one |
| `SENTRY_ENVIRONMENT` | optional |

Then release a tag. Cloudflare creates the DNS record and certificate for each host
(`custom_domain: true`). A host can only belong to one Worker: production can't take
`academy-staging.mlopsmena.com`, and staging can't take a production host.

If Google sign-in is enabled, add the new callback URL to the OAuth client first.

## Operating

Add `--env staging` to any of these to act on staging instead of production.

| Task | How |
|---|---|
| Live logs | `pnpm --filter @academy/deploy-cloudflare exec wrangler tail --env=""` |
| Container status | `pnpm --filter @academy/deploy-cloudflare exec wrangler containers list` |
| Roll back | Release to production with the previous tag (see [Roll back](#roll-back)) |
| Database backups | Neon point-in-time restore, plus a daily encrypted dump of production to R2 (`backup.yml`, `production-backup` environment); restore steps in [OPERATIONS.md](OPERATIONS.md) |
| Email DNS, logs, Sentry, analytics | [OPERATIONS.md](OPERATIONS.md) |

## Limits to know

- **Promotion rebuilds the images.** Production builds the same commit again rather than
  reusing staging's images, so an unpinned base image could differ. A rollback by tag
  takes as long as a deploy; the Cloudflare dashboard rollback is instant.
- **One pending release per environment.** If you push several tags quickly, a waiting
  staging release is replaced by the newest one. Re-run a skipped tag by hand if you
  need it on staging.
- **Old `academy-staging` links now open staging.** Links to
  `academy-staging.mlopsmena.com` used to redirect to production; they now reach the
  staging site and its separate database.

- **Single API instance.** Rate limits and the login lockout are in memory, so
  keep the API at `max_instances: 1` until they move to a shared store. The web app
  has no such state and runs several instances.
- **Cold starts.** After 2 idle hours (staging: 30 minutes) the next request waits a
  few seconds for a container to start. The edge cache doesn't help here: its entries
  (60 s) are long gone by then.
- **Deploys and mixed builds.** Containers roll out after the Worker, so for a while old
  and new web builds serve side by side (`rollout_step_percentage: 100` keeps that short),
  and a data centre can serve the previous HTML for up to 60 s. Build assets
  (`/_next/static`) exist only on their own build: the Worker retries a 404 for one on the
  other web instances, and Next's `deploymentId` (the deployed git SHA, set by
  `configure-host.mjs`) turns a client navigation across builds into a full page load.
- **No in-process cron.** `JOBS_ENABLED=false` in the container; the Worker's
  Cron Trigger runs the jobs instead.

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
Containers sleep after 5 idle minutes in production and staging (`SLEEP_AFTER` in `wrangler.jsonc`). The first
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

> **Moving to Cloudflare Workers Builds.** So the repository can be private without paying
> for GitHub Actions minutes, building, testing and deploying move to Workers Builds,
> which the Workers Paid plan includes. Set it up with
> [deploy/cloudflare/WORKERS-BUILDS.md](deploy/cloudflare/WORKERS-BUILDS.md). Until you
> have done that and switched the GitHub workflows off (its step 7), the tag flow below is
> still the way to release. After the switch, use [Releasing with Workers Builds](#releasing-with-workers-builds).

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

### Releasing with Workers Builds

After the switch ([WORKERS-BUILDS.md](deploy/cloudflare/WORKERS-BUILDS.md)) the same
guarantees hold, with branches instead of tags: **merge → staging → test → promote that
commit.**

1. **Merge a PR to `main`.** The `mlops-academy-staging` Worker's build runs
   `scripts/ci-test.sh` (lint, typecheck, unit tests, API e2e on PGlite), and only if it
   passes runs `deploy/cloudflare/build.sh staging`. That deploys to staging, smoke-tests
   it, and writes the release record `staging/<sha>.json` to the R2 bucket
   `academy-releases`.
2. **Test it** on https://academy-staging.mlopsmena.com, as before.
3. **Promote that commit:** `scripts/promote.sh <sha>` (or no argument for `main`'s latest
   commit). It fast-forwards the `production` branch. The `mlops-academy` Worker's build
   runs `build.sh production`, which refuses any commit without a staging release record,
   then deploys and smoke-tests production.

**Roll back:** dashboard rollback first if it's urgent (Workers & Pages → `mlops-academy`
→ Deployments), then `scripts/promote.sh <older staged sha> --rollback`, which moves the
branch back and rebuilds that commit. The schema rules above still apply.

**What changes compared to tags:** every merge to `main` goes to staging (staging always
runs `main`); you choose what reaches production by commit, not by tag; there are no
GitHub Releases unless you create them by hand; and pull requests aren't tested by a
machine unless you turn on preview builds (run `scripts/ci-test.sh` before marking a PR
ready). The browser (Playwright) tests no longer gate a release: run them locally against
`docker compose`, or run **CI** by hand on GitHub. See WORKERS-BUILDS.md, "Pull requests".

## Costs

- Workers Paid: $5/month, required for Containers. It includes 25 GiB-hours
  of memory and 375 vCPU-minutes per month, shared by both environments. Staging has no
  cron, so its containers only wake when someone uses staging (see
  [Jobs on staging](#jobs-on-staging)).
- Neon: free tier (both databases in one project).
- R2: free tier, up to 10 GB.
- Resend: free tier at first.

See `docs/COST_ANALYSIS.md`, which is local only and not in git.

Containers are billed while awake: memory and disk for the instance size, CPU only when
busy. A `standard-1` (½ vCPU, 4 GiB, 8 GB) awake all month costs about $27 in memory and
disk plus up to $26 in CPU at full load; a `basic` (¼ vCPU, 1 GiB) about $7 plus up to $13.
Production at launch size (four `standard-1`) is roughly $110–140/month if nothing sleeps;
staging stays at two `basic`, under $20 and usually much less because it sleeps.

Each awake container also keeps its Durable Object running, billed as **Durable Objects
Compute Duration** (128 MB per object, 400,000 GB-s a month included). The first full month
(invoice of 28 October 2026, $32.44 before VAT) was: container memory $12.15, Durable Objects
duration $12.50, Workers Paid $5, container CPU $1.46, container disk $1.33; everything else
(R2, KV, D1, logs, requests) stayed in the free allowances. The memory line (1,375 GiB-hours)
means the two production containers were awake about 95% of the time: something reached them
more often than every `SLEEP_AFTER`. What keeps them awake, from most to least:

- signed-in tabs left open (the notifications bell polled every 2 minutes; it now stops after
  10 minutes without input),
- calendar apps polling students' private feeds (`/api/calendar/<token>.ics`), which reach the
  API and the database on every poll,
- anonymous visitors and crawlers on pages missing the edge cache (30 s copies), and
- the hourly jobs tick, which wakes the API for about `SLEEP_AFTER` each hour.

The same wake-ups keep the Neon compute from suspending, which is what uses up its free
compute hours. `SLEEP_AFTER` is the main lever: every wake-up costs at least that long. At
5 minutes, the hourly tick alone costs the API about 2 hours a day instead of 6, at the price
of more cold starts (see "Cold starts" below).

## Capacity and caching

The load test before launch (Locust, anonymous visitors, staging on one `basic` web
container) showed the web container as the bottleneck: course pages took 5 s at the median
with 50 visitors and 30 s with 300, while the API's `/health` stayed at 0.4 s. So:

- **Public pages are static (ISR).** Home, catalog, course, live sessions (list and
  detail), recordings, speakers, learning paths, policies, login and register are served
  from Next's cache, re-rendered right after an admin edit (below) and otherwise at most
  once per revalidate window (60 s; login and register 300 s). Nothing
  personal is in their HTML: the header, my application status and Notify me load in the
  browser after the page. Catalog and recordings filters run in the browser too (the URL
  keeps them). `next build` lists these routes as ● with a revalidate time.
- **API-backed pages render on first request, not at build.** The API isn't reachable
  while the image builds, so `scripts/drop-isr-prerenders.mjs` removes those build-time
  renders; otherwise each fresh container (deploy, wake from sleep) would show its first
  visitors an empty catalog.
- **Cloudflare's edge also caches anonymous reads of the public API** (`/api/courses`,
  `/api/courses/:slug`, `/api/courses/slugs`, `/api/events`, `/api/events/:slug`,
  `/api/speakers*`, `/api/recordings*`, `/api/settings/public`) for up to 30 s. The API marks
  them `public, s-maxage=60, stale-while-revalidate=300` only when the request carries no
  session cookie at all and the body holds no personal field (an event's join link, for
  instance, is only ever in a signed-in, `private, no-store` answer); the Worker stores only
  what the API marked public, never with a session cookie or an `Origin` header
  (`apps/api/src/common/public-cache.ts`, `deploy/cloudflare/src/edge-cache.ts`). The API
  also keeps those anonymous answers in memory for 30 s (`PUBLIC_CACHE_TTL_S`), with
  concurrent misses sharing one query, and drops them on any admin write. The web app's own
  server-side reads skip the edge copy (`x-skip-edge-cache`): they go through the Worker,
  and a page re-rendered after an edit must not pick up an older answer there.
- **Cloudflare's edge caches anonymous page views** for up to 30 s (Workers Cache API in
  `deploy/cloudflare/src/edge-cache.ts`, which lists exactly what is and isn't cached). Never
  cached: requests with a session cookie (`access_token`, `has_session`), `/api/*`, non-GET,
  Next's client-navigation (RSC) requests, signed-in areas, and any response that sets a
  cookie, isn't a 200, is `private`/`no-store`, or is a stale ISR copy. Build assets
  (`/_next/static`, immutable) are cached for everyone. Responses carry `x-edge-cache:
  HIT|MISS|BYPASS`. Each data centre has its own cache.
- **An admin edit shows publicly within seconds, and within 30 s at most** (details in
  [How fast an admin edit shows](#how-fast-an-admin-edit-shows)). Admins themselves are
  signed in, so they see their edits at once.
- **Web containers:** `max_instances: 3`, and the Worker spreads requests at random over
  `WEB_INSTANCES` of them (1 in production and on staging, to stay near the $5 plan). The Worker caps it at
  `MAX_WEB_INSTANCES` in `src/instances.ts` (a test keeps that equal to `max_instances`)
  and uses only `main` if the value is invalid. They are stateless; each has
  its own ISR cache, and an admin edit revalidates every running one (a sleeping one starts
  from its image with nothing cached). Lower `WEB_INSTANCES` after launch to save cost; it
  never needs to exceed `max_instances`.
- **API container:** exactly one `basic` (¼ vCPU, 1 GiB; `max_instances: 1`): rate limits
  and the login lockout are in memory. What keeps it standing under load, all without more
  CPU (measured in PR "API under load"):
  - **Database pool:** 10 connections (`DATABASE_POOL_SIZE`) and a 5 s wait
    (`DATABASE_POOL_TIMEOUT`); Prisma's own default on a ¼ vCPU is 3 connections and 10 s, which is what made every
    endpoint take 10 s and then fail under the staging load test. When no connection is
    free in time the API answers **503 `BUSY` with `Retry-After`**, never a 500. Values in `DATABASE_URL` win.
  - **No `pgbouncer` mode:** the API reaches Neon through its `-pooler` host without Prisma's
    `pgbouncer=true`. Neon runs PgBouncer 1.22+ with protocol-level prepared statements, which
    Prisma supports without the flag; with it, every query was wrapped in
    `BEGIN; DEALLOCATE ALL; …; COMMIT` and re-parsed, about 6 round trips instead of 1–2
    (docs/PERFORMANCE.md). To turn it back on without a code change, add `&pgbouncer=true` to the
    `DATABASE_URL` secret (`deploy/cloudflare/set-worker-secret.sh`): the Worker restarts the API
    container on its next request, because its configuration changed. (`DB_PGBOUNCER` does the
    same locally, but the Worker doesn't pass it to the container.) The deploy's smoke test calls
    `/api/health`, which runs a query, so a pooler that refuses prepared statements fails the
    deploy. Migrations and the startup lock use `DIRECT_DATABASE_URL` when it is set (required on
    staging); without it they go through the pooler and the lock is skipped.
  - **Load shedding:** beyond 200 requests in progress (`MAX_IN_FLIGHT`), new ones get an
    immediate 503 with `Retry-After`. Password hashing (argon2id at OWASP's cost, unchanged)
    runs one at a time (`PASSWORD_HASH_CONCURRENCY`), and a login that would wait more than
    5 s for it gets a 503 too.
  - **Fast restarts:** the API checks for pending migrations itself and starts the Prisma CLI
    only when one is pending; the seed and the archive import run in the background after it
    listens (one container at a time, by advisory lock); the image ships a V8 compile cache.
    A start takes ~6–10 s instead of ~20 s (the container library gives up after 20 s, which
    is where "container is not listening" came from).
  - **Memory:** Node's heap is capped at 512 MB (`API_MAX_OLD_SPACE_MB`), leaving the rest of
    the 1 GiB for Prisma's engine and the background seed.
  - **Health:** `/api/health/live` never touches the database (Docker's healthcheck);
    `/api/health` checks it at most every 5 s, with a 2 s limit (the deploy check).
- **Region:** every container is pinned to Western Europe (`"constraints": { "regions":
  ["WEUR"] }` in `wrangler.jsonc`), next to the Neon database in Frankfurt. Without it
  Cloudflare starts a container near whoever wakes it, which can be far from the database:
  each query then took about 0.5 s and a signed-in click several seconds (measured October
  2026). Students in Egypt and the Gulf add one ~60–100 ms trip to Europe per request
  instead. If the database ever moves, move this with it. `ME` can't be used on its own
  (limited capacity).
- **Signed-in reads:** the API remembers each account's sign-in check (role, admin presets,
  token version) and courses by address for 15 s (`SIGNED_IN_CACHE_TTL_S`, 0 turns it off),
  for GET requests only. Every write request (and every jobs run) empties it once it has
  committed, so revoking a session, deleting an account or removing an admin applies on the
  next request; writes always read the database
  (`apps/api/src/common/signed-in-cache.ts`). A change made outside the API (psql, a script)
  shows within 15 s. This is one more reason to keep a single API instance.
- **Worker → containers:** a container that can't be reached, is starting, or doesn't answer
  within 25 s (writes and admin requests: 120 s, as long as the API itself allows) gets a 503 with `Retry-After` from the Worker, logged as a
  warning, never a hang or an opaque 500 (`deploy/cloudflare/src/container-fetch.ts`).
- **Deploys restart the containers at once:** the deployed commit (`ACADEMY_RELEASE`) is part
  of each container's configuration, so new code is served as soon as the deploy finishes,
  not when the old container is next replaced. The old one gets SIGTERM and up to 12 s to
  finish requests in progress. In-memory state (rate limits, the login lockout) starts
  afresh on each deploy.
- **API down while a page renders:** ISR pages load their main data with `serverGet`,
  which throws, so Next keeps serving the last good copy, or (a fresh container with
  none yet) answers a 500 that neither Next nor the edge caches. They never cache an
  empty "no courses" page.
- **Browsers poll little:** the notification bell asks for the unread count every 2 minutes
  while the tab is visible (backing off up to 10 minutes after errors), and `/auth/me` is
  fetched once per page load.
- **Load testing:** `loadtest/` (Locust): anonymous browsing plus signed-in students, with
  `smoke`, `load` (100 users) and `stress` (500, spike to 750) profiles. Run smoke first.
- **Recordings search** runs in the browser against `GET /api/recordings/search` (ids
  only), limited to 60 a minute per IP. Plain `/api/recordings` reads, which the web
  server makes for every visitor, stay unthrottled unless they carry `?q=`.

### How fast an admin edit shows

Every admin write (anything under `/api/admin/`), and the few speaker writes that change
public content (a lesson's materials, a speaker application, cancelling a booking), runs
this right after it succeeds:

1. The API drops its in-process cache of public reads (`apps/api/src/common/public-cache.ts`).
2. The API calls `POST https://<host>/_internal/revalidate` with the `x-revalidate-token`
   header (`apps/api/src/common/revalidate.ts`; changes within 0.3 s make one call, calls are
   at least 5 s apart, a failed one is retried once, and one follow-up call 5 s after the last
   catches a page whose re-render was already under way when the edit landed).
3. The Worker (`deploy/cloudflare/src/revalidate.ts`) calls `POST /api/internal/revalidate`
   on **every running web container** (`apps/web/src/app/api/internal/revalidate`), which
   drops Next's cached API reads (all tagged `public`) and every rendered page. Containers
   that are asleep are left asleep (they start with nothing cached), and the call doesn't
   count as activity, so it never keeps one awake.
4. Then the Worker purges the edge copies (every stored page and public API answer carries
   `Cache-Tag: academy-public`) in every data centre, when `EDGE_PURGE_ZONE_ID` and
   `EDGE_PURGE_API_TOKEN` are set.

The next visitor to any public page gets a fresh render (`x-nextjs-cache: MISS`), not a
stale copy. What that means for how long an edit takes to show:

| | Before | Now |
|---|---|---|
| Web app (measured locally, production build) | course page and catalog 62 s, home 86–117 s; up to 2 × 300 s for the home page on a quiet site | **0.6–0.8 s** on every page, also with two web instances |
| Edge, with the purge configured | up to 60 s more for the page, plus 60 s for the API copy the page was rendered from | **a few seconds** in every data centre (copies otherwise kept an hour) |
| Edge, without the purge | as above | **at most 30 s** (`PAGE_TTL`), then fresh |
| If the revalidation call fails (logged as `revalidate_failed` by the API, `revalidate:` by the Worker) | | the 60 s windows (measured 50–89 s locally, against up to ~10 minutes before for the home page), plus the 30 s edge copy: under ~2½ minutes for a page people are visiting |

Before, an edit took up to ~4 minutes on a course page and ~12 minutes on the home page in
production (API edge copy 60 s → Next data cache 60–300 s → page 60–300 s → page edge copy
60 s), and on a quiet site the first visitor after the edit still got the old page while it
re-rendered.

**The guarantee:** an admin edit is on every public page within 30 s, and within a few
seconds where the edge purge is configured.

**Configure the purge: it is also the biggest cost saving.** Without it the edge keeps pages
and public API reads 30 s, so on a quiet site almost every visit (and every crawler request)
reaches the web container, which calls the API, which wakes the database. With it, the edge
keeps them an hour (`PURGED_TTL` in `edge-cache.ts`) and an edit purges them at once. What an
hour means for what changes *without* an edit: seat counts and "upcoming / past" on public
pages can lag up to an hour for anonymous visitors (signed-in visitors never get edge copies,
and registration itself always checks the real seat count). If a purge call fails (logged as
`revalidate:` by the Worker), that edit can take up to an hour to show; any later edit purges
again. Nothing to set for the first part: the
revalidation token defaults to an HMAC of `JOBS_TOKEN`, which the Worker hands to both
containers (set the Worker secret `REVALIDATE_TOKEN` to use your own). For the purge, set
the variable `EDGE_PURGE_ZONE_ID` (the zone id of `mlopsmena.com`, from the dashboard's
Overview page) and the secret `EDGE_PURGE_API_TOKEN` (an API token with **Zone → Cache
Purge** on that zone only) in the GitHub environment, or as a build variable and a Worker
secret with Workers Builds. Check a deploy with an edit: the API's log shows
`"event":"revalidated"` with the Worker's answer, e.g.
`{"web":{"main":"200"},"edge":"purged"}`.

Load: a revalidation re-renders each page once, on its next visit, in each running web
container; calls are at least 5 s apart, so a bulk edit costs two re-renders per page (the
call and its follow-up), not hundreds. Measured locally with the `load` profile (100
anonymous visitors, one web instance) and a revalidation every 5 s throughout, far more than
admins ever edit: no errors, p50 unchanged (7 ms), p95 38 → 110 ms, p99 95 → 610 ms.
Seat counts (registrations) and the hourly job tick only clear the API's cache and follow
the 60 s windows: they are frequent and not worth re-rendering every page for. The home,
speakers and learning-path pages went from 300 s to 60 s windows (one render a minute per
container while someone visits them), and the edge keeps copies 30 s instead of 60 s (one
request every 30 s per page and data centre reaches the container, which answers from
Next's cache).

### Jobs on staging

Production's Cron Trigger runs the scheduled jobs (anonymisation, retention, reminders,
profile reviews) hourly. Staging has none, so it costs nothing while nobody uses it. To run
the jobs on staging by hand (e.g. to test reminders), with staging's `JOBS_TOKEN`:

```sh
curl -X POST -H "x-jobs-token: $JOBS_TOKEN" https://academy-staging.mlopsmena.com/_jobs/tick
```

The route exists only outside production and answers 403 without the right token.

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
   **Consultations with Google Calendar** use the same client (no new secret):
   - In Google Cloud → APIs & Services → Library, **enable the Google Calendar API**.
   - Add two more redirect URIs: `https://academy.mlopsmena.com/api/consultations/google/callback`
     and `https://academy-staging.mlopsmena.com/api/consultations/google/callback`.
   - Google Auth Platform → Data Access: add the scopes `.../auth/calendar.freebusy` and
     `.../auth/calendar.events` (both "sensitive"), beside `openid`, `.../auth/userinfo.email` and
     `.../auth/userinfo.profile`.
   - Google Auth Platform → Audience: **Publish app** (status "In production"). In "Testing" only
     listed test users can sign in at all, and Google ends calendar connections after 7 days.
     Published but not yet verified, experts see "Google hasn't verified this app" once when they
     connect (Advanced → continue) and at most 100 accounts can grant the calendar scopes; student
     sign-in (basic scopes only) shows no warning. Google's verification removes the warning.
   - Store the client as the `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` secrets of the GitHub
     environments `staging` and `production`; the next release applies them. This also turns on
     **Sign in with Google** for everyone.
   Without Google configured, experts simply use a fixed meeting link.
   **Optional: automatic Drive sharing** (paid courses' recordings folders, FEATURES 4.6):
   - In the same Google Cloud project, enable the **Google Drive API**.
   - IAM → Service accounts → create one (no roles needed), then Keys → Add key → JSON.
   - Store the whole JSON file (or its base64) as the `GOOGLE_DRIVE_SERVICE_ACCOUNT` secret of the
     GitHub environments `staging` and `production`; the next release applies it. Delete the
     downloaded file afterwards.
   - For each paid course, share its Drive folder with the service account's address
     (`…@….iam.gserviceaccount.com`) as **Editor**. The enrolled students page shows when it works.
   Use one service account per environment if staging should never reach production's folders.
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

With Workers Builds, `deploy/cloudflare/build.sh <staging|production>` does the same work
(its header lists the steps), with three differences: it checks the branch and the
`ACADEMY_ENVIRONMENT` **build variable** instead of a GitHub environment; it doesn't set
runtime secrets (they stay on each Worker, and it only checks that the required ones exist;
change them with `deploy/cloudflare/set-worker-secret.sh`, which keeps the staging-database
check); and it writes a release record to the R2 bucket `academy-releases`, which a
production build requires. It also waits until `/api/health` reports the new release.
Because staging's database secrets are no longer checked by each deploy, the staging Worker
checks them itself on every request and answers 503 rather than start a container on a
non-staging database (`deploy/cloudflare/src/staging-guard.ts`; production never runs it).

## Change a hostname

No code change is needed. In GitHub → Settings → Environments → `production` (or
`staging`) → **Variables**, set:

| Variable | Value |
|---|---|
| `ACADEMY_HOSTNAME` | the new canonical host |
| `ACADEMY_REDIRECT_HOSTS` | optional, comma-separated old hosts that 301 to the new one |
| `SENTRY_ENVIRONMENT` | optional |
| `EDGE_PURGE_ZONE_ID` | optional, the zone id of the new host (see [How fast an admin edit shows](#how-fast-an-admin-edit-shows)) |

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

- **Tests without Postgres.** Workers Builds has no service containers, so its API e2e run
  uses PGlite (Postgres 18 compiled to WASM, in memory) and an in-memory S3
  (`apps/api/test/pglite/`; `pnpm --filter @academy/api test:e2e:pglite`). The whole suite
  passes on it, but real Postgres (16 in CI) stays the
  reference: `ci.yml`, and `scripts/ci-test.sh` with `DATABASE_URL` set, use it.
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
- **Cold starts.** After 5 idle minutes the next request waits a
  few seconds for a container to start. The edge cache helps only with the purge configured
  (copies kept an hour); its 30 s entries without it are long gone by then.
- **Deploys and mixed builds.** Containers roll out after the Worker, so for a while old
  and new web builds serve side by side (`rollout_step_percentage: 100` keeps that short),
  and a data centre can serve the previous HTML for up to 30 s. Build assets
  (`/_next/static`) exist only on their own build: the Worker retries a 404 for one on the
  other web instances, and Next's `deploymentId` (the deployed git SHA, set by
  `configure-host.mjs`) turns a client navigation across builds into a full page load.
- **No in-process cron.** `JOBS_ENABLED=false` in the container; the Worker's
  Cron Trigger runs the jobs instead.

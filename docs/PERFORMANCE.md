# Performance: why the academy feels slow, and how to make it faster

Measured on 18 October 2026 against `main` at `50eda55`, on production
(`academy.mlopsmena.com`) and staging (`academy-staging.mlopsmena.com`), plus a local
production build with a seeded scratch database. Every remote measurement was a signed-out,
read-only request. About 150 `curl` requests and 14 browser page loads were made in total.

## 1. Executive summary (for the owner)

The academy is **fast when it is already awake and the page is public**. A course page or the
catalog then arrives in about 0.2–0.5 s and paints in about 0.6–0.8 s on a slow phone. It
**feels slow** in three situations, and each has a clear cause:

1. **After a quiet spell (more than 15 minutes), the first visitor waits 10–21 seconds.** The
   site runs on two small "containers" that go to sleep when nobody uses them, to keep the bill
   at $5. Waking the website takes about 10 s. Waking the API takes about 8 s more, and the two
   happen *one after the other*. On staging, a fully cold course page took **21.4 s**, close to
   the 25 s point where visitors get a "try again" page instead.
2. **Signed-in pages (dashboard, learn page) take about 5–8 s to fill in, even when awake.**
   The browser makes 6–11 API calls in three rounds, one after another, and each call is slow.
   The API server runs far from the database, which is in Frankfurt. Each database question costs
   about 65–130 ms of travel, and the way the database driver is set up makes every question
   cost about 6 trips instead of 1. That turns a single lookup into about 1 s.
3. **Anything that isn't in the edge cache goes all the way to the containers.** That covers
   most first visits to a page in a given city, every click between pages, link prefetches and
   the bare `academy.mlopsmena.com` address. The edge copy only lives 30 s, and each Cloudflare
   city has its own copy, so on a low-traffic site it is usually empty.

**What to do first, all at $0:**
- Pin the containers to Western Europe, next to the database.
- Turn off the driver's `pgbouncer` compatibility mode.
- Wake the API at the same time as the website instead of after it.
- Answer the bare-domain redirect at the edge.
- Keep edge copies much longer (edits already purge them).
- Cut the dashboard's three rounds of calls to one or two.

Together these should bring warm signed-in pages from about 5–8 s to about 1 s, and the worst
cold start from about 21 s to about 10 s. Serving public pages from a global copy (Workers KV,
also $0 on the current plan) removes the cold wait for signed-out visitors entirely.

**What money would buy:**
- **About $5–11/month:** keep the containers awake during MENA waking hours. This removes the
  10–20 s cold starts for signed-in students too.
- **About $19.50/month:** keep the database from sleeping. This saves roughly 1 s on the first
  click after 5 idle minutes.

Neither is needed before the $0 items are done.

## 2. How a request flows today

```
browser ──► Cloudflare edge (Worker, colo near the visitor)
             ├─ edge cache hit (anonymous page / public API, ≤30 s, this colo only) ──► answer
             └─ miss ──► Durable Object ──► container (placed "nearest to the request that woke it")
                          ├─ WebContainer (Next.js 15, basic: ¼ vCPU, 1 GiB)
                          │    └─ server-side reads: https://<public host>/api/... ──► Worker ──► ApiContainer
                          └─ ApiContainer (NestJS + Prisma, basic, max 1)
                               └─ Neon Postgres, Frankfurt, via the -pooler host (PgBouncer), pgbouncer=true
```

Verified in code:
- `deploy/cloudflare/wrangler.jsonc`: `basic` instances, `WEB_INSTANCES=1`, `SLEEP_AFTER` 15m
  (staging 10m), API `max_instances: 1`, an hourly cron in production only, and no placement
  `constraints`.
- `deploy/cloudflare/src/edge-cache.ts`: `PAGE_TTL = 30` and `API_TTL = 30`. The task brief and
  ENGINEERING.md §11 both say 60 s; the code says 30 s. The cache is the Workers Cache API
  (`caches.default`), which is per data centre.
- `apps/api/src/prisma/database-url.ts`: `pgbouncer=true` is added automatically for Neon's
  `-pooler` host.
- `apps/web/src/lib/server-api.ts`: server-side reads send `x-skip-edge-cache`, so they always
  reach the API container.
- `apps/web/src/middleware.ts`: `/` → `/en` is a `307` with `private, no-store`, answered by the
  web container.

## 3. Measurements

### 3.1 Method

- **Vantage point:** this laptop, routed to Cloudflare's Marseille colo (`cf-ray …-MRS`) for
  every request. TCP connect varied from 50 to 180 ms (high jitter), so small differences
  under ~150 ms are noise. "Server time" below means TTFB minus TLS-done minus one RTT.
- **Tool:** `curl -w` for DNS, connect, TLS, TTFB, total and size, plus the `cf-cache-status`,
  `x-edge-cache`, `x-nextjs-cache` and `cf-ray` headers.
- **Browser:** Playwright Chromium, signed out.
  - *Mobile:* 390 px, Lighthouse-style slow 4G (150 ms, 1.6 Mbps down) and 4× CPU throttle,
    with a fresh cache per page.
  - *Desktop:* 1366 px, no throttling, one context shared across pages.
- **Local:**
  - API and web production builds on ports 4541 and 3541.
  - Scratch database `academy_prf_*`: seed, archive import, plus 3,000 synthetic students,
    3,900 applications, 2,700 enrolments, 45,000 notifications.
  - A small Postgres wire proxy (port 9541) between the API and Postgres. It counted every
    statement and round trip, and could add a fixed delay per round trip to imitate the
    distance to Neon.
  - Everything was stopped and the database dropped afterwards.

### 3.2 Remote timings (median TTFB unless noted)

| Request | Production | Staging | Notes |
|---|---|---|---|
| Worker only (http→https 301 / staging `robots.txt`) | 217 ms | 301 ms | ≈ one RTT after TLS: the Worker itself adds little |
| Public page, edge **HIT** (`/en`, `/ar`, `/en/courses`, `/en/sessions`, `/en/speakers`, `/en/login`) | **192 ms** (n=10) | 341 ms (n=15) | 35–46 KB compressed HTML |
| Public page, edge **MISS**, container awake, ISR HIT | **447 ms** (n=11) | 679 ms (n=9) | Worker → Durable Object → container hop adds ~200–300 ms |
| Course page `/en/courses/llmops`, ISR **STALE** ×3 in a row | 442 ms | – | STALE copies are never stored at the edge, so while ISR regenerates (>2 s here) every visitor goes to the container |
| `/` (bare domain) → `307 /en` | **503 ms** | 601 ms | Always answered by the web container, never cached |
| `/api/health/live` (no DB), warm | 555 ms | 467 ms | Server side ~150–320 ms: the container hop |
| `/api/health` (one `SELECT 1`), DB check not cached | **1,285–1,398 ms** | 1,225–1,401 ms | ≈ 800 ms more than `/live`, with Neon awake |
| `/api/health` first after Neon idle >5 min | **1,551 ms** | 1,370 ms | vs ~460 ms when the check is cached: Neon wake + reconnect ≈ 0.9–1.1 s |
| Public API, edge HIT (`/api/courses`, `/api/courses/llmops`) | 303 ms | 276 ms | |
| `/api/speakers`, API cache miss (one query) | **1,251 ms** | 1,220 ms | |
| `/api/events`, API cache miss | **2,347 ms** | 2,541 ms | |
| `/api/courses`, API cache miss | **3,090 ms** | 3,343 ms | |
| `/api/courses/llmops`, API cache miss | **2,986 ms** | 3,380 ms | |
| **Cold API container** (`/api/health/live` after sleep) | – | **8,418 ms** | Staging, slept >10 min |
| **Cold web container**, API already warm (`/en`) | – | **10,375 ms** | |
| **Fully cold course page** (web + API asleep, ISR empty) | – | **21,387 ms** | The API reported 13 s uptime when the page finished: web and API woke one after the other. Next request: 548 ms |

Production has the same instance types and code as staging, so its cold start is the same
size. Production sleeps after 15 idle minutes, and the hourly cron wakes only the API.

### 3.3 Browser (signed out, production, containers warm)

| Page | Mobile TTFB | Mobile FCP = LCP | Mobile load | CLS | Requests | JS (compressed) | Fonts |
|---|---|---|---|---|---|---|---|
| `/en` | 399 ms | 576 ms | 2.9 s | 0 | 32 | 292 KB | 115 KB |
| `/ar` | 421 ms | 608 ms | 3.5 s | 0.002 | 35 | 292 KB | **220 KB** |
| `/en/courses` | 516 ms | 700 ms | 2.8 s | 0 | 25 | 287 KB | 115 KB |
| `/en/courses/llmops` | 499 ms | 684 ms | 2.8 s | 0 | 25 | 288 KB | 114 KB |
| `/en/sessions` | 463 ms | 640 ms | 2.7 s | 0 | 26 | 291 KB | 114 KB |
| `/en/speakers` | 669 ms | 844 ms | 3.2 s | 0 | 40 | 293 KB | 114 KB |
| `/en/login` | 534 ms | 716 ms | 2.9 s | 0 | 32 | 304 KB | 114 KB |

- **Desktop:** LCP is 156–492 ms on every page.
- **Paint vs interactivity:** Core Web Vitals are good when warm. The HTML is server-rendered,
  so text paints before the JavaScript arrives. On slow 4G, though, the page only becomes fully
  interactive ("load") after about **2.8–3.5 s**, because about 290 KB of compressed JS has to
  download first.
- **Funnel event:** the course page's `POST /api/funnel/events` took 2.2 s on production. It
  doesn't block the page.
- **Prefetches:** each page view fires **5–21 RSC prefetch requests** (21 on `/en/speakers`, 9
  on `/en`). They bypass the edge cache by design (`edge-cache.ts`, `NEXT_CLIENT_HEADERS`), so
  even a page served from the edge sends 5–21 requests to the web container, and wakes it if
  it is asleep.

### 3.4 Client bundle (local `next build`)

- **Shared baseline:** First Load JS shared by all routes is 103 kB. Public pages total
  **256–280 kB** gzipped. Learn is 280 kB and assessments 303 kB.
- **i18n dictionaries.** `src/i18n/translator.ts` statically imports **both** `en.json` and
  `ar.json`. The `I18nProvider` client component calls it, so every page ships both whole
  dictionaries, minified to 96 KB + 92 KB. They make up most of the 234 KB chunk that is about
  70 KB gzipped. About 38% of each dictionary is `admin.*` strings, which no visitor uses.
- **`@academy/shared` + zod.** About 100 KB raw (31 KB gzipped), loaded on every page,
  including the home page.
- **Heavy dependencies:** none leak into public pages. `react-markdown`, `unified` and the
  `remark`/`rehype` packages stay in server components, except the assessment page and the
  admin Markdown field. `read-excel-file` is admin only.
- **Fonts.** Self-hosted IBM Plex, 3 weights × (Latin + Arabic), with 30 `@font-face` rules
  inlined in every page. `/en` downloads 4 files (115 KB) and `/ar` downloads 7 (220 KB). None
  are preloaded.
- **Inline CSS** (`experimental.inlineCss`) is 73 KB per page, uncompressed and uncached. That's
  fine for first visits, but it is re-downloaded on every page view.
- **Images:** 11 files use `next/image`; one admin page uses `<img>`. Not a factor.

### 3.5 Signed-in pages (local production build, measured)

Signed-in requests always bypass the edge cache. I couldn't sign in on production, since no
sign-ups were allowed, so these were measured locally. The proxy added a fixed delay per
database round trip:
- **65 ms** stands in for production, from the fit in §4.2.
- **5 ms** stands in for a container next to Neon.

**Dashboard (desktop, 65 ms per DB round trip, `pgbouncer=true` as in production):**

```
 1.5 s  page painted (HTML from ISR)
 1.5 s  /auth/me ............................................ 2.4 s   wave 1 (everything waits for it)
 2.4 s  /notifications/unread-count, /me/events, /me/next-sessions, /me/feedback-due,
        /me/certificates, /me/points, /teach/courses, /me/applications ..... 4.7 s   wave 2 (8 in parallel)
 4.7 s  /learn/kubernetes, /learn/llmops (one per enrolled course) ............ 6.4 s   wave 3
```

**Learn page:** `/auth/me` (0.15→0.99 s), then `/learn/:slug` plus certificate, assessments and
unread count (→3.2 s), then the leaderboard (→4.6 s).

**On production**, add the Worker → container hop (~0.25 s) and the visitor's RTT to every wave.
Each call's DB time is about the same as here or worse, since the production round trip is
~65–130 ms. A warm dashboard therefore needs roughly **5–8 s** to fill in. On slow 4G the first
API call can't even start until **2.6 s**, after 356 KB of JS has downloaded and hydrated.

**Layout shift:** CLS is **0.26** (desktop) and **0.93** (mobile) on the dashboard, **0.17–0.47**
on the learn page and **0.30** on the profile page. The threshold for "good" is 0.1. The
skeletons don't reserve the space the loaded content takes.

### 3.6 Database: statements, round trips, plans

Counted through the proxy on the first, uncached call:

| Endpoint | Statements (`pgbouncer=true`) | Round trips | At 65 ms/RT, `pgbouncer=true` | At 65 ms/RT, no flag | At 5 ms/RT, no flag |
|---|---|---|---|---|---|
| `/health` (`SELECT 1`) | 4 (`BEGIN; DEALLOCATE ALL; SELECT 1; COMMIT`) | 6 | 334 ms | 68 ms | 16 ms |
| `/speakers` | 4 | 6 | 675 ms | 137 ms | 16 ms |
| `/auth/me` | 9 | 15 | **801 ms** | 203 ms | 28 ms |
| `/me/applications` | 11 | 21 | 1,069 ms | 339 ms | 33 ms |
| `/learn/:slug` | 48–54 | 72–78 | **1,350 ms** | 541 ms | 48 ms |
| `/me/points` | 32 | 48 | 1,336 ms | 405 ms | 38 ms |
| `/courses/:slug` (public) | 21–25 | 37–43 | 1,540 ms | 472 ms | 67 ms |

- **How `pgbouncer=true` adds statements.** Prisma wraps *every* query in
  `BEGIN; DEALLOCATE ALL; … ; COMMIT`, and uses unnamed statements that need a separate
  parse round trip. One logical query costs about 6 round trips instead of 1–2.
- **Connections in parallel endpoints.** Endpoints that run queries in parallel (`/learn` runs 9)
  also open new pool connections, and each new connection issues `SET search_path`.
- **Plans (`EXPLAIN ANALYZE`, 3,000 students):**
  - Every per-user lookup uses an index and runs in under 1 ms: progress, attendance, unread
    count, enrolment, applications.
  - The public catalog's per-course counts scan whole tables, taking 12–23 ms:
    `Enrollment`/`Application` ⋈ `User` grouped by course. That runs once per 30 s cache miss and
    grows with the number of students.
  - **Missing indexes are not a cause.** DB execution time is about 1% of request time; the
    rest is round trips.

## 4. Root causes, ranked by impact

### 4.1 Container cold starts, serialised (largest, felt by everyone after 15 idle minutes)

**Measured cost:**
- Web container: 10.4 s.
- API container: 8.4 s.
- Fully cold SSR page: **21.4 s**, because the web container only asks for the API once it is
  itself up.
- Neon wake and reconnect on top: about 1 s.

**Why it hits often:**
- Production sleeps after 15 minutes. On a low-traffic site, a large share of sessions start
  cold.
- The edge cache doesn't help after a sleep, because its entries live 30 s.
- RSC prefetches and client navigations always reach the container.
- The hourly cron wakes only the API, so the web container is usually the one asleep.

**Basic instance CPU** (¼ vCPU) contributes to the 8–10 s boots. That is a secondary factor;
the boot work itself is mostly Node, Next and Prisma start-up.

### 4.2 Every database query crosses a long distance, about 6 times (largest for signed-in pages)

**The distance.** Production's single-query endpoints cost about 1.0–1.3 s, against about
0.25 s for the no-DB endpoint. The proxy shows such a query needs about 11 sequential round
trips in `pgbouncer` mode. That puts the container ↔ Neon round trip at **~65 ms**. The larger
endpoints, which also do Neon CPU work on a 0.25 CU compute, fit 65–130 ms.

**Why the container is far away.** Cloudflare places a container "in the location nearest to
the incoming request with a pre-fetched image" unless `constraints.regions` is set ([placement
docs][cf-placement]), and this repo sets none. Whoever wakes the container decides where it
runs: a visitor in the Gulf, or the hourly cron, which can run anywhere. Frankfurt to a
Western-Europe placement would be about 2–10 ms.

**The multiplier.** `pgbouncer=true` is needed only for PgBouncer below 1.21. Prisma recommends
*not* setting it on 1.21+ ([Prisma docs][prisma-pgb]). Neon's pooler is 1.22+ with
`max_prepared_statements=1000` ([Neon pooling][neon-pool]). Locally, at 65 ms per round trip,
removing the flag made endpoints **3–5× faster**: `/auth/me` 0.80 → 0.20 s and `/learn`
1.35 → 0.54 s. Colocating as well takes them to 0.03–0.05 s.

**Neon wake.** After 5 idle minutes (fixed on the free plan, [Neon][neon-plans]) the first
query waits an extra ~0.9–1.1 s, measured from the first versus later `/api/health` calls. That
figure includes a fresh TLS connection.

### 4.3 Client-side waterfalls on signed-in pages

Everything personal loads in the browser after hydration. That design is deliberate: it keeps
public HTML cacheable. Three things make it slow:
- **One serial gate.** `AuthProvider` fetches `/auth/me`, and `useMyCourses` and the other
  personal hooks wait for `user` before they start.
- **An HTTP-level N+1.** `useMyCourses` calls `/me/applications`, then `/learn/:slug` once per
  enrolled course, only to read `progress` and the next session.
- **Breadth.**
  - The dashboard fires 8 calls at once on a ¼-vCPU API with a pool of 10 connections, so the
    calls contend with each other.
  - It also calls `/teach/courses` for students.
  - The learn page refetches 3 endpoints on every `visibilitychange`.

The result is 3 waves of about 1–2.5 s each on production: roughly **5–8 s warm**. Every
signed-in page also pays `/auth/me` (~1 s) before anything personal shows. The header bell
polls `/notifications/unread-count` every 2 minutes, which is light, but it keeps the API awake
while a tab is open.

### 4.4 The edge cache rarely hits on a low-traffic site

- **Short, per-city copies.** The TTL is 30 s, and `caches.default` "does not replicate
  outside of the originating data center" and is "not compatible with tiered caching"
  ([Cache API][cf-cache]). A page needs two visits from the same city within 30 s to hit.
- **STALE ISR answers aren't stored.** The course page served STALE three times in a row while
  it regenerated.
- **Always-container requests:**
  - `/`, the address people type and share.
  - RSC prefetches: 5–21 per page view.
  - Client navigations.

  Each costs a container hop (~0.25–0.45 s warm) and can trigger a cold start.
- **Server-side reads go the long way.** The web container calls
  `https://<host>/api/...` (internet → Worker → Durable Object → API), at ~0.25 s per read
  before any DB time.

### 4.5 JavaScript weight and layout shift

- **JavaScript:**
  - About 290 KB compressed on every public page.
  - About 60 KB of it is the two full dictionaries. Each visitor needs only one language, and
    never the 38% that is admin strings.
  - Another 31 KB is `@academy/shared` with zod.
- **Slow 4G:** that is about 2.8–3.5 s to "load". On signed-in pages it is also the delay
  before any personal data is even requested (2.6 s).
- **Paint:** first paint isn't affected, since the HTML is server-rendered.
- **CLS** of 0.17–0.93 on the signed-in pages makes them *feel* janky while the waves land.

### 4.6 Confirmed, refuted, or minor

| Candidate | Verdict |
|---|---|
| Container cold starts after sleep | **Confirmed, #1** (10.4 s web, 8.4 s API, 21.4 s serial) |
| Neon auto-suspend wake | **Confirmed, minor-to-medium** (~0.9–1.1 s on the first query after 5 min idle) |
| Distance from container to Frankfurt | **Confirmed, #2**: ~65 ms per round trip, multiplied by `pgbouncer=true` (~6 round trips per query) |
| Basic instance CPU | Contributes to boot time and to contention when the dashboard fires 8 calls at once; secondary |
| SSR without cache for signed-in pages | **Partly refuted.** Signed-in pages use the same ISR HTML; their cost is the client-side API waves (#3), not SSR |
| Client JS weight | **Confirmed, medium**: ~290 KB, about 60 KB of it duplicate dictionaries; delays interactivity, not paint |
| API call waterfalls in client components | **Confirmed, #3**: 3 serial waves on the dashboard and learn page |
| Missing indexes | **Refuted**: per-user queries use indexes and run in under 1 ms; DB time is about 1% of request time |
| The 60 s edge TTL | Actually **30 s** in code; **confirmed** as a reason for the low hit rate (per colo, no tiered cache) |
| Worker's own overhead | **Refuted**: about one RTT; the cost is the Worker → Durable Object → container hop (~0.2–0.3 s) |
| Fonts and images | Minor: 115 KB of fonts on `/en` and 220 KB on `/ar`, not preloaded; images fine |
| Serial `/me` and refresh calls | **Confirmed** for `/auth/me`, which gates everything. Refresh only runs when the token has expired (deduplicated, at most once) |

## 5. Proposal, ordered by impact ÷ cost

**Prices** were checked on 18 October 2026:
- **Containers** ([pricing][cf-containers]):
  - memory $0.0000025 per GiB-second, which is **$0.009 per GiB-hour**;
  - disk $0.00000007 per GB-second, which is **$0.000252 per GB-hour**;
  - CPU $0.000020 per vCPU-second, charged only while busy;
  - included with Workers Paid: 25 GiB-hours, 375 vCPU-minutes and 200 GB-hours a month,
    shared by production and staging;
  - a `basic` instance is ¼ vCPU, 1 GiB and 4 GB, so it costs **≈ $0.010 per awake hour**.
- **Workers Paid** ([pricing][cf-workers]): $5/month, including 10 M requests and 30 M CPU-ms.
- **Workers KV on Paid** ([pricing][cf-kv]): 10 M reads, 1 M writes and 1 GB included.
- **Hyperdrive** ([pricing][cf-hyperdrive]): included in Workers Paid.
- **Neon** ([plans][neon-plans]):
  - Free: 100 CU-hours per project (production and staging share one project), and the 5-minute
    suspend is fixed.
  - Launch: $0.106 per CU-hour and $0.35 per GB-month, with no minimum. Scale-to-zero can be
    disabled.

### 5.1 Quick wins at $0 (do these first)

| # | Change | Where | Expected improvement | Risk |
|---|---|---|---|---|
| Q1 | **Pin both containers next to Neon:** add `"constraints": { "regions": ["WEUR"] }` to each container in `wrangler.jsonc` (production and staging) | config only | DB round trip ~65 ms → ~5 ms. API DB time **−85–90%**: `/auth/me` 0.80 → ~0.08 s, `/learn` 1.35 → ~0.12 s, `/courses/:slug` miss 1.5 → ~0.15 s (local A/B, `pgbouncer=true`). Also makes placement stable instead of decided by whichever request or cron woke the container | MENA visitors' Worker → container hop gains about 30–60 ms per request, far less than it saves. Western-Europe capacity is plentiful. Revert by removing the block |
| Q2 | **Stop Prisma's `pgbouncer` mode:** add `pgbouncer=false` to the `DATABASE_URL` secret (values in the URL already win in `database-url.ts`), then stop auto-adding the flag for `-pooler` hosts. Or point the single API instance at Neon's direct host: 10 connections against 97 allowed at 0.25 CU | secret, then a small code change | 3–5× fewer round trips per query, measured: `/auth/me` 0.80 → 0.20 s at 65 ms, 0.08 → 0.03 s at 5 ms. With Q1, a dashboard API call costs about 30–50 ms of DB time instead of about 1 s | "prepared statement already exists" errors, if PgBouncer's prepared-statement support misbehaves. Try on staging first with a short soak test (load test `smoke`). Rollback is one URL parameter |
| Q3 | **Wake the API in parallel with the web container:** when the Worker forwards a web request, `ctx.waitUntil(env.API.getByName('main').fetch('/api/health/live'))`, at most once a minute (for example a timestamp in the Durable Object) | `deploy/cloudflare/src/index.ts` | Fully cold SSR page **21.4 s → ~11 s** (the two boots overlap). Signed-in visitors also find the API awake when their first `/auth/me` arrives | Wakes the API for a visitor who only reads cached pages. That's a few cents a month, since it sleeps again after 15 min |
| Q4 | **Answer `/` and other locale-less paths in the Worker:** a `307` to `/<NEXT_LOCALE cookie or en>/…` with `no-store`, the same rule as the middleware | `index.ts` | `/` 0.5 s → ~0.15 s warm, and **10–21 s → 0.15 s** cold before the page itself | Keep the middleware as the fallback. A unit test mirrors the middleware rule |
| Q5 | **Longer edge TTL with purge-on-write:** `PAGE_TTL`/`API_TTL` 30 s → 1 h (or 1 day), because #68 purges the tag on every admin write. First confirm production's `/_internal/revalidate` answers `"edge":"purged"`; it does only if `EDGE_PURGE_ZONE_ID` and `EDGE_PURGE_API_TOKEN` are set. Also fix ENGINEERING.md §11, which says 60 s | `edge-cache.ts` | More HITs (~0.2 s) instead of MISSes (~0.45 s warm, 10–21 s cold) for every page view in the same city within the TTL | Seat counts and the hourly job don't purge: either purge on those too, or keep `/api/courses*` shorter (5 min). Without a working purge, edits lag by the TTL |
| Q6 | **Collapse the dashboard waves:** (a) start personal calls as soon as the `has_session` cookie exists instead of waiting for `/auth/me`; (b) return `progress` and `nextSession` from `/me/applications` (one SQL join) and drop the per-course `/learn/:slug` calls; (c) skip `/teach/courses` unless the user is staff; (d) on the learn page, start the leaderboard with the other three | `use-progress.ts`, `Dashboard.tsx`, `LearnPage.tsx`, applications service | 3 waves → 1. Saves **1.5–3 s** today, or ~0.1–0.3 s after Q1+Q2 | A 401 on an expired session is already handled by `api()` (refresh, deduplicated). Keep at most one refresh per call (the login-loop rule) |
| Q7 | **Ship one language's dictionary, and none of `admin.*` on public pages:** load `messages/<locale>.json` in the server layout, pass only the needed namespaces to `I18nProvider`, and lazy-load `admin`/`teach` in their own layouts | `i18n/*`, `[locale]/layout.tsx` | About **−45 to −60 KB gzipped** on every page (~20% of JS), so roughly 0.3 s faster to interactive on slow 4G | Missing-key bugs. The existing `messages.test.ts` plus an e2e smoke of both locales cover them |
| Q8 | **Fix CLS on signed-in pages:** fixed-height skeletons for dashboard cards, the learn session list and the profile form | components | CLS 0.17–0.93 → under 0.1 | None |
| Q9 | **Fewer prefetches on long lists:** `prefetch={false}` on speaker, session and course *cards* (Next then prefetches on hover/touch), keeping header links prefetched. Do **not** touch the Apply link logic from the login-loop fix (#79) | cards | `/en/speakers` 21 → ~6 container requests per view. Less ¼-vCPU contention, fewer wake-ups from edge-cached views | Clicks on cards are ~0.2–0.4 s slower when warm. Optional |
| Q10 | **Cache the authenticated user in the auth guard** for 30 s, keyed by user id and `tokenVersion` | `common/auth.guard.ts` | Removes 1 query (~6 round trips today) from *every* signed-in request | A role change or forced sign-out takes up to 30 s to apply. Bust the cache on those writes |
| Q11 | **Fonts:** preload the Latin 400/600 (or Arabic 400/600 on `/ar`) and consider dropping the 500 weight | `[locale]/layout.tsx` | −1 to 2 font files and earlier text in the final font. Small | Visual check |

### 5.2 Medium effort, still $0

| # | Change | Expected improvement | Cost | Risk |
|---|---|---|---|---|
| M1 | **Global stale-while-revalidate for public pages and the public API in Workers KV.** The Worker answers anonymous GETs from KV at once and refreshes from the container in `ctx.waitUntil` when the copy is older than ~60 s. Admin writes (#68) delete or overwrite the keys | Signed-out visitors **never wait for a cold container**: ~0.1–0.25 s in every city, at any hour. The refresh wakes the container in the background, as today | **$0.** At about 1,000 page views a day: ~30 k reads and ~3 k writes a month, far inside the included 10 M / 1 M | KV is eventually consistent (up to ~60 s across cities), comparable to today's 30 s lag. HTML must stay identical for everyone, which it already is. Keep the existing per-colo cache in front |
| M2 | **Cache RSC prefetch and navigation responses for public ISR routes** at the edge (or in M1's KV): key on the URL including `_rsc`, store only 200 `text/x-component` answers for paths outside `PRIVATE_PAGE`, and never redirects | Clicks between public pages stop reaching the container; ~0.2 s instead of 0.3–0.5 s warm, or 10 s cold | $0 | This is where #79's login loop came from (a cached redirect). Store only 200s from public paths, never any 3xx, and never when a session cookie is present. Needs an e2e test |
| M2b | **Store ISR "STALE" answers at the edge for a few seconds** instead of refusing them | Fewer container hops on hot pages during regeneration | $0 | Slightly older copy for up to the short TTL |
| M3 | **Per-user API response caching** for read-mostly personal endpoints (`/me/points`, `/me/certificates`, `/me/events`, `/learn/:slug` without live links): in-memory, 15–30 s, keyed by user and cleared on that user's writes | Repeat views and tab returns come back in milliseconds | $0 | Correctness on writes. Do it only after Q1+Q2, which may make it unnecessary |
| M4 | **Trim the client bundle further:** import only enums and helpers from `@academy/shared` in client code (a `shared/client` entry without zod), or move zod-validated forms into lazily loaded chunks | −20–30 KB gzipped on every page | $0 | Refactor risk; covered by typecheck |
| M5 | **Keep the catalog counts cheap:** count with `WHERE courseId = …` per course, or keep counters updated on enrol and withdraw | Catalog miss DB time stays flat as students grow (12–23 ms today at 3,000 students) | $0 | Low; not urgent |

**Hyperdrive and connection pooling.** Hyperdrive is included at $0, but it is reached through a
*Worker* binding, and the containers talk to Postgres over TCP themselves. Cloudflare doesn't
document a container → Hyperdrive path. Routing DB traffic through a Worker would add a hop and
complexity for little gain once Q1 puts the container next to Neon.

**Not recommended.** Neon's own pooler stays as it is; only Prisma's compatibility flag
changes (Q2).

### 5.3 Options that cost money

| # | Option | Exact monthly cost | Expected improvement | Notes |
|---|---|---|---|---|
| P1 | **Keep both containers awake during MENA waking hours** (for example 05:00–23:00 UTC, 18 h a day). A Worker cron every 10 min in that window calls `/api/health/live` on the API and a lightweight web route through each Durable Object; `SLEEP_AFTER` stays 15m | **≈ $10.70/month** for web + API. Memory: 2 × 1 GiB × 18 h × 30.4 days = 1,094 GiB-h − 25 included = 1,069 × $0.009 = **$9.62**. Disk: 2 × 4 GB × 547 h = 4,378 GB-h − 200 = 4,178 × $0.000252 = **$1.05**. CPU for idle Node stays inside the 375 included vCPU-minutes. The pings themselves are ~5 k Worker requests, inside the 10 M included. Part of this is already spent today, since the hourly cron keeps the API awake ≥15 min an hour (~$1.80/month), so the *extra* is about $9 | Removes the 10–21 s cold start in that window, for signed-in students too | Combine with Q1, or the cron's own location may decide placement. Don't ping the database (see P3) |
| P1a | API only, same window (web stays sleepy and relies on Q3, Q4 and M1) | **≈ $5.20/month** (547 GiB-h − 25 = 522 × $0.009 = $4.70; 2,189 GB-h − 200 = 1,989 × $0.000252 = $0.50) | Signed-in pages never wait for the API; with M1, public pages never wait at all | Good value after M1 |
| P1b | Both containers awake 24/7 | **≈ $14.35/month** (1,460 GiB-h − 25 = 1,435 × $0.009 = $12.92; 5,840 GB-h − 200 = 5,640 × $0.000252 = $1.42) | No cold starts ever | Night traffic from MENA is low; P1 or P1a is better value |
| P2 | **Bigger instances** (`standard-1`: ½ vCPU, 4 GiB, 8 GB) | **≈ $0.038 per awake hour each** vs $0.010 for `basic`. Always on: **≈ $27.75/month each** (2,920 GiB-h × $0.009 = $26.28 + 5,840 GB-h × $0.000252 = $1.47, before included amounts) | Faster boots and SSR, less contention. Not measured here | Only after Q1–Q3; CPU isn't the main cause |
| P3 | **Neon Launch, scale-to-zero off for production** (0.25 CU) | **≈ $19.35/month** compute (0.25 CU × 730 h × $0.106) **+ $0.35 per GB-month** of storage (about $0.20–0.35 at today's size) + staging compute while used (e.g. 20 h × 0.25 × $0.106 = $0.53) | Removes the ~1 s first-query wake after 5 idle minutes | Lowest value per dollar. Do it only if Q1+Q2+P1 are in and the first click still feels slow. **Don't** keep the free plan awake with pings: 100 CU-hours per project is about 400 h at 0.25 CU, shared with staging. Exhausting it would suspend the database until the month resets |

### 5.4 Expected result

| Scenario | Today | After $0 quick wins (Q1–Q8) | Plus M1 | Plus P1 |
|---|---|---|---|---|
| Public page, warm, edge MISS | 0.45 s | 0.4 s | **0.15–0.25 s** | same |
| Public page, everything asleep | **10–21 s** | ~11 s (Q3), bare domain 0.15 s (Q4) | **0.15–0.25 s** | 0.15–0.25 s |
| Signed-in dashboard filled in, warm (desktop) | **~5–8 s** | **~1 s** | ~1 s | ~1 s |
| Signed-in dashboard, slow 4G mobile, warm | ~7–10 s | ~3.5 s (JS download dominates) | ~3.5 s | ~3.5 s |
| Signed-in after a sleep | 15–25 s | ~11 s | ~11 s | **~1–3.5 s** in the window |
| Catalog API miss | 2.3–3.1 s | ~0.35 s | ~0.25 s | same |

## 6. Risks and things to watch

- **Placement (Q1).** A future need for data residency elsewhere would conflict. `WEUR`
  includes non-EU colos; use `"jurisdiction": "eu"` if that matters.
- **Prepared statements (Q2).** Watch Sentry for `26000` / `42P05` errors on staging after
  the change. Run the Locust `smoke` and `load` profiles before production.
- **Longer TTLs (Q5, M1).** These depend on purge working. If `EDGE_PURGE_*` isn't set, lengthen
  the TTL only together with M1's explicit key deletion.
- **Prefetch changes (Q9, M2).** Never cache a redirect or a private path. That is exactly the
  #79 bug. Keep `e2e/login-loop.spec.ts` green.
- **Keep-warm (P1).** Every always-on poller costs money (ENGINEERING.md §19). Put the window
  in a variable so it can be turned off in one deploy.
- **Measurement noise.** Remote numbers came from one laptop, with RTT jitter of 50–180 ms. The
  ranking is robust because the effects are seconds, not milliseconds.

## 7. How to measure afterwards

1. **The same `curl` table.** Run it against both hosts: `curl -w '%{time_namelookup} %{time_connect}
   %{time_appconnect} %{time_starttransfer} %{time_total} %{size_download}'` with the
   `x-edge-cache`, `x-nextjs-cache` and `cf-ray` headers. Compare:
   - edge HIT vs MISS medians;
   - `/api/health` (DB) minus `/api/health/live` (no DB). Today ~0.8 s; target under 50 ms.
2. **A true cold start.** Leave staging idle for 11 minutes, then request
   `/en/courses/<slug>?x=<random>`. Today 21.4 s; target ~11 s after Q3, or ~0.2 s with M1.
3. **DB round trips.** Run the API locally against a Postgres proxy that adds 65 ms per round
   trip, and compare `/auth/me`, `/learn/:slug` and `/me/applications`. Today 0.80, 1.35 and
   1.07 s.
4. **Browser.** Use Playwright on mobile (390 px, slow 4G, 4× CPU) and desktop, signed out on
   production and signed in locally. Record:
   - TTFB, FCP, LCP, CLS and JS KB per page;
   - the `/api/*` waterfall on the dashboard (today 3 waves; target 1).
5. **Bundle.** Run `pnpm --filter @academy/web build` and compare First Load JS (today 256–280 kB
   on public pages) and the size of the chunk that carries the dictionaries.
6. **In production, ongoing.** The Worker logs "container unavailable" warnings (cold starts
   that hit the timeout). Add a `server-timing` header from the Worker (`edge;dur=…, origin;dur=…`)
   and from the API (`db;dur=…`), so Cloudflare logs show where the time goes.
7. **Cost.** Check the Containers usage graph (GiB-hours awake) and the Neon CU-hours before
   and after any keep-warm change.

## 8. Follow-ups I'd implement next ($0 quick wins)

1. Q1, pin containers to `WEUR`: config only, staging first.
2. Q2, `pgbouncer=false`: staging secret first, then the `database-url.ts` default.
3. Q3, wake the API in parallel with the web container.
4. Q4, the locale redirect in the Worker.
5. Q6, one wave on the dashboard and the learn page.
6. Q5, longer edge TTL, after confirming the purge works in production.
7. Q7, per-locale dictionaries, without `admin.*` on public pages.
8. Q8, CLS fixes on the dashboard, learn and profile pages.

[cf-containers]: https://developers.cloudflare.com/containers/pricing/
[cf-placement]: https://developers.cloudflare.com/containers/platform-details/placement/
[cf-workers]: https://developers.cloudflare.com/workers/platform/pricing/
[cf-kv]: https://developers.cloudflare.com/kv/platform/pricing/
[cf-cache]: https://developers.cloudflare.com/workers/runtime-apis/cache/
[cf-hyperdrive]: https://developers.cloudflare.com/hyperdrive/platform/pricing/
[neon-plans]: https://neon.com/docs/introduction/plans
[neon-pool]: https://neon.com/docs/connect/connection-pooling
[prisma-pgb]: https://www.prisma.io/docs/orm/prisma-client/setup-and-configuration/databases-connections/pgbouncer

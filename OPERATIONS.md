# Operations

How to run the academy day to day: backups and restores, email deliverability,
logs, error tracking, analytics, security headers and incident response.
Deployment itself is in [DEPLOY.md](DEPLOY.md).

## Backups and restore

Two layers:

| Layer | What it covers | Where |
|---|---|---|
| **Neon point-in-time restore** | Any moment inside the plan's history window (short on the free plan, days on paid plans; check Neon console → Settings) | Neon console → Branches → Restore |
| **Daily encrypted dumps** | Daily snapshots for `BACKUP_RETENTION_DAYS` (default 30), and survives losing the Neon project | R2, prefix `backups/` (bucket `BACKUP_BUCKET`, default `academy-private`) |

The dumps come from `.github/workflows/backup.yml`, which runs daily at 01:30 UTC (it can also be run by hand from the Actions tab). It:
1. runs `pg_dump --format=custom` over `DIRECT_DATABASE_URL`;
2. checks that `pg_restore --list` can read the dump, so a broken backup fails the run instead of failing on restore day;
3. encrypts it with AES-256 (`gpg --symmetric`) using `BACKUP_PASSPHRASE`;
4. uploads it to R2 and deletes dumps older than the retention window.

**One-time setup** (GitHub → Settings → Environments → `staging`):
- Secret `BACKUP_PASSPHRASE`: generate it with `openssl rand -base64 32`, and keep a copy in your password manager. **Without it the dumps can't be decrypted.**
- Secret `DIRECT_DATABASE_URL`: Neon's **unpooled** connection string (Connect → connection pooling off; the host has no `-pooler`). The deploy uses it too, for migrations.
- Recommended: a separate R2 bucket (for example `academy-backups`) with its own R2 API token scoped to it. Add the variable `BACKUP_BUCKET` and the secrets `BACKUP_S3_ACCESS_KEY_ID` / `BACKUP_S3_SECRET_ACCESS_KEY`. Then a leaked app credential can't read or delete backups. Without these, the app's bucket and token are used.
- If the `staging` environment requires reviewers, scheduled backup runs wait for approval. Keep it limited to the `main` branch, without required reviewers.

**Privacy:** dumps contain whatever was in the database that day, so data from a deleted account can survive in them for up to `BACKUP_RETENTION_DAYS` after anonymisation. The privacy policy says so ("How long we keep it").

Payment screenshots and CVs in R2 are **not** backed up on purpose. The retention job deletes them after the configured period, and backing them up would keep personal data longer than the privacy policy allows.

### Restore from a dump

Use a new Neon branch or database first, never the live one, and check the data before switching over.

```bash
# 1. Download (R2 credentials from ~/.config/mlops-academy/deploy.env)
export AWS_ACCESS_KEY_ID=… AWS_SECRET_ACCESS_KEY=… AWS_DEFAULT_REGION=auto AWS_ENDPOINT_URL=<S3_ENDPOINT>
aws s3 ls s3://academy-private/backups/
aws s3 cp s3://academy-private/backups/academy-2026-10-08T0130Z.dump.gpg .

# 2. Decrypt (asks for BACKUP_PASSPHRASE)
gpg --output academy.dump --decrypt academy-2026-10-08T0130Z.dump.gpg

# 3. Restore into an EMPTY database (e.g. a fresh Neon branch's direct URL)
docker run --rm -v "$PWD:/in" postgres:17-alpine \
  pg_restore --no-owner --no-acl --dbname "<TARGET_DIRECT_URL>" /in/academy.dump

# 4. Sanity checks
psql "<TARGET_DIRECT_URL>" -c 'SELECT count(*) FROM "User";' -c 'SELECT max("createdAt") FROM "Application";'
```

Then point the app at the restored database: update `DATABASE_URL` and `DIRECT_DATABASE_URL` in the GitHub environment and run **Deploy to Cloudflare**. Migrations that are already applied are skipped.

**Restore drill:** once a quarter, restore the latest dump into a scratch Neon branch and run the sanity checks. Delete the branch afterwards.

### Restore with Neon point-in-time

Neon console → your project → **Branches** → **Restore** → choose a timestamp, either restoring `main` in place or creating a new branch. This is the fastest fix for "an admin deleted something an hour ago".

## Email deliverability (SPF, DKIM, DMARC)

Mail is sent through Resend from `academy@mlopsmena.com`. Adding the domain in Resend (with the Cloudflare auto-configure option) creates:

| Record | Name | Purpose |
|---|---|---|
| `MX` | `send.mlopsmena.com` | Bounce handling (return path) |
| `TXT` (SPF) | `send.mlopsmena.com` | `v=spf1 include:amazonses.com ~all`: authorises Resend's senders |
| `TXT` (DKIM) | `resend._domainkey.mlopsmena.com` | Public key that signs every message |

SPF lives on the `send` subdomain, so it doesn't clash with any SPF record already on `mlopsmena.com` (for example Google Workspace's `include:_spf.google.com`). A name can only have **one** SPF record, so merge them if you ever need both on the same name.

**DMARC** you add yourself, once, in Cloudflare DNS:

| Type | Name | Content |
|---|---|---|
| `TXT` | `_dmarc` | `v=DMARC1; p=none; rua=mailto:dmarc@mlopsmena.com; adkim=r; aspf=r` |

Start with `p=none` and read the aggregate reports for 2–4 weeks. If everything legitimate passes, move to `p=quarantine`, then `p=reject`. Check a real message with [mail-tester.com](https://www.mail-tester.com) or Gmail's "Show original", which should show SPF, DKIM and DMARC as `PASS`.

## Logs

The API writes one JSON line per request:

```json
{"level":"log","context":"HTTP","message":{"requestId":"…","method":"GET","route":"/api/admin/students/:id","status":200,"ms":12}}
```

- **No personal data.** The route **pattern** is logged, never the URL (query strings can hold emails or tokens). No IPs, user ids or bodies are logged.
- Every response carries `X-Request-Id`. When a user reports an error, ask for the time and match it in the logs.
- 5xx responses log at `error`, other 4xx (except 401 and 404) at `warn`. Health checks aren't logged.
- To watch live: `pnpm --filter @academy/deploy-cloudflare exec wrangler tail`. Or use Cloudflare dashboard → Workers & Pages → mlops-academy → **Logs** (observability is on).
- `LOG_JSON=false` switches to readable text, which is the default outside production.
- **Cloudflare request logs contain private calendar feed URLs.** Workers Logs (observability) record the full URL of every request, including `/api/calendar/<token>.ics` each time a calendar app polls. They are kept for 7 days and readable only by members of the Cloudflare account; keep that membership small. A leaked feed URL shows that student's course and live session titles and times (never join links). The student revokes it with **Profile → Account → Calendar → Reset link** (the old URL returns 404 at once); rotating `JWT_ACCESS_SECRET` revokes every link (see below).

## Error tracking (Sentry, optional)

Off unless `SENTRY_DSN` is set. To turn it on:
1. Create a free Sentry project (platform: Node.js / NestJS) and copy its DSN.
2. Add `SENTRY_DSN` to the GitHub `staging` environment, then redeploy. Events are tagged with `SENTRY_ENVIRONMENT` (`staging` in `wrangler.jsonc`; change it to `production` when you go live).

Only unexpected errors are reported (not 4xx). User info, cookies, headers, bodies, query strings and console breadcrumbs are all stripped before anything leaves the server, calendar feed tokens in URLs and transaction names are replaced with `[redacted]`, and email addresses and phone numbers in error text are masked (`apps/api/src/instrument.ts`). Prisma errors use the minimal format, so query arguments aren't in them either. Performance tracing is off. An unhandled promise rejection still crashes the process (Sentry `strict` mode), so the container restarts.

## Analytics (optional, cookieless)

Off unless configured at **build time**. Pick one:

| Provider | Variables |
|---|---|
| Plausible | `NEXT_PUBLIC_ANALYTICS_PROVIDER=plausible`, `NEXT_PUBLIC_ANALYTICS_DOMAIN=academy.mlopsmena.com`, optional `NEXT_PUBLIC_ANALYTICS_SRC` (self-hosted) |
| Umami | `NEXT_PUBLIC_ANALYTICS_PROVIDER=umami`, `NEXT_PUBLIC_ANALYTICS_SRC=https://…/script.js`, `NEXT_PUBLIC_ANALYTICS_WEBSITE_ID=…` |

Cloudflare **Web Analytics** (also cookieless) works with no setup: if it's enabled on the zone, Cloudflare injects its beacon and the content security policy already allows it.

On Cloudflare, add them to the web container's `image_vars` in `deploy/cloudflare/wrangler.jsonc`, next to `NEXT_PUBLIC_SITE_URL`. The content security policy picks up the script's origin automatically.

Both tools are cookieless, so **no cookie banner is needed.** The academy's own cookies are all strictly necessary:

| Cookie | Purpose | Lifetime |
|---|---|---|
| `access_token` | Signed-in session (httpOnly) | 15 minutes |
| `refresh_token` | Renews the session; only sent to `/api/auth` (httpOnly) | 30 days |
| `has_session` | Lets the page know a session exists, no secret inside | 30 days |
| `oauth_state` | Protects Google sign-in against forgery (httpOnly) | 10 minutes |
| `NEXT_LOCALE` | Remembers the chosen language (English / Arabic) | 1 year |

If you ever add a tool that sets non-essential cookies (marketing pixels, chat widgets), you'll need a consent banner first.

## Security headers

| Where | Headers |
|---|---|
| Web pages (`next.config.ts`) | CSP (`default-src 'self'`, YouTube nocookie frames only, `frame-ancestors 'none'`, `form-action 'self'`), HSTS (2 years), `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` (camera, mic, location, payment off), `COOP: same-origin` |
| API (`apps/api/src/setup.ts`, Helmet) | `default-src 'none'`, `frame-ancestors 'none'`, `CORP: same-origin`, HSTS, `nosniff` |

- **CORS:** only `WEB_URL` and any origins listed in `CORS_ORIGINS`. The browser reaches the API same-origin through the web app's `/api` proxy, so in normal use no other origin is ever needed.
- **CSRF:** writes from another site are refused (Origin / Sec-Fetch-Site check), and the API only parses JSON bodies.
- **Swagger** (`/api/docs`) is off in production unless `API_DOCS=true`.
- **To add an external origin**, for example a new embed or image host, edit the `csp` list in `apps/web/next.config.ts`. The axe and headers tests in `e2e/a11y.spec.ts` will catch a broken page.

## Calendar feeds (cost)

Students can subscribe to a private feed of their course sessions and the live sessions they registered for. The feed asks clients to poll every 6 hours (`REFRESH-INTERVAL`/`X-PUBLISHED-TTL` `PT6H`). Apple and Outlook follow that; Google polls on its own schedule (often every 12–24 hours). Each poll wakes the API container and the database, so many subscribers mean the containers sleep less often. A shorter interval would keep them awake around the clock. Last-minute session changes reach students through the reminder emails, not the feed.

## Rate limits

Per signed-in user, otherwise per IP. The default is 300 requests per minute. Stricter limits apply to:
- login and registration;
- password reset, verification email and resend;
- email and password changes, CV upload and account deletion;
- applying;
- uploading payment proof.

The private calendar feed (`/api/calendar/<token>.ics`) is limited **per token** (20 a minute) instead of per IP, because Google, iCloud and Outlook.com poll every subscriber from a few shared addresses. Malformed, unknown or revoked tokens count against the caller's IP (30 a minute), after which that IP gets 429 for the rest of the minute.

Repeated failed logins also trigger a 15-minute lockout. The limits are held in memory, which is one reason the deployment runs a single API instance (see DEPLOY.md "Limits to know").

## Rotating secrets

| Secret | Effect of rotating | How |
|---|---|---|
| `JWT_ACCESS_SECRET` | Access tokens become invalid; sessions renew silently via the refresh cookie. **Every private calendar link is revoked at once** (feed tokens are derived from this secret and checked on each request): subscriptions return 404 and stop updating. Students see their new link the next time they open the calendar menu or Profile → Account, and must add it to their calendar again. Tell enrolled students when you rotate | New value in GitHub env → redeploy |
| `RESEND_API_KEY` | None, if the new key is set before the old one is revoked | Create a new key in Resend → GitHub env → redeploy → revoke the old one |
| R2 keys (`S3_*`) | None, as above | New R2 API token → GitHub env → redeploy → delete the old token |
| `JOBS_TOKEN` | None | GitHub env → redeploy (the Worker and the API read the same value) |
| `BACKUP_PASSPHRASE` | Only new dumps use it | **Keep the old passphrase** until every dump encrypted with it has aged out |
| Admin password | — | Sign in → Profile → Account → change password |

To sign a compromised account out everywhere, have that user change their password: it revokes all of their sessions.

## Incident checklist

1. **Site down?** Check `https://<host>/api/health` (database status included), then `wrangler tail` and `wrangler containers list`.
2. **Bad deploy?** Workers & Pages → mlops-academy → Deployments → roll back. Database migrations are additive and stay in place. One exception: versions from before the "Coming soon" course status (PR #13) don't know that value. Before rolling back past it, run this on Neon (SQL editor):
   ```sql
   UPDATE "Course" SET status = 'DRAFT' WHERE status = 'COMING_SOON';
   ```
   Then set those courses back to "Coming soon" after rolling forward again. Since PR #13 the seed is best effort, so a seed error alone no longer stops the API from starting.
3. **Data mistake?** Neon point-in-time restore into a new branch, then copy the needed rows back.
4. **Leaked secret?** Rotate it (table above), then check the Admin → Audit log for anything unexpected.
5. **Personal-data incident?** Note the time window and the data affected. Egypt's PDPL (Law 151/2020) requires notifying the data protection centre within 72 hours.

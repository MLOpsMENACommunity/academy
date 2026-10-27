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

The dumps come from `.github/workflows/backup.yml`, which runs daily at 01:30 UTC (it can also be run by hand from the Actions tab). It backs up **production** only, from the `production-backup` GitHub environment, and:
1. runs `pg_dump --format=custom` over `DIRECT_DATABASE_URL`;
2. checks that `pg_restore --list` can read the dump, so a broken backup fails the run instead of failing on restore day;
3. encrypts it with AES-256 (`gpg --symmetric`) using `BACKUP_PASSPHRASE`;
4. uploads it to R2 and deletes dumps older than the retention window.

**One-time setup** (GitHub → Settings → Environments → `production-backup`; `deploy/cloudflare/setup-secrets.sh` fills it from `deploy.env`):
- Secret `BACKUP_PASSPHRASE`: generate it with `openssl rand -base64 32`, and keep a copy in your password manager. **Without it the dumps can't be decrypted.**
- Secret `DIRECT_DATABASE_URL`: Neon's **unpooled** connection string (Connect → connection pooling off; the host has no `-pooler`). The deploy uses it too, for migrations.
- Recommended: a separate R2 bucket (for example `academy-backups`) with its own R2 API token scoped to it. Add the variable `BACKUP_BUCKET` and the secrets `BACKUP_S3_ACCESS_KEY_ID` / `BACKUP_S3_SECRET_ACCESS_KEY`. Then a leaked app credential can't read or delete backups. Without these, the app's bucket and token are used.
- `production-backup` is a separate environment so the schedule never waits for a release approval: it holds only the secrets above, is limited to the `main` branch, and has no required reviewers. Keep it that way.
- Staging's database isn't backed up: it holds test data only.

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

Then point the app at the restored database: update `DATABASE_URL` and `DIRECT_DATABASE_URL` in the `production` environment (and `DIRECT_DATABASE_URL` in `production-backup`), and run **Release to production** again with the current tag (see DEPLOY.md, "Releasing"). With Workers Builds, set the two URLs with `deploy/cloudflare/set-worker-secret.sh production DATABASE_URL DIRECT_DATABASE_URL` (and still update `DIRECT_DATABASE_URL` in `production-backup`); the API container restarts with them on its next request. Migrations that are already applied are skipped.

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
- To watch live: `pnpm --filter @academy/deploy-cloudflare exec wrangler tail --env=""` (staging: `--env staging`). Or use Cloudflare dashboard → Workers & Pages → `mlops-academy` (staging: `mlops-academy-staging`) → **Logs** (observability is on).
- `LOG_JSON=false` switches to readable text, which is the default outside production.
- **Cloudflare request logs contain private calendar feed URLs.** Workers Logs (observability) record the full URL of every request, including `/api/calendar/<token>.ics` each time a calendar app polls. They are kept for 7 days and readable only by members of the Cloudflare account; keep that membership small. A leaked feed URL shows that student's course and live session titles and times (never join links). The student revokes it with **Profile → Account → Calendar → Reset link** (the old URL returns 404 at once); rotating `JWT_ACCESS_SECRET` revokes every link (see below).

## Error tracking (Sentry, optional)

Off unless `SENTRY_DSN` is set. To turn it on:
1. Create a free Sentry project (platform: Node.js / NestJS) and copy its DSN.
2. Add `SENTRY_DSN` to the GitHub `production` environment (and `staging`, if you want staging errors too), then release a tag (with Workers Builds: `deploy/cloudflare/set-worker-secret.sh production SENTRY_DSN`). Events are tagged with `SENTRY_ENVIRONMENT`: `production` or `staging`.

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
| `JOBS_TOKEN` | None. Unless `REVALIDATE_TOKEN` is set, the revalidation token derived from it changes too, and the containers restart with the new one | GitHub env → redeploy (the Worker and the API read the same value) |
| `REVALIDATE_TOKEN` (optional) | None: the Worker hands the new value to both containers, which restart | GitHub env → redeploy |
| `EDGE_PURGE_API_TOKEN` (optional) | None, if the new token is set before the old one is revoked. Without a working token, admin edits take up to 30 s at the edge instead of seconds | New Cloudflare API token (Zone → Cache Purge on the academy's zone) → GitHub env → redeploy → delete the old token |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` (optional) | None: the API registers its webhook again with the new values when it starts. Updates Telegram sends in between are retried by Telegram. A revoked bot token's join links keep working. Unconfirmed Telegram connect links (15 minutes) made before a `JWT_ACCESS_SECRET` rotation stop working | BotFather `/revoke` for the token, `openssl rand -hex 32` for the secret → GitHub env → redeploy (see DEPLOY.md, "Telegram course groups") |
| `BACKUP_PASSPHRASE` | Only new dumps use it | **Keep the old passphrase** until every dump encrypted with it has aged out |
| Admin password | — | Sign in → Profile → Account → change password |

"Redeploy" means: change the secret in the `production` environment (Settings → Environments), then run **Release to production** again with the current tag. Staging has its own `JWT_ACCESS_SECRET`, `JOBS_TOKEN`, database and R2 keys; rotate those in the `staging` environment and re-run **Release to staging**.

**After the move to Workers Builds** ([deploy/cloudflare/WORKERS-BUILDS.md](deploy/cloudflare/WORKERS-BUILDS.md)), runtime secrets live on each Worker, not in GitHub, and a deploy no longer sets them. "GitHub env → redeploy" becomes `deploy/cloudflare/set-worker-secret.sh production NAME` (or `staging NAME`); no redeploy is needed: setting a secret deploys a new Worker version, and the Worker restarts a container whose configuration changed on its next request (`restartIfConfigChanged` in `deploy/cloudflare/src/index.ts`). The script asks for the value without echoing it, and refuses a staging database URL that isn't the staging role on a staging database. The backup secrets (`production-backup`) stay in GitHub: `backup.yml` keeps running there.

To sign a compromised account out everywhere, have that user change their password: it revokes all of their sessions.

## Instructor and speaker photos, bios and LinkedIn

Every instructor and speaker is one record (Admin → Speakers), shown on `/speakers/{slug}`, on
their courses and on their sessions. LinkedIn is required in the admin form (a
`https://www.linkedin.com/in/…` profile; `?utm_…` tracking parameters are removed on save).
Title and bio are optional: an empty bio is simply not shown.

**Photos.** Square, 400×400 px or smaller, WebP (the archive converter only looks for `.webp`), named after the slug:
`apps/web/public/speakers/{slug}.webp` (e.g. `mohamed-rashad.webp`, `omar-khalil.webp`,
`sameh-amin.webp`). Commit the file; once it is deployed, either

- set **Photo** to `/speakers/{slug}.webp` in Admin → Speakers (works for everyone, at once), or
- for a speaker who comes from the archive (badge "Imported") and that no admin has saved, run
  `pnpm --filter @academy/api archive:convert --website /path/to/website` again: it picks up every
  photo in that folder and the next deploy's import sets it. An admin save takes the speaker over
  from the import, so after one, use the admin form.

**Bios and titles.** Type them in Admin → Speakers (English and Arabic). For archive speakers
not yet edited by an admin, they can instead go in `apps/api/prisma/archive-curation.ts`
(`speakerProfiles`: `titleEn`, `titleAr`, `bioEn`, `bioAr`, `linkedinUrl`), followed by
`archive:convert` as above. Eng. Sameh Amin (AI Architecture Design) comes from the seed, so edit
him in the admin.

## Speaker portal

- **Sign-up:** login and register offer "I'm a student / I'm a speaker". The choice goes
  through email registration and the Google sign-in state; the API accepts only STUDENT or
  SPEAKER (never ADMIN), and Google only applies it when it creates a new account.
- **One role per account; speakers can study too.** Speaker accounts skip student onboarding
  at sign-up and land on `/speaker`, but can apply to courses like students (same profile and
  Telegram/Discord gate), be enrolled by email, and learn; "My learning" (`/dashboard`) shows
  in their menu and on the portal once they have a course. Enrolled speakers count as students
  for certificates, feedback emails and the roster (`LEARNER_ROLES` in `@academy/shared`;
  admins never do). To switch an account between student and speaker: Admin → Speakers →
  Applications → (application) → Account type, or Admin → Students → (student). A speaker with
  upcoming bookings must have them released first; a student with courses keeps them as a
  speaker. Admin accounts can't be switched there.
- **Review:** Admin → Speakers → Applications. Approving creates the public speaker profile
  from the application (same slug rule as the speaker editor) or links an existing one, and
  emails the speaker; rejecting needs a note, and the speaker can update and resend.
- **Availability:** Admin → Speakers → Availability. Times are Cairo time; the generator
  skips times that already have a slot. Only OPEN slots can be withdrawn or deleted.
- **Booking:** only approved speakers can book; a slot is booked atomically (no double
  booking) and a speaker holds at most `speakerMaxOpenBookings` upcoming bookings (Settings,
  default 2). Each booking creates a DRAFT live session with the speaker linked, emails every
  address in `sessionTeamEmails` (Settings → Session team emails, bulk lane) and notifies
  admins in-app. Add the Meet link and Arabic title, then publish it as usual. Speakers can
  cancel until `speakerCancelDays` before (default 3), and only slots further ahead than that
  are bookable. Cancelling reopens the slot; a still-DRAFT session is deleted (so a speaker's
  text never appears publicly), a published one is cancelled and its registrants emailed; the
  team is emailed. Admins can **Release** any booked slot in Availability (same effect, any time).
- **Photos:** the application takes an optional https photo link, not an upload: speaker
  photos are public, and the private bucket only serves 5-minute signed links.
- **Announcements from speakers:** on `/speaker`, "My courses & sessions" lets a speaker
  message (1) the ENROLLED students of each course they are **assigned** to and (2) the
  registrants of each PUBLISHED live session where they are the speaker, a host or a guest
  (until 30 days after it starts). Nothing else: no materials, assessments or grading. It goes
  out at once, without approval, through the course announcement queue (in-app notification,
  bulk-lane email, the course's learn page), with "From {speaker name}". Limits: 5 per course
  or session and 20 in total per speaker in any 24 hours; subject 120 and message 3,000
  characters, plain text. Speakers see audience counts only, never who. Audited as
  `announcement.sent_by_speaker`; course messages also appear in Admin → Courses → (course) →
  Announcements, labelled "From speaker …".
- **Assigning courses:** Admin → Speakers → (speaker) → **Assigned courses** (any course
  except archived; audited as `instructor.course_assigned` / `instructor.course_unassigned`).
  Assigned means the speaker's profile is one of the course's **instructors**, so it is the
  same list as the course editor's Instructors field and the speaker is shown publicly on the
  course page. The speaker profile must be linked to a speaker account (approving their
  application links it). Unassigning, archiving the course, switching the account to a student
  or deleting it removes access at once.

## Enrol by email

Admin → Courses → (course) → **Enrol by email** adds people to a course without the
application form, the profile gate or (for paid courses) payment.

- **Paste or upload:** addresses separated by commas, spaces or new lines, or a CSV
  (`email[, name, note]`, header optional). At most 300 per batch. **Preview** shows what will
  happen to each address; nothing changes until you confirm. A batch is one transaction.
- **Verified student account:** enrolled at once through the same workflow as an accepted
  application (application at ENROLLED or moved there with the `ADMIN_ENROL` event, a history
  entry "Enrolled directly by the course team", the Enrollment), so it gets the learn page,
  calendar, reminders, Drive tracking, points and certificates. Email "You've been added" and
  an in-app notification.
- **No account, or an account that hasn't confirmed its email:** a PENDING invite and an
  invitation email linking to `/{locale}/register?email=…&returnTo=/{locale}/learn/{slug}`
  (or `/login` for an existing account). It is enrolled only once an account with that
  address proves it owns the inbox: email confirmation, a password-reset link or Google
  sign-in (each claims pending invites; signing in again is a no-op). Registering with
  someone else's address claims nothing.
- **Skipped:** speaker and admin accounts, deleted accounts, invalid addresses, duplicates,
  already enrolled or already invited. Direct enrolment does not check capacity (the preview
  warns when it goes over). Paid courses need "Enrol them without payment" ticked; no Payment
  row is created.
- **List:** status, dates, who invited, resend (once a minute) and revoke for pending invites,
  CSV export. Audited: `course.invited`, `course.enrolled_by_admin` (with `trigger: direct` or
  `invite_claimed`), `course.invite_revoked`, `course.invite_resent`, `course.invites_exported`.
- **Privacy:** invites are in the student's data export. Deleting an account deletes its
  unused invites at once; anonymisation deletes the rest. The daily retention job deletes
  PENDING and REVOKED invites older than 180 days (`INVITE_RETENTION_DAYS`).

## Withdrawals and deleted accounts

- A student can withdraw their own application from its page (status **Withdrawn**) at any point
  before enrolment, except while a payment is under review: then they contact the team, which
  settles the payment (refund included) per the refund policy. Enrolled students also go through
  the team. Withdrawing frees the seat; accept someone from the waitlist by hand. Applying again
  reopens the same application, with its history.
- Deleting an account (by the student or in Admin → Students) withdraws its open applications.
  A payment still under review is closed (Rejected, reason "Closed: the student deleted their
  account") and finance admins get a notification: refund it if the money arrived. Seat counts
  ignore deleted accounts, and a deleted account's payment can't be approved (close it with Reject).

## Incident checklist

1. **Site down?** Check `https://<host>/api/health` (database status included, plus the deployed `release`), then `wrangler tail` and `wrangler containers list`. 503s with `Retry-After` mean "busy or starting", not broken: the API logs a `shed_load` warning (every 10 s at most) saying why (`db_pool`, `in_flight`, `password_hash`, `db_unreachable`), and the Worker logs "container unavailable" or "no response within …". See DEPLOY.md, "Capacity and caching".
2. **Bad deploy?** Run **Release to production** with the previous tag (DEPLOY.md, "Roll back"; with Workers Builds, `scripts/promote.sh <previous sha> --rollback`); in a hurry, Workers & Pages → `mlops-academy` → Deployments → roll back first. Database migrations are forward-only and stay in place, which is why schema changes are released as expand, then contract. One exception: versions from before the "Coming soon" course status (PR #13) don't know that value. Before rolling back past it, run this on Neon (SQL editor):
   ```sql
   UPDATE "Course" SET status = 'DRAFT' WHERE status = 'COMING_SOON';
   ```
   Then set those courses back to "Coming soon" after rolling forward again. Since PR #13 the seed is best effort, so a seed error alone no longer stops the API from starting.
3. **Data mistake?** Neon point-in-time restore into a new branch, then copy the needed rows back.
4. **Leaked secret?** Rotate it (table above), then check the Admin → Audit log for anything unexpected.
5. **Personal-data incident?** Note the time window and the data affected. Egypt's PDPL (Law 151/2020) requires notifying the data protection centre within 72 hours.

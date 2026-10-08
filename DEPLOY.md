# Deploying to Cloudflare

The academy runs on Cloudflare as one Worker that sits in front of two
**Cloudflare Containers**:

```
academy-staging.mlopsmena.com
        │
   Worker (deploy/cloudflare)
     ├── /api/*   → ApiContainer   (apps/api/Dockerfile, NestJS)
     ├── /*       → WebContainer   (apps/web/Dockerfile, Next.js)
     └── cron     → POST /api/internal/jobs/tick every 15 min
                       │
          Neon Postgres · private R2 bucket · Resend
```

Each container runs as a single instance (`max_instances: 1`) and sleeps after
30 idle minutes. The first request after a sleep takes a few seconds while it
starts. Database migrations run when the API container starts. The seed is
idempotent and also runs on start: it creates the admin, the settings and the
placeholder courses.

## Costs

- Workers Paid: $5/month, required for Containers. It includes 25 GiB-hours
  of memory and 375 vCPU-minutes per month.
- Neon: free tier.
- R2: free tier, up to 10 GB.
- Resend: free tier at first.

See `docs/COST_ANALYSIS.md`, which is local only and not in git.

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
   **pooled** connection string. It ends with `?sslmode=require`.
4. **R2 credentials for the app.** After the first deploy has created the
   `academy-private` bucket, go to R2 → Manage API tokens → Create
   **Account API token**, with **Object Read & Write** on `academy-private`
   only. Copy the Access Key ID and Secret Access Key.
5. **Resend.** Add the domain `mlopsmena.com`; with Resend's Cloudflare
   integration, the SPF/DKIM records are added for you. Then create an API key
   with **Sending access** only.
6. **Optional: Google sign-in.** Create an OAuth client (Web) with the
   redirect URI `https://academy-staging.mlopsmena.com/api/auth/google/callback`.
7. **Local secrets file** (never commit it, never paste it into chat):

   ```bash
   mkdir -p ~/.config/mlops-academy
   cat > ~/.config/mlops-academy/deploy.env <<'ENV'
   CLOUDFLARE_API_TOKEN=...
   CLOUDFLARE_ACCOUNT_ID=...
   DATABASE_URL=postgresql://...neon.tech/neondb?sslmode=require
   RESEND_API_KEY=re_...
   S3_ACCESS_KEY_ID=...
   S3_SECRET_ACCESS_KEY=...
   # optional
   GOOGLE_CLIENT_ID=
   GOOGLE_CLIENT_SECRET=
   ENV
   chmod 600 ~/.config/mlops-academy/deploy.env
   ```

8. **Upload the secrets to GitHub.** This generates the JWT secret, the jobs
   token and the admin password, and prints the admin login:

   ```bash
   deploy/cloudflare/setup-secrets.sh
   ```

   The secrets go into the `staging` environment of the GitHub repo. You can
   also add or change them by hand in Settings → Environments → staging.

## Deploy

GitHub → **Actions → Deploy to Cloudflare → Run workflow**. The workflow:

1. checks that every required secret is set;
2. creates the R2 bucket if it doesn't exist yet;
3. runs `wrangler deploy`, which builds both images (linux/amd64) on the
   runner and pushes them;
4. sets the runtime secrets on the Worker;
5. waits for `/api/health` and `/en` to respond.

On the very first run, step 4 of the setup (R2 credentials) isn't possible
yet: run the workflow once to create the bucket, add the R2 keys, then run it
again.

## Go live on academy.mlopsmena.com (or change the hostname)

No code change needed. In GitHub → Settings → Environments → `staging` → **Variables**, add:

| Variable | Value |
|---|---|
| `ACADEMY_HOSTNAME` | `academy.mlopsmena.com` |
| `ACADEMY_REDIRECT_HOSTS` | `academy-staging.mlopsmena.com` (old links redirect to the new host) |
| `SENTRY_ENVIRONMENT` | `production` (only if Sentry is on) |

Then run **Deploy to Cloudflare**. Cloudflare creates the DNS record and certificate for each host (`custom_domain: true`), the app's links, emails, sitemap and cookies switch to the new host, and the smoke test checks the redirect. People signed in on the old host sign in again once.

If Google sign-in is enabled, add `https://academy.mlopsmena.com/api/auth/google/callback` to the OAuth client's redirect URIs first.

For a real production database, also remove `SEED_PLACEHOLDER_STATUS` and change the admin password after the first sign-in.

## Operating

| Task | How |
|---|---|
| Live logs | `pnpm --filter @academy/deploy-cloudflare exec wrangler tail` |
| Container status | `pnpm --filter @academy/deploy-cloudflare exec wrangler containers list` |
| Roll back | Workers & Pages → mlops-academy → Deployments → roll back to the previous version (see OPERATIONS.md "Incident checklist" before rolling back past PR #13) |
| Database backups | Neon point-in-time restore, plus a daily encrypted dump to R2 (`backup.yml`, needs the `BACKUP_PASSPHRASE` secret); restore steps in [OPERATIONS.md](OPERATIONS.md) |
| Email DNS, logs, Sentry, analytics | [OPERATIONS.md](OPERATIONS.md) |

## Limits to know

- **Single instance.** Rate limits and the login lockout are in memory, so
  keep `max_instances: 1` until they move to a shared store.
- **Cold starts.** After 30 idle minutes the next request waits a few seconds
  for the containers to start.
- **No in-process cron.** `JOBS_ENABLED=false` in the container; the Worker's
  Cron Trigger runs the jobs instead.

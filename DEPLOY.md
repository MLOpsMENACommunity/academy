# Deploying to Cloudflare

The academy runs on Cloudflare as one Worker that sits in front of two
**Cloudflare Containers**:

```
academy-staging.mlopsmena.com
        │
   Worker (deploy/cloudflare)
     ├── /api/*   → ApiContainer   (apps/api/Dockerfile, NestJS)
     ├── /*       → WebContainer   (apps/web/Dockerfile, Next.js)
     └── hourly   → POST /api/internal/jobs/tick
                       │
          Neon Postgres · private R2 bucket · Resend
```

- **Single instance.** Each container runs as one instance (`max_instances: 1`).
- **Sleeping.** Containers sleep after 10 idle minutes. The first request
  after a sleep waits a few seconds while they start.
- **Migrations and seed** run in the deploy workflow, not on container start.
  The seed is idempotent and never overwrites edits.
- **New secrets reach containers automatically.** Every deploy stamps a new
  `CONFIG_VERSION`, and a container started under an older one restarts on its
  next request.

## Costs

| Item | Cost |
|---|---|
| Cloudflare Workers Paid | $5/month (required for Containers). Includes 25 GiB-hours of memory and 375 vCPU-minutes per month. |
| Container time | Billed only while running. Light staging use fits in the included amounts; sustained daily traffic adds a few dollars. |
| Neon Postgres | Free tier |
| R2 | Free up to 10 GB |
| Resend | Free tier at first |

## One-time setup

### Cloudflare (dash.cloudflare.com)

Workers and R2 are **account-level**. If you are inside the `mlopsmena.com`
domain view, click **Back to Domains** first. The domain's own "Free" plan
stays as it is.

1. **Workers Paid.** Workers & Pages (or "Compute (Workers)") → **Plans** →
   Workers Paid.
2. **R2.** R2 Object Storage → Get started. It needs a card but stays free
   under 10 GB.
3. **Bucket.** R2 → **Create bucket** named `academy-private`, with location
   *Automatic* (not "EU jurisdiction", which changes the endpoint). Leave
   public access **off**.
4. **R2 keys for the app.** R2 → **Manage API tokens** → **Create Account
   API token**, with **Object Read & Write** on **`academy-private` only**.
   Copy the Access Key ID and Secret Access Key.
5. **Deploy token.** My Profile → **API Tokens** → **Create Custom Token**,
   named `academy-deploy`:
   - Account → Workers Scripts: Edit
   - Account → Containers: Edit
   - Account → Workers R2 Storage: Edit
   - Account → Account Settings: Read
   - Zone `mlopsmena.com` → Workers Routes: Edit
   - Zone `mlopsmena.com` → DNS: Edit
6. **Account ID.** Copy it from the right-hand sidebar of the account home or
   the Workers overview.
7. **DNS.** Nothing to do. The deploy creates `academy-staging.mlopsmena.com`
   and its certificate; just make sure no record with that name exists yet.

### Neon (neon.tech)

8. Create a project with Postgres **16** in **AWS Europe Central 1
   (Frankfurt)**. On the dashboard's **Connect** panel, copy **two**
   connection strings:
   - **Pooled** (the host contains `-pooler`) → `DATABASE_URL`. The app uses
     this one.
   - **Direct** (connection pooling toggled off) → `DIRECT_DATABASE_URL`.
     Migrations need this one.

### Resend (resend.com)

9. **Domains → Add** `mlopsmena.com`, then choose **Auto configure** (via
   Cloudflare). Resend uses a `send.` subdomain, so your existing email setup
   is untouched.
10. Wait until the domain shows *Verified*, then go to **API Keys → Create**
    with **Sending access**.

### Optional: Google sign-in

11. Create an OAuth client (type: Web) with the redirect URI
    `https://academy-staging.mlopsmena.com/api/auth/google/callback`.

### Hand the keys to GitHub (not to chat)

12. Create the local secrets file:

    ```bash
    mkdir -p ~/.config/mlops-academy
    cat > ~/.config/mlops-academy/deploy.env <<'ENV'
    CLOUDFLARE_API_TOKEN=...
    CLOUDFLARE_ACCOUNT_ID=...
    DATABASE_URL=postgresql://...-pooler....neon.tech/neondb?sslmode=require
    DIRECT_DATABASE_URL=postgresql://....neon.tech/neondb?sslmode=require
    RESEND_API_KEY=re_...
    S3_ACCESS_KEY_ID=...
    S3_SECRET_ACCESS_KEY=...
    # optional
    GOOGLE_CLIENT_ID=
    GOOGLE_CLIENT_SECRET=
    ENV
    chmod 600 ~/.config/mlops-academy/deploy.env
    ```

13. From the repo, run:

    ```bash
    deploy/cloudflare/setup-secrets.sh
    ```

    The script:
    - refuses to run while any `...` placeholder is left;
    - generates the JWT secret, the jobs token and the admin password;
    - uploads everything to the GitHub environment **staging**, which only the
      `main` branch can use;
    - saves the admin login to `~/.config/mlops-academy/admin-login.txt`.

    Re-run it any time you change the file.

## Deploy

Go to GitHub → **Actions → Deploy to Cloudflare → Run workflow** (branch
`main`). The workflow:

1. checks that every secret is present and not a placeholder;
2. makes sure the R2 bucket exists;
3. runs the database migrations (direct connection), then the seed;
4. deploys the Worker, both images (built on the runner, linux/amd64) and the
   runtime secrets as **one** version;
5. checks that `/api/health`, `/en` and `/api/courses` respond. The run fails
   if the API never becomes healthy.

## Go live on academy.mlopsmena.com

Use a separate **production** setup rather than reusing staging:

- **Separate everything.** A new Neon database, a GitHub environment
  `production`, and a Worker with its own name, set by a copied
  `wrangler.jsonc` or a wrangler `env.production` block.
- **Hostname.** Set `ACADEMY_HOSTNAME`, the `routes` pattern and
  `NEXT_PUBLIC_SITE_URL` to `academy.mlopsmena.com`, and update the Google
  OAuth redirect URI.
- **No placeholder courses.** Don't set `SEED_PLACEHOLDER_STATUS`, so they're
  created as drafts.
- **Removing a secret.** Deleting a GitHub secret does **not** remove it from
  the Worker. Run `wrangler secret delete NAME` as well.
- **Admin password.** Change it after the first sign-in.

## Operating

| Task | How |
|---|---|
| Live logs | `pnpm --filter @academy/deploy-cloudflare exec wrangler tail` |
| Container status | `pnpm --filter @academy/deploy-cloudflare exec wrangler containers list` |
| Roll back code | Workers & Pages → mlops-academy → Deployments → previous version. Database migrations are forward-only, so rolling back across a migration needs a fix-forward instead. |
| Rotate a secret | Edit `deploy.env`, re-run `setup-secrets.sh`, run the deploy workflow. |
| Backups | Neon point-in-time restore (7 days on the free tier). |

## Limits to know

- **Rate limits are in memory.** They and the login lockout live in the API
  process, so keep `max_instances: 1` until they move to a shared store.
- **Shared IP for server rendering.** Server-rendered pages fetch the API
  through the public hostname, so they share one client IP. Public course
  reads aren't rate-limited for this reason.
- **No in-process cron.** `JOBS_ENABLED=false` in the container; the Worker's
  hourly Cron Trigger runs the jobs.

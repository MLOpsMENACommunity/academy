# MLOps MENA Academy

The course platform for [MLOps MENA Community](https://mlopsmena.com), served at
**academy.mlopsmena.com**. Bilingual (English / Arabic with full RTL).

The academy does **not** host video. Live sessions run on Google Meet or YouTube
Live; recordings live on YouTube (free courses) or a private Google Drive folder
(paid courses). The academy handles everything around the courses: discovery,
registration, screening applicants, manual payment verification, enrolment, and
showing each enrolled student their session links.

## Repository layout

```
apps/
  api/        NestJS REST API, Prisma schema + migrations + seed, Swagger at /api/docs
  web/        Next.js (App Router) + Tailwind. Public pages SSR/SSG; dashboard & admin client-side
packages/
  shared/     Enums, bilingual labels, zod schemas, the application state machine
docker-compose.yml        Local stack: postgres, minio, mailpit, api, web
INTEGRATION.md            Links the main site should use
ROADMAP.md                v2 backlog
```

## Local setup

Requirements: Node 24 (22+ works), pnpm 10 (`corepack enable`), Docker.

```bash
pnpm install
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local

pnpm infra:up          # postgres :5433, minio :9000 (console :9001), mailpit :8025
pnpm db:migrate        # apply migrations
pnpm db:seed           # admin user, default settings, two placeholder courses
pnpm dev               # shared (watch) + api :4000 + web :3000
```

| URL | What |
|---|---|
| http://localhost:3000 | Academy (redirects to `/en`) |
| http://localhost:4000/api/docs | Swagger UI |
| http://localhost:8025 | Mailpit: every email the app sends locally |
| http://localhost:9001 | MinIO console (`minioadmin` / `minioadmin`) |

Sign in as the seeded admin with `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`
from `apps/api/.env`.

**Everything in Docker** (no hot reload): `docker compose up --build`. The API
container runs migrations and the seed on start.

> Behind a TLS-inspecting proxy (e.g. Cloudflare Gateway), Node in the build
> containers needs the proxy's CA: `EXTRA_CA_FILE=/path/to/ca.pem docker compose build`.
> Locally, export `NODE_EXTRA_CA_CERTS=/path/to/ca.pem`. Never disable TLS verification.

### Useful scripts

| Command | Does |
|---|---|
| `pnpm lint` / `pnpm typecheck` / `pnpm test` | What CI runs |
| `pnpm build` | Production build of every package |
| `pnpm db:reset` | Drop, re-migrate and re-seed the local database |
| `pnpm --filter @academy/api prisma studio` | Browse the database |

## Environment variables

API (`apps/api/.env`, validated at boot by `apps/api/src/config/env.ts`; the app
refuses to start with an invalid config):

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `WEB_URL` | Public origin of the academy; used in emails, redirects, CORS |
| `JWT_ACCESS_SECRET` | ≥32 chars; **required in production** |
| `ACCESS_TOKEN_TTL_MIN`, `REFRESH_TOKEN_TTL_DAYS` | Token lifetimes (15 min / 30 days) |
| `COOKIE_DOMAIN`, `COOKIE_SECURE` | Leave domain empty for host-only cookies; secure defaults to on in production |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Sign in with Google. Redirect URI: `${WEB_URL}/api/auth/google/callback` |
| `EMAIL_PROVIDER` | `smtp` (Mailpit locally), `resend` (production) or `log` |
| `EMAIL_FROM`, `SMTP_HOST`, `SMTP_PORT`, `RESEND_API_KEY` | Email delivery |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE` | Private bucket: MinIO locally, Cloudflare R2 in production |
| `S3_CREATE_BUCKET` | Create the bucket on boot (local MinIO only) |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` | First admin account, created by the seed |
| `SENTRY_DSN` | Optional error tracking |
| `JOBS_ENABLED` | Scheduled jobs (reminders, retention, anonymisation); disable on extra replicas |

Web (`apps/web/.env.local`):

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_SITE_URL` | Canonical origin for SEO tags and the sitemap |
| `API_INTERNAL_URL` | Where the Next server reaches the API (`/api/*` proxy and SSR fetches) |
| `NEXT_PUBLIC_ANALYTICS_*` | Optional cookieless analytics (Plausible or Umami) |

## Seeding

`pnpm db:seed` is idempotent. It creates or updates:

- the admin from `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`;
- default settings (payment details, support contacts, live-link window, retention);
- two placeholder courses: **AI Architecture Design** (`ai-architecture-design`, free)
  and **Kubernetes for ML Engineers** (`kubernetes`, paid), with screening
  questions, an instructor and sessions.

Courses are upserted by slug, and questions and sessions are only created for a
course that has none, so re-running the seed never overwrites admin edits.

All placeholder content is marked **`[PLACEHOLDER]`**. Find it with:

```bash
grep -rn "\[PLACEHOLDER\]" apps packages --include=*.ts --include=*.tsx
```

## Adding a new course

1. Sign in as an admin and open **Admin → Courses → New course**.
2. Fill in the slug (it becomes `/courses/<slug>`), the titles and descriptions
   in both languages, type (free/paid), price, capacity, dates, outline, FAQ and
   instructors. For paid courses, set the Drive folder URL and **share that
   folder only with enrolled students' Google accounts, never "anyone with the
   link"**.
3. Add screening questions and sessions.
4. Set the status to **Open** to publish it in the catalog.
5. Add a link on the main site, as described in [INTEGRATION.md](INTEGRATION.md).

## Tech choices

| Layer | Choice |
|---|---|
| Monorepo | pnpm workspaces |
| Web | Next.js 15 (App Router), React 19, Tailwind CSS 4, self-hosted Inter + IBM Plex Sans Arabic |
| API | NestJS 11, class-validator DTOs, Swagger |
| Database | PostgreSQL 16 + Prisma 6 |
| Storage | S3 API: Cloudflare R2 (prod), MinIO (local); private bucket, signed URLs only |
| Email | Resend behind an `EmailService` interface; React Email templates (en/ar) |

Dependency majors are pinned to the latest patch of lines we have verified
(Next 15.5, Nest 11, Prisma 6, TypeScript 5.9, zod 3). Upgrading to Next 16,
Nest 12, Prisma 7+ and TypeScript 7 is a deliberate, separate task.

# MLOps MENA Academy — notes for Claude

## What this is
academy.mlopsmena.com: the MLOps MENA Community's course platform, bilingual English/Arabic with full RTL.
It handles course discovery, registration, applicant screening, manual payment verification, enrolment,
session links, quizzes, attendance and points. It does not host video.

Start with `README.md`, then `docs/ENGINEERING.md` (architecture, data model, how to add a feature)
and `docs/FEATURES.md` (every feature and its rules).

## Stack
- pnpm workspaces monorepo, Node 22+ (`.nvmrc`)
- `apps/web`: Next.js 15 App Router, React 19, Tailwind CSS 4
- `apps/api`: NestJS 11 REST API, Prisma 6, PostgreSQL 16, Swagger at `/api/docs`
- `packages/shared`: enums, bilingual labels, zod schemas, the application state machine
- Storage: S3 API (Cloudflare R2 in production, MinIO locally). Email: Resend (Mailpit locally)
- Deploy: Cloudflare (`deploy/cloudflare/`, `DEPLOY.md`); CI in `.github/workflows/ci.yml`

## Run and check
```bash
pnpm install
pnpm infra:up && pnpm db:migrate && pnpm db:seed
pnpm dev             # web :3000, api :4000
pnpm lint
pnpm typecheck
pnpm test            # lint + typecheck + test is what CI runs
pnpm e2e             # browser tests against a running stack
```

## Rules for every change
- Fix only what the issue asks. Keep pull requests small and focused.
- Every user-facing text needs English and Arabic; Arabic stays right-to-left.
- Database changes need a Prisma migration in `apps/api`; never edit an existing migration.
- Shared types and validation go in `packages/shared`, not duplicated in web or api.
- Keep the security rules in `README.md` and `OPERATIONS.md` (auth, cookies, CSRF, rate limits). Never weaken them.
- Never commit secrets, keys or student data.
- A PR that changes a user-visible feature also updates `docs/FEATURES.md` (section and changelog).
- Fill in the PR template in `.github/pull_request_template.md`, including "Production impact".
- Before opening the pull request, run `pnpm lint`, `pnpm typecheck` and `pnpm test`, and report the results.
- PR description: what was wrong, what you changed, how to test it, and `Closes #<issue number>`.
- If the issue is unclear or needs a product decision, ask in a comment instead of guessing.

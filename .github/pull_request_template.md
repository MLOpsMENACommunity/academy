## What

<!-- What changes for users, admins or speakers, and why. -->

## Production impact

<!-- Migrations (additive only?), behaviour changes, new settings or secrets, rollback, verdict: NONE / LOW / MEDIUM / HIGH. -->

## Tests

<!-- What you ran locally: lint, typecheck, unit, API e2e, build, Playwright. -->

## Checklist

- [ ] docs/FEATURES.md updated for user-visible changes (and docs/ENGINEERING.md for architecture changes)
- [ ] New admin routes tagged with `@AdminCan(...)` and docs/ADMIN-ROLES.md updated
- [ ] Every new string in English and Arabic, checked in RTL and at 390 px
- [ ] Personal data added to the export, deletion, anonymisation and retention paths (if any)
- [ ] No secrets, passwords or real student data in code, tests or docs

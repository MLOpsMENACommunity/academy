# Roadmap

v1 scope is described in the README. The items below are **v2 backlog**: documented, not built.

## Automatic Google Drive sharing

Today an admin copies enrolled students' Google emails and pastes them into the
Drive share dialog (see Admin → Course → Enrolled students), then ticks "Drive
access granted" per student.

v2: when a payment is approved, share the course folder with the student's
Google account through the Google Drive API (`permissions.create`, role
`reader`, `sendNotificationEmail: false`), and revoke it on refund or removal
(`permissions.delete`). Needs a Workspace service account with domain-wide
delegation, or OAuth as the folder owner. The `Enrollment.driveAccessGranted`
flag and audit log entries already exist and would be set by the job.

## Card payments (Paymob)

Built (see FEATURES.md 4.5, DEPLOY.md "Card payments (Paymob)"), off until the
Paymob account is opened and its keys are set. Left for later: refunds from the
admin page (today in the Paymob dashboard), wallets and Fawry through Paymob, and
showing approximate USD/EUR prices to students abroad.

## Discord / Telegram role sync

Give enrolled students a course role or channel access automatically, and remove
it when the course ends.

## Analytics

Beyond the built-in funnel counts: cohort retention, attendance vs. completion,
feedback trends per instructor, and source attribution across courses.

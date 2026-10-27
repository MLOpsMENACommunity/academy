# Admin roles and accounts

Who on the team can do what in the academy admin panel, how to add and remove admins, and what to do
about passwords. The features themselves are in [FEATURES.md](FEATURES.md#11-the-admin-panel); how the
permission guard works is in [ENGINEERING.md](ENGINEERING.md#5-authentication-and-authorisation).

> **Status.** Permission presets, Admin → Team and Admin → Media come from PR #59 and are on
> **staging** (`v2026.10.12-2`) until that release is promoted. In **production** today
> (`v2026.10.11-2`) there are no presets: every admin account can use the whole admin panel, and new
> admins can only be created through the database or by the seed. Everything below describes the
> behaviour once PR #59 is in production.

## 1. The six presets

An admin account has **one or more** presets. They add up: an admin with ACADEMIC and ADMISSIONS can
use both sets of pages. `SUPER` can do everything.

| Preset | In the app | Can use | Can't use |
|---|---|---|---|
| `SUPER` | Super admin | Everything, including **Team**, **Settings**, the **Audit log** and **Talents** | — |
| `ACADEMIC` | Sessions and academics | Courses (create, edit, sessions, screening questions, status, duplicate, archive, delete), live sessions and their registrations, assessments and grading, gradebooks, certificates, points and badges, leaderboards, course announcements, feedback, course automation rules, enrolled students and Drive access, learn-page preview of any course, image upload | Applications, the student directory, payments, speakers' applications and availability, Team, Settings, Audit |
| `CONTENT` | Social media and content | **Admin → Media only**: course and session covers, live session covers, speaker photos, recording and playlist links, image upload | Any student or applicant data, payments, the full course/session/speaker editors, learn previews |
| `ADMISSIONS` | Admissions | Applications (review, shortlist, accept, reject, waitlist, notes, CSV), students (directory, profile, CV, notes, edit, add, delete, switch to speaker), saved views, enrol by email, waiting lists, enrolled students and Drive access, read-only course list and details | Editing courses, assessments, certificates, payments, speakers |
| `SPEAKERS` | Speakers | Speaker profiles (create, edit, delete), who is listed for consultations (prices, link, hours), speaker applications (review, approve, reject), availability slots and bookings (generate, edit, release, cancel, create a course draft), assigning speakers to courses, switching accounts between student and speaker, image upload | Students, applications, payments, courses' content |
| `FINANCE` | Finance | Payments (review proofs, open screenshots, approve, reject), consultation payments (view screenshots, approve, reject) and bookings (cancel), the admin dashboard | Everything else |

### Pages by preset

| Admin section | SUPER | ACADEMIC | CONTENT | ADMISSIONS | SPEAKERS | FINANCE |
|---|---|---|---|---|---|---|
| Dashboard | ✓ | ✓ | | ✓ | | ✓ |
| Payments | ✓ | | | | | ✓ |
| Applications | ✓ | | | ✓ | | |
| Students | ✓ | | | ✓ | | |
| Talents | ✓ | | | | | |
| Points & badges | ✓ | ✓ | | | | |
| Courses | ✓ | ✓ | | ✓ (read) | | |
| Sessions (live) | ✓ | ✓ | | | | |
| Speakers | ✓ | | | | ✓ | |
| Media | ✓ | | ✓ | | | |
| Team | ✓ | | | | | |
| Settings | ✓ | | | | | |
| Audit | ✓ | | | | | |

### Course tabs by preset

| Tab | Presets |
|---|---|
| Details, Staff, Questions, Sessions, Assessments, Leaderboard, Certificates, Announcements, Feedback, Automation | ACADEMIC |
| Applications, Enrol by email, Waiting list | ADMISSIONS |
| Enrolled students | ADMISSIONS, ACADEMIC |

The admin opens on their first allowed section; any other section shows "No access". The API is the
real gate: every admin route is tagged with the presets that may use it, read from the database on
every request, so a change applies on the admin's next click without signing them out. A route without
a tag is SUPER-only (default deny), and the unit test `apps/api/src/common/admin-routes.spec.ts` fails
if a route is untagged, if Team/Settings/Audit open to anyone but SUPER, or if CONTENT can reach
anything beyond Media.

Admin notifications follow the presets too: Drive-access alerts go to ADMISSIONS and ACADEMIC, speaker
booking alerts to SPEAKERS; SUPER gets all of them.

### Known gaps

- **Awarding points to one student** uses the "Award or adjust points" box on Admin → Students →
  student. The award itself needs ACADEMIC, but the Students page needs ADMISSIONS. An ACADEMIC-only
  admin can still award points through **Admin → Points & badges → CSV import** (any number of
  students, with a dry-run preview), and see standings in each course's **Leaderboard** tab. Give the
  person both presets if they need the per-student box, or wait for the attendance upload (see
  [POINTS.md](POINTS.md)).
- **Course staff are not admins.** People on a course's staff (any account: speaker, student or
  admin) work in the **Teaching** area (`/teach`), limited to the courses they are on and to their
  role's permissions there (Admin → Courses → {course} → **Staff**; see FEATURES.md §9.4). An admin
  without ACADEMIC (e.g. ADMISSIONS only) who is on a course's staff gets exactly that role there.
  SUPER and ACADEMIC can do everything in every course, staff or not.

## 2. Recommended team mapping

Each person gets their own account. Give the smallest set of presets that covers the job.

| Account | Presets | Why |
|---|---|---|
| The owner | `SUPER` | Manages the team, settings and the audit log. Keep at least two SUPER admins if possible (the owner plus one trusted backup), so a lost password never locks the team out |
| sessionsadmin@mlopsmena.com | `ACADEMIC` | Runs courses and live sessions, assessments, grading, points, certificates and announcements. Add `ADMISSIONS` only if this mailbox also handles applications or needs the per-student points box |
| socialmedia@mlopsmena.com | `CONTENT` | Uploads covers and speaker photos and sets recording links, with no access to any personal data |
| An admissions mailbox (optional) | `ADMISSIONS` | Screens applications, manages students, enrol-by-email and waiting lists |
| A speakers mailbox (optional) | `SPEAKERS` | Reviews speaker applications, publishes availability, manages bookings |
| A finance mailbox (optional) | `FINANCE` | Verifies InstaPay / Vodafone Cash payments |

## 3. Create an admin (Admin → Team)

Only a SUPER admin can do this.

1. Sign in, open **Admin → Team**, click **Add admin**.
2. Enter the email address, tick one or more presets under **What they can do**, choose the language of the welcome email, and
   optionally the person's English name.
3. Click **Add to the team**. One of two things happens:
   - **New address:** an admin account is created with no password, and the person receives the
     "choose your password" email (`accountCreated`). The link is valid **7 days**. Choosing a password
     also confirms the email address. Until they sign in, the Team list marks them **pending**.
   - **Existing student or speaker account:** it is promoted to admin with those presets and gets an
     in-app notice. This only works if that account has **confirmed its email address** (otherwise
     anyone who registered `sessionsadmin@…` first could become an admin): ask them to confirm, then add
     them again. Deleted accounts and existing admins are refused.
4. If the welcome link expires, the person uses **Forgot password** on the login page (section 5).

Nobody, including SUPER, ever sets, sees or sends another person's password. Every change is in the
audit log (`admin.invited`, `admin.promoted`, `admin.permissions_changed`, `admin.removed`), with ids
and presets only.

**Change presets:** Admin → Team → the admin → **Change permissions** → tick or untick presets → save. It applies on their next
request.

## 4. Why passwords can't be retrieved

Passwords are stored only as **argon2id hashes** (`@node-rs/argon2`, memory 19 MiB, 2 iterations).
A hash is one-way: the academy can check that a typed password matches, but nobody (not the team, not
the database owner, not Cloudflare) can turn the hash back into the password. That's why there is no
"show password" anywhere, and why the answer to "what's the password for X?" is always "reset it".
Google sign-in accounts may have no password at all.

## 5. Reset a password

1. Go to `https://academy.mlopsmena.com/en/login` → **Forgot password?** (`/forgot-password`).
2. Enter the account's email. If an account exists, a reset link is emailed (valid **1 hour**). The page
   says the same thing whether or not the account exists.
3. Open the link, choose a new password. Every session on every device is signed out, the email counts
   as confirmed, and a login lockout (10 failed attempts in 15 minutes) is cleared.

A signed-in admin can also change their own password in **Profile → Account → Change password** (needs
the current one). There is no admin action to reset someone else's password: they use "Forgot
password" with access to their own inbox.

## 6. List the current admins

In the app: **Admin → Team** (SUPER only) lists every admin with name, email, presets, pending state
and last sign-in.

From the database (read-only), in the Neon console → **SQL Editor**, on the production database. Only
run `SELECT` statements there:

```sql
SELECT email, role, "adminPermissions"
FROM "User"
WHERE role = 'ADMIN' AND "deletedAt" IS NULL;
```

The column names match `apps/api/prisma/schema.prisma` (`User.email`, `User.role`,
`User.adminPermissions`, `User.deletedAt`). `"adminPermissions"` exists only once migration
`20261027120000_admin_permissions` (PR #59) has been applied. On a database without it, use:

```sql
SELECT email, role FROM "User" WHERE role = 'ADMIN' AND "deletedAt" IS NULL;
```

## 7. Remove an admin, and the last-SUPER rule

**Admin → Team → the admin → Remove from team.** The account is kept but becomes a **student**
account with no presets: their admin access stops on their next request, and their past actions stay
in the audit log under their id. To close the account entirely, they delete it from Profile → Account
(or the team deletes it from Admin → Students once it is a student account).

**There is always at least one SUPER admin.** The last SUPER admin can't be demoted, removed from the
team, or delete their own account (`LAST_SUPER`). The check runs under row locks on every SUPER admin,
so two admins removing each other at the same moment can't both succeed. Admin accounts can't be
edited or deleted from Admin → Students (`ADMIN_ACCOUNT`); use Team.

## 8. Shared mailboxes

Role mailboxes such as `sessionsadmin@mlopsmena.com` and `socialmedia@mlopsmena.com` are convenient
for receiving email, but **each person should have their own academy account** rather than sharing one
login:

- the audit log then says who did what;
- removing one person doesn't mean changing a password everyone knows;
- one person's lockout or password reset doesn't sign the others out;
- passwords never need to be passed around in chat.

If a role mailbox must have an account (for example to receive the welcome email), keep its presets
minimal and its password in the team password manager, and prefer adding the people who use it as
their own admins with the same presets.

## 9. Every admin route

Generated from the controllers (`@Roles('ADMIN')` + `@AdminCan(...)`), the same discovery the
route test uses. SUPER may use every route. Speaker-portal routes (`/api/speaker/*`) are for SPEAKER
accounts, and the Teaching routes (`/api/teach/courses/:courseId/*`, also `/api/speaker/courses/*`)
are for course staff by course permission (`@CourseCan`, checked by `teaching-routes.spec.ts`); neither
is listed.

| Area | Method | Route | Presets allowed (SUPER always) |
|---|---|---|---|
| Team, settings, audit | GET | `/api/admin/team` | SUPER only |
| Team, settings, audit | POST | `/api/admin/team` | SUPER only |
| Team, settings, audit | PUT | `/api/admin/team/:id` | SUPER only |
| Team, settings, audit | POST | `/api/admin/team/:id/remove` | SUPER only |
| Team, settings, audit | GET | `/api/admin/audit` | SUPER only |
| Team, settings, audit | GET | `/api/admin/settings` | SUPER only |
| Team, settings, audit | PUT | `/api/admin/settings` | SUPER only |
| Dashboard | GET | `/api/admin/dashboard` | ADMISSIONS, ACADEMIC, FINANCE |
| Payments | GET | `/api/admin/payments` | FINANCE |
| Payments | GET | `/api/admin/payments-count` | FINANCE |
| Payments | GET | `/api/admin/payments/:id` | FINANCE |
| Payments | GET | `/api/admin/payments/:id/screenshot` | FINANCE |
| Payments | POST | `/api/admin/payments/:id/approve` | FINANCE |
| Payments | POST | `/api/admin/payments/:id/reject` | FINANCE |
| Consultations | GET | `/api/admin/consultations/experts` | SPEAKERS |
| Consultations | PUT | `/api/admin/consultations/experts/:instructorId` | SPEAKERS |
| Consultations | GET | `/api/admin/consultations/bookings` | FINANCE |
| Consultations | GET | `/api/admin/consultations/bookings/:id/screenshot` | FINANCE |
| Consultations | POST | `/api/admin/consultations/bookings/:id/approve` | FINANCE |
| Consultations | POST | `/api/admin/consultations/bookings/:id/reject` | FINANCE |
| Consultations | POST | `/api/admin/consultations/bookings/:id/cancel` | FINANCE |
| Applications | GET | `/api/admin/applications` | ADMISSIONS |
| Applications | GET | `/api/admin/applications.csv` | ADMISSIONS |
| Applications | GET | `/api/admin/applications/:id` | ADMISSIONS |
| Applications | POST | `/api/admin/applications/bulk` | ADMISSIONS |
| Applications | POST | `/api/admin/applications/:id/notes` | ADMISSIONS |
| Applications | POST | `/api/applications` | all presets (own account) |
| Applications | POST | `/api/admin/applications/:id/transition` | ADMISSIONS |
| Students and accounts | GET | `/api/admin/students` | ADMISSIONS |
| Students and accounts | GET | `/api/admin/students.csv` | ADMISSIONS |
| Students and accounts | GET | `/api/admin/students/:id` | ADMISSIONS |
| Students and accounts | GET | `/api/admin/talents` | SUPER |
| Students and accounts | GET | `/api/admin/students/:id/cv` | ADMISSIONS |
| Students and accounts | POST | `/api/admin/students/:id/notes` | ADMISSIONS |
| Students and accounts | GET | `/api/admin/saved-filters` | ADMISSIONS |
| Students and accounts | POST | `/api/admin/saved-filters` | ADMISSIONS |
| Students and accounts | DELETE | `/api/admin/saved-filters/:id` | ADMISSIONS |
| Students and accounts | PUT | `/api/admin/users/:id/role` | SPEAKERS, ADMISSIONS |
| Students and accounts | POST | `/api/admin/students` | ADMISSIONS |
| Students and accounts | PUT | `/api/admin/students/:id/profile/:section` | ADMISSIONS |
| Students and accounts | POST | `/api/admin/students/:id/delete` | ADMISSIONS |
| Courses, sessions, questions, enrolments, announcements, feedback | GET | `/api/admin/courses` | ACADEMIC, ADMISSIONS |
| Courses, sessions, questions, enrolments, announcements, feedback | POST | `/api/admin/courses` | ACADEMIC |
| Courses, sessions, questions, enrolments, announcements, feedback | GET | `/api/admin/courses/:id` | ACADEMIC, ADMISSIONS |
| Courses, sessions, questions, enrolments, announcements, feedback | PUT | `/api/admin/courses/:id` | ACADEMIC |
| Courses, sessions, questions, enrolments, announcements, feedback | DELETE | `/api/admin/courses/:id` | ACADEMIC |
| Courses, sessions, questions, enrolments, announcements, feedback | POST | `/api/admin/courses/:id/archive` | ACADEMIC |
| Courses, sessions, questions, enrolments, announcements, feedback | PUT | `/api/admin/courses/:id/questions` | ACADEMIC |
| Courses, sessions, questions, enrolments, announcements, feedback | POST | `/api/admin/courses/:id/sessions` | ACADEMIC |
| Courses, sessions, questions, enrolments, announcements, feedback | POST | `/api/admin/courses/:id/sessions/bulk` | ACADEMIC |
| Courses, sessions, questions, enrolments, announcements, feedback | POST | `/api/admin/courses/:id/duplicate` | ACADEMIC |
| Courses, sessions, questions, enrolments, announcements, feedback | PUT | `/api/admin/courses/:id/sessions/order` | ACADEMIC |
| Courses, sessions, questions, enrolments, announcements, feedback | PUT | `/api/admin/courses/:id/sessions/:sessionId` | ACADEMIC |
| Courses, sessions, questions, enrolments, announcements, feedback | DELETE | `/api/admin/courses/:id/sessions/:sessionId` | ACADEMIC |
| Courses, sessions, questions, enrolments, announcements, feedback | GET | `/api/admin/courses/:id/enrollments` | ADMISSIONS, ACADEMIC |
| Courses, sessions, questions, enrolments, announcements, feedback | GET | `/api/admin/courses/:id/enrollments.csv` | ADMISSIONS, ACADEMIC |
| Courses, sessions, questions, enrolments, announcements, feedback | GET | `/api/admin/courses/:id/drive-sharing` | ADMISSIONS, ACADEMIC |
| Courses, sessions, questions, enrolments, announcements, feedback | POST | `/api/admin/courses/:id/drive-sharing/run` | ADMISSIONS, ACADEMIC |
| Courses, sessions, questions, enrolments, announcements, feedback | PUT | `/api/admin/enrollments/:id/drive-access` | ADMISSIONS, ACADEMIC |
| Courses, sessions, questions, enrolments, announcements, feedback | POST | `/api/admin/enrollments/:id/drive-removed` | ADMISSIONS, ACADEMIC |
| Courses, sessions, questions, enrolments, announcements, feedback | GET | `/api/admin/courses/:id/announcements` | ACADEMIC |
| Courses, sessions, questions, enrolments, announcements, feedback | GET | `/api/admin/courses/:id/announcements/audience` | ACADEMIC |
| Courses, sessions, questions, enrolments, announcements, feedback | POST | `/api/admin/courses/:id/announcements` | ACADEMIC |
| Courses, sessions, questions, enrolments, announcements, feedback | GET | `/api/admin/courses/:id/announcements/telegram-request` | ACADEMIC |
| Courses, sessions, questions, enrolments, announcements, feedback | POST | `/api/admin/courses/:id/announcements/telegram-request` | ACADEMIC |
| Courses, sessions, questions, enrolments, announcements, feedback | GET | `/api/admin/courses/:id/feedback` | ACADEMIC |
| Course automation rules | GET | `/api/admin/courses/:id/automation` | ACADEMIC |
| Course automation rules | PUT | `/api/admin/courses/:id/automation` | ACADEMIC |
| Course automation rules | POST | `/api/admin/courses/:id/automation/recommended` | ACADEMIC |
| Course automation rules | PUT | `/api/admin/courses/:id/automation/rules/:type` | ACADEMIC |
| Course automation rules | POST | `/api/admin/courses/:id/automation/rules/:type/preview` | ACADEMIC |
| Course automation rules | GET | `/api/admin/courses/:id/automation/log` | ACADEMIC |
| Assessments and grading | GET | `/api/admin/courses/:id/assessments` | ACADEMIC |
| Assessments and grading | POST | `/api/admin/courses/:id/assessments` | ACADEMIC |
| Assessments and grading | POST | `/api/admin/courses/:id/assessments/import` | ACADEMIC |
| Assessments and grading | PUT | `/api/admin/courses/:id/assessments/order` | ACADEMIC |
| Assessments and grading | GET | `/api/admin/courses/:id/gradebook.csv` | ACADEMIC |
| Assessments and grading | GET | `/api/admin/assessments/:id` | ACADEMIC |
| Assessments and grading | PUT | `/api/admin/assessments/:id` | ACADEMIC |
| Assessments and grading | DELETE | `/api/admin/assessments/:id` | ACADEMIC |
| Assessments and grading | GET | `/api/admin/assessments/:id/submissions` | ACADEMIC |
| Assessments and grading | GET | `/api/admin/submissions/:id` | ACADEMIC |
| Assessments and grading | GET | `/api/admin/submissions/:id/file` | ACADEMIC |
| Assessments and grading | PUT | `/api/admin/submissions/:id/grade` | ACADEMIC |
| Certificates | GET | `/api/admin/courses/:id/certificates` | ACADEMIC |
| Certificates | PUT | `/api/admin/courses/:id/certificate-rule` | ACADEMIC |
| Certificates | POST | `/api/admin/courses/:id/certificates` | ACADEMIC |
| Certificates | GET | `/api/admin/courses/:id/certificates.csv` | ACADEMIC |
| Certificates | POST | `/api/admin/certificates/:id/revoke` | ACADEMIC |
| Certificates | POST | `/api/admin/certificates/:id/reissue` | ACADEMIC |
| Points, badges, leaderboards | GET | `/api/admin/students/:id/points` | ACADEMIC |
| Points, badges, leaderboards | POST | `/api/admin/students/:id/points` | ACADEMIC |
| Points, badges, leaderboards | POST | `/api/admin/students/:id/badges` | ACADEMIC |
| Points, badges, leaderboards | DELETE | `/api/admin/badge-awards/:id` | ACADEMIC |
| Points, badges, leaderboards | POST | `/api/admin/points/import` | ACADEMIC |
| Points, badges, leaderboards | GET | `/api/admin/badges` | ACADEMIC |
| Points, badges, leaderboards | POST | `/api/admin/badges` | ACADEMIC |
| Points, badges, leaderboards | PATCH | `/api/admin/badges/:id` | ACADEMIC |
| Points, badges, leaderboards | GET | `/api/admin/courses/:id/leaderboard` | ACADEMIC |
| Points, badges, leaderboards | GET | `/api/admin/courses/:id/leaderboard.csv` | ACADEMIC |
| Enrol by email | GET | `/api/admin/courses/:id/invites` | ADMISSIONS |
| Enrol by email | GET | `/api/admin/courses/:id/invites/export.csv` | ADMISSIONS |
| Enrol by email | POST | `/api/admin/courses/:id/invites/preview` | ADMISSIONS |
| Enrol by email | POST | `/api/admin/courses/:id/invites` | ADMISSIONS |
| Enrol by email | POST | `/api/admin/courses/:id/invites/:inviteId/resend` | ADMISSIONS |
| Enrol by email | POST | `/api/admin/courses/:id/invites/:inviteId/revoke` | ADMISSIONS |
| Waiting list | GET | `/api/admin/courses/:id/waitlist` | ADMISSIONS |
| Waiting list | GET | `/api/admin/courses/:id/waitlist/export.csv` | ADMISSIONS |
| Waiting list | POST | `/api/admin/courses/:id/waitlist/notify` | ADMISSIONS |
| Waiting list | DELETE | `/api/admin/courses/:id/waitlist/:entryId` | ADMISSIONS |
| Course staff | GET | `/api/admin/courses/:id/staff` | ACADEMIC |
| Course staff | POST | `/api/admin/courses/:id/staff` | ACADEMIC |
| Course staff | PUT | `/api/admin/courses/:id/staff/:staffId` | ACADEMIC |
| Course staff | DELETE | `/api/admin/courses/:id/staff/:staffId` | ACADEMIC |
| Course staff | POST | `/api/admin/courses/:id/staff/roles` | ACADEMIC |
| Course staff | PUT | `/api/admin/courses/:id/staff/roles/:roleId` | ACADEMIC |
| Course staff | DELETE | `/api/admin/courses/:id/staff/roles/:roleId` | ACADEMIC |
| Live sessions | GET | `/api/admin/events` | ACADEMIC |
| Live sessions | GET | `/api/admin/events/:id` | ACADEMIC |
| Live sessions | POST | `/api/admin/events` | ACADEMIC |
| Live sessions | PUT | `/api/admin/events/:id` | ACADEMIC |
| Live sessions | DELETE | `/api/admin/events/:id` | ACADEMIC |
| Live sessions | GET | `/api/admin/events/:id/registrations` | ACADEMIC |
| Live sessions | GET | `/api/admin/events/:id/registrations.csv` | ACADEMIC |
| Speakers | GET | `/api/admin/instructors` | ACADEMIC, SPEAKERS |
| Speakers | GET | `/api/admin/instructors/:id` | ACADEMIC, SPEAKERS |
| Speakers | POST | `/api/admin/instructors` | SPEAKERS |
| Speakers | PUT | `/api/admin/instructors/:id` | SPEAKERS |
| Speakers | POST | `/api/admin/instructors/:id/delete` | SPEAKERS |
| Speakers | GET | `/api/admin/instructors/:id/courses` | SPEAKERS |
| Speakers | PUT | `/api/admin/instructors/:id/courses/:courseId` | SPEAKERS |
| Speakers | DELETE | `/api/admin/instructors/:id/courses/:courseId` | SPEAKERS |
| Speakers | GET | `/api/admin/speaker-applications` | SPEAKERS |
| Speakers | GET | `/api/admin/speaker-applications/:id` | SPEAKERS |
| Speakers | PUT | `/api/admin/speaker-applications/:id` | SPEAKERS |
| Speakers | POST | `/api/admin/speaker-applications/:id/review` | SPEAKERS |
| Speakers | GET | `/api/admin/speaking-slots` | SPEAKERS |
| Speakers | POST | `/api/admin/speaking-slots` | SPEAKERS |
| Speakers | POST | `/api/admin/speaking-slots/generate` | SPEAKERS |
| Speakers | PUT | `/api/admin/speaking-slots/:id/booking` | SPEAKERS |
| Speakers | POST | `/api/admin/speaking-slots/:id/course-draft` | SPEAKERS, ACADEMIC |
| Speakers | POST | `/api/admin/speaking-slots/:id/release` | SPEAKERS |
| Speakers | POST | `/api/admin/speaking-slots/:id/cancel` | SPEAKERS |
| Speakers | DELETE | `/api/admin/speaking-slots/:id` | SPEAKERS |
| Media | POST | `/api/admin/media/upload` | CONTENT, ACADEMIC, SPEAKERS |
| Media | GET | `/api/admin/media/library` | CONTENT |
| Media | PATCH | `/api/admin/media/courses/:id` | CONTENT |
| Media | PATCH | `/api/admin/media/courses/:id/sessions/:sessionId` | CONTENT |
| Media | PATCH | `/api/admin/media/events/:id` | CONTENT |
| Media | PATCH | `/api/admin/media/instructors/:id` | CONTENT |

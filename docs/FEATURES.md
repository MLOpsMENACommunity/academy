# MLOps MENA Academy: feature guide

The business guide to everything the academy at **academy.mlopsmena.com** does: who uses each
feature, why, how to use it step by step, its rules and limits, the emails it sends and where it
is live. It is written for the owner, the team, partners and sponsors. How it is built is in
[ENGINEERING.md](ENGINEERING.md); admin accounts are in [ADMIN-ROLES.md](ADMIN-ROLES.md); the
points scheme is in [POINTS.md](POINTS.md).

> **Keeping this document current.** Every pull request that adds or changes a user-visible
> feature must update this file in the same PR: the feature's section, the "Who can do what"
> matrix if access changes, its status, and a line in the [Changelog](#changelog). The PR
> template has a checklist item for it. A feature that isn't described here doesn't exist as
> far as the team, partners and sponsors are concerned.

## Status legend

Every feature carries one status. As of 12 Oct 2026:

| Status | Meaning | What it contains |
|---|---|---|
| **Live** | In production at academy.mlopsmena.com | Release `v2026.10.11-2`: everything up to and including PR #55 |
| **Staging** | Released to academy-staging.mlopsmena.com, waiting for promotion to production | Release `v2026.10.12-2` (`main`): PRs #56–#61 |
| **Pending** | An open pull request, not merged | PR #62 (the waiting list needs an account) |

Releases go tag → staging → test → the same tag to production (see [ENGINEERING.md](ENGINEERING.md#cicd-and-release)).
When the staging release is promoted, change every "Staging" below to "Live".

## Contents

1. [Who can do what](#1-who-can-do-what)
2. [Public site](#2-public-site)
   - [Course catalog and course pages](#21-course-catalog-and-course-pages) · [Learning paths](#22-learning-paths) · [Roadmaps](#23-roadmaps) · [Speakers](#24-speakers) · [Live sessions and the recordings archive](#25-live-sessions-and-the-recordings-archive) · [Calendars](#26-calendars) · [Certificate verification](#27-certificate-verification) · [What's new, policies and contact](#28-whats-new-policies-and-contact)
3. [Accounts](#3-accounts)
   - [Sign up as a student or a speaker](#31-sign-up-as-a-student-or-a-speaker) · [Google sign-in](#32-google-sign-in) · [Email verification](#33-email-verification) · [Passwords and sign-in security](#34-passwords-and-sign-in-security) · [Onboarding and the profile](#35-onboarding-and-the-profile) · [Account settings, data export and deletion](#36-account-settings-data-export-and-deletion) · [Notifications](#37-in-app-notifications)
4. [Applications and admissions](#4-applications-and-admissions)
   - [Applying](#41-applying) · [Statuses](#42-application-statuses) · [Reviewing applications](#43-reviewing-applications-admin) · [CVs](#44-cvs) · [Payments](#45-payments-paid-courses) · [Google Drive access](#46-google-drive-access-paid-courses) · [Enrol by email](#47-enrol-by-email) · [Waiting list](#48-waiting-list-notify-me)
5. [The learn page](#5-the-learn-page)
6. [Assessments](#6-assessments-quizzes-labs-assignments)
7. [Certificates](#7-certificates)
8. [Points, badges and leaderboards](#8-points-badges-and-leaderboards)
9. [The speaker portal](#9-the-speaker-portal)
10. [Live sessions (admin side)](#10-live-sessions-admin-side)
11. [The admin panel](#11-the-admin-panel)
12. [Emails and notifications](#12-emails-and-notifications)
13. [Privacy and data](#13-privacy-and-data)
14. [Staging vs production](#14-staging-vs-production)
15. [Changelog](#changelog)

---

## 1. Who can do what

Roles: a **visitor** has no account; a **student** and a **speaker** are the two self-service account
types (one account, one role); an **admin** has one or more permission presets. The presets are
**Staging** (PR #59): in production today every admin can do everything, like `SUPER`.

✓ = can do it. "own" = only for themselves. "assigned" = only for courses they are assigned to.
"staff³" = course staff (any account: student, speaker or admin) in the courses whose staff they are
on, when their role there has the permission (see [9.4](#94-course-staff-and-the-teaching-area)).
"S" = staging only.

| Feature | Visitor | Student | Speaker | SUPER | ACADEMIC | CONTENT | ADMISSIONS | SPEAKERS | FINANCE |
|---|---|---|---|---|---|---|---|---|---|
| Browse courses, paths, roadmaps, speakers, sessions, recordings | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Verify a certificate | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Register for a free live session | | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Join a course waiting list | ✓ (account needed once #62 ships) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Apply to a course, pay, learn | | ✓ | | ✓¹ | ✓¹ | ✓¹ | ✓¹ | ✓¹ | ✓¹ |
| Take quizzes, submit work, see own grades, points, certificates | | own | | own¹ | own¹ | own¹ | own¹ | own¹ | own¹ |
| Preview any course's learn page and assessments | | staff³ | staff³ | ✓ | ✓ | | | | |
| Speaker application, slots, bookings | | | own | | | | | | |
| Announce to enrolled students / session registrants | | staff³ | staff³ / own sessions | ✓ (courses) | ✓ (courses) | | | | |
| Create and grade assessments, gradebook | | staff³ | staff³ | ✓ | ✓ | | | | |
| Award or remove course points | | staff³ | staff³ | ✓ | ✓² | | | | |
| Edit session materials (what we cover, recording, links) | | staff³ | staff³ | ✓ | ✓ | ✓ (media fields only, S) | | | |
| Courses: create, edit, sessions, questions, status | | | | ✓ | ✓ | | read | | |
| Course staff and roles (Staff tab) | | | | ✓ | ✓ | | | | |
| Course details, sessions, applications, enrolment, certificates, roster of one course | | staff³ | staff³ | ✓ | ✓ | | | | |
| Live sessions: create, edit, publish, registrations | | | | ✓ | ✓ | covers only (S) | | | |
| Certificates: rule, issue, revoke, re-issue | | | | ✓ | ✓ | | | | |
| Points CSV import, badges, leaderboards (admin) | | | | ✓ | ✓ | | | | |
| Applications: review, shortlist, accept, reject, notes | | | | ✓ | | | ✓ | | |
| Students: list, profile, CV, notes, edit, add, delete | | | | ✓ | | | ✓ | | |
| Enrol by email, waiting lists, saved views | | | | ✓ | | | ✓ | | |
| Enrolled students list, Drive access | | | | ✓ | ✓ | | ✓ | | |
| Payments: review, approve, reject | | | | ✓ | | | | | ✓ |
| Speaker profiles, applications, availability, bookings, assign courses | | | | ✓ | | | | ✓ | |
| Switch an account between student and speaker | | | | ✓ | | | ✓ | ✓ | |
| Admin → Media (image uploads, covers, photos, recording links) | | | | ✓ | upload | ✓ (S) | | upload | |
| Admin dashboard (funnel and counts) | | | | ✓ | ✓ | | ✓ | | ✓ |
| Team, Settings, Audit log | | | | ✓ | | | | | |

¹ An admin can try the student flow on their own account. ² Award through the points CSV import; the
per-student "Award or adjust points" box sits on the student page, which needs ADMISSIONS too (see
[ADMIN-ROLES.md](ADMIN-ROLES.md#known-gaps)). ³ Pending (this PR): course staff with per-course roles
replace "assigned speakers"; an assigned speaker becomes their course's Main instructor or a
Co-instructor.

---

## 2. Public site

Everything here is public, needs no account, works in English and Arabic (full right-to-left
layout), and is fast for everyone because pages are cached at the edge (an admin edit shows publicly
within about 2–3 minutes).

### 2.1 Course catalog and course pages

**Status:** Live. **Who:** visitors, students. **Business use:** the shop window; the main site links
each course card here (`/courses/<slug>?ref=main-site`, see [INTEGRATION.md](../INTEGRATION.md)).

- **Catalog** (`/courses`): every course that isn't a draft or archived. Filters: level (Junior, Mid,
  Senior, Lead), price (free/paid), language, status. Filters run in the browser and live in the URL,
  so a filtered view can be shared.
- **Course page** (`/courses/<slug>`): outline, schedule in the visitor's own time zone, instructors
  (linked to their speaker pages), price, seats left, who it's for and not for, prerequisites,
  "Before the course starts", what's included, FAQ, and the certificate rule.
- **Enrolled count and seats left:** the course page (under the title) and its cards in the catalog
  and on the home page say "**N students enrolled**", plus "**X seats left**" (or "**Course
  full**") while applications are open and the course has a capacity. Only the number is public,
  never who. It counts active enrolments of accounts that aren't deleted; seats left use the same
  seat rule as admissions. "No students enrolled yet" shows only on a course open for
  applications. Enrolling, withdrawing, a claimed invite and a deleted account refresh the pages
  within seconds. The course team can hide the count per course: Admin → Courses → {course} →
  Schedule → **Show enrolled count publicly** (on by default). The public API returns
  `enrolledCount` (null when hidden) and `seatsLeft`.
- **Course statuses** (set by the course team in Admin → Courses):

| Status | Public? | What visitors can do |
|---|---|---|
| Draft | No | Nothing (admins only) |
| Coming soon | Yes | Read the page, **Notify me** (waiting list); unknown details show "Will be announced soon" |
| Open | Yes | **Apply** (or **Enrol** when no approval is needed); shows "Opening soon" until "applications open at" |
| Closed | Yes | Read; no new applications |
| Completed | Yes | A past cohort: syllabus, instructors and recordings stay public, no applications |
| Archived | No | Hidden; kept for records once anyone has applied |

- **Tracking:** `ref` and UTM parameters are kept through sign-up and stored on the application.
- **Current courses:** *AI Architecture Design* (free, Open, 6 live sessions on Sundays from 18 Oct
  2026) and *Kubernetes Mastery* (paid, Coming soon).

### 2.2 Learning paths

**Status:** Live. **Who:** everyone. **Use:** guided routes for people who don't know where to start.

`/learning-paths` lists paths; each path page (`/learning-paths/<slug>`) is an ordered list of steps:
an academy course, a past live session recording, a lesson of a course with public recordings, or a
YouTube video. Signed-in students see their progress through the course steps. Steps that aren't
public are left out automatically. Paths are edited in code (`apps/web/src/lib/paths.ts`).

### 2.3 Roadmaps

**Status:** Live. **Who:** everyone. **Use:** the community's open-source career roadmaps, shown in
the academy with links to matching paths.

`/roadmaps` and `/roadmaps/<slug>`: the roadmaps from the mlopsmena.com website repository
(`content/roadmaps/*.md`), copied byte for byte with `pnpm roadmaps:sync`. Three today: basic MLOps
engineer, DevOps to MLOps, senior MLOps engineer. Arabic pages show Arabic headings with an English
notice. Edit roadmaps in the website repo, never in the academy.

### 2.4 Speakers

**Status:** Live. **Who:** everyone. **Use:** credit for the people who teach; a reason to become a
speaker.

`/speakers` lists every instructor and live-session speaker; `/speakers/<slug>` shows photo, title,
bio, LinkedIn/GitHub, their courses and sessions (upcoming and past, with recordings). The page links
to the speaker portal sign-up ("I'm a speaker"). Old slugs redirect to the new one. Speaker records
come from Admin → Speakers, the speaker portal (approved applications) and the archive import of the
community website.

### 2.5 Live sessions and the recordings archive

**Status:** Live. **Who:** everyone; registering needs an account with a confirmed email.

- **Sessions list** (`/sessions`): upcoming free live sessions (talks, hands-on, workshops, Q&A,
  podcasts) with the next one highlighted, then past ones.
- **Session page** (`/sessions/<slug>`): description, speaker(s), hosts and guests, time in your
  zone, language, platform, seats left. **Register (free)** → you're registered, get a confirmation
  email, and reminders 24 h and 1 h before. The **join link** appears on the page for registered
  people from 60 minutes before the start (Settings → live link window). **Add to calendar** (Google
  or `.ics`). **Cancel registration** frees your seat. After it ends: the recording, when set.
  Cancelled sessions say so.
- **Recordings library** (`/sessions/recordings`): every public recording (past live sessions and
  lessons of courses with public recordings), with search and filters by topic and category
  (hands-on, industry, talk, course recording).

### 2.6 Calendars

**Status:** Live. There is no embedded Google community calendar in the academy: the community-wide
calendar is on mlopsmena.com/sessions (website repository). The academy offers:

- **Per session:** "Add to calendar" (Google Calendar link or `.ics`) on live session pages and on
  each course session in the learn page; "Whole course" `.ics` on the learn page.
- **Private calendar subscription** (Profile → Account → Calendar, or the learn page calendar menu):
  a personal `webcal` link with all your course sessions and the live sessions you registered for.
  It updates by itself (calendar apps poll it, Apple/Outlook every 6 h, Google on its own schedule).
  **Reset link** revokes the old URL at once. It never contains join links or your name.

### 2.7 Certificate verification

**Status:** Live. **Who:** anyone (employers, recruiters). **Use:** proves a certificate is genuine.

`/certificates/<serial>` (serial like `MMA-2026-XXXXXXXX`) shows the name (English and Arabic), the
course, issue date, instructors, grade, serial, issuer and status (**Valid** or **Revoked**), with a
public PDF download for valid ones. Unknown serials give "not found". The page is never cached, so a
revocation shows at once; it is `noindex`. Limits: 30 lookups a minute per visitor; 10 PDF downloads
a minute per IP.

### 2.8 What's new, policies and contact

**Status:** Live. `/whats-new` is a short changelog for users (the header shows a dot until you open
it). Policies: `/privacy`, `/terms`, `/refund-policy`, `/code-of-conduct`, `/contact` in both
languages; contact details come from Settings (support email and WhatsApp; empty means not shown).

---

## 3. Accounts

### 3.1 Sign up as a student or a speaker

**Status:** Live. Register (`/register`) and log in (`/login`) offer **I'm a student / I'm a speaker**
(`?as=speaker` preselects speaker). One account has one role:

- **Students** go through onboarding (the profile) and can apply to courses.
- **Speakers** skip onboarding, land on the speaker portal (`/speaker`) and can't apply to courses.
- Nobody can make themselves an admin. To switch an account between student and speaker, ask the
  team (Admin → Students → student, or Admin → Speakers → Applications → application → Account type).
  A speaker with upcoming bookings must have them released first; a student with applications or
  enrolments stays a student; admin accounts can't be switched there.
- The team can also **create a student account** (Admin → Students → Add student): the person gets a
  "choose your password" email, valid 7 days.

### 3.2 Google sign-in

**Status:** Live where the Google OAuth client is configured. "Continue with Google" on login and
register. Only Google accounts with a verified email are accepted. If Google signs in to an account
whose email was never confirmed, any password and sessions on it are removed first (so pre-registering
someone else's email gives no access). The student/speaker choice applies only when Google creates the
account.

### 3.3 Email verification

**Status:** Live. After registering, a "confirm your email" email (link valid 24 h; **Resend** on the
banner). It works only while signed in to the account it was sent for; opening it again once the
email is confirmed just confirms again (no "invalid link" error). Confirmed email is required to
apply, register for live sessions, join the team as an admin, and to claim "enrol by email" invites.

### 3.4 Passwords and sign-in security

**Status:** Live.

- **Forgot password** (`/forgot-password`): enter your email; if an account exists, a reset link
  (valid 1 hour) is emailed. The page never reveals whether the account exists. At most one reset
  email a minute and five an hour per account, so nobody can flood someone's inbox with it. Resetting
  signs you out everywhere, confirms the email and clears a lockout.
- **Change password:** Profile → Account (needs the current password; Google-only accounts must have
  signed in with Google in the last 10 minutes). An email confirms every change.
- **Lockout:** 10 failed logins in 15 minutes lock the account for 15 minutes (a reset unlocks it).
- **Students can't change their login email** (removed as an account-takeover risk). Ask the team.
- Signing in (or registering) in a browser that was signed in to another account ends that other
  session on the server too.
- Sessions last 30 days with silent renewal; changing the password, deleting the account or a stolen
  refresh token signs every device out at once.

### 3.5 Onboarding and the profile

**Status:** Live. **Who:** students. **Use:** the team screens applicants and understands the
community (with consent).

- **Onboarding** (`/onboarding`) walks through the profile steps. **Required** before applying: Core
  (name, phone, country, city, time zone, employment, job title, experience, main area, Google email
  for course materials, preferred language, terms), Professional (ML experience, seniority), Education
  (highest degree), Links (LinkedIn and GitHub required), Community (how you heard about us, the
  community questions, and the **Telegram and Discord usernames**). **Optional:** Skills (self-ratings 1–5, cloud platforms, tools) and Goals
  (goals, topics, weekly hours, preferred times and format).
- **Profile** (`/profile`) shows completeness (0–100 %), lets students edit any step, upload a **CV**
  (PDF, 5 MB, optional) and opens the **Points** and **Account** tabs.
- **Telegram and Discord usernames** (required, Community step): Telegram 5–32 letters, digits or `_`
  (a leading `@` is dropped); Discord the current lowercase username (2–32 letters, digits, `_`, `.`)
  or a legacy `name#1234`. Students who completed their profile before these were asked keep
  everything (courses, learn pages, certificates); the dashboard and profile show a banner asking for
  them, and they need them before their next application. Admins see both in Admin → Students (list,
  detail, CSV) and on each application's profile snapshot, and can correct or clear them (Edit →
  Community & consent).
- Marketing emails are opt-in and unticked by default. The hiring questions ("open to opportunities",
  "share with hiring partners") were removed from the forms (PR #53); earlier answers stay on record.
- **Profile review:** a student whose profile hasn't changed for about 6 months gets one email asking
  them to review it.
- An invited student (enrol by email) can open their course before finishing the profile; the profile
  is then a nudge, not a gate.

### 3.6 Account settings, data export and deletion

**Status:** Live. Profile → Account:

- **Language** (English/Arabic) for the site and emails.
- **Calendar** subscription link (see 2.6).
- **Download my data:** a JSON export of everything the academy holds about you (profile,
  applications, payments, enrolments, certificates, points and badges, invites, speaker application
  and bookings).
- **Delete my account:** needs the password (or a recent Google sign-in) and typing to confirm.
  Sign-in is blocked immediately, sessions are revoked, upcoming live-session seats, waiting lists,
  leaderboard opt-ins and unused invites are removed, speaker bookings released (the team is told).
  Open applications are withdrawn (their seats go back to the course; a payment under review is
  closed and finance is told).
  Personal data is **anonymised 30 days later**. Payment and application records stay (anonymised) for
  accounting; certificates keep the serial but lose the name. The last super admin can't delete their
  account.
- After deleting, the homepage confirms it. Registering again with that address before the account is
  anonymised explains that it belongs to a deleted account (instead of "try logging in").
- The team can delete a student account (Admin → Students → student → Delete account, typed
  confirmation); the student is emailed that the team deleted it.

### 3.7 In-app notifications

**Status:** Live. The bell in the header shows unread notifications (checked every 2 minutes while
the tab is visible): application updates, announcements, grades, new assessments, badges, points,
certificates, speaker reviews and bookings, admin alerts. **Mark all as read**. Each links to the
relevant page. Times show in the viewer's own time zone; if the list can't load, the panel says so.

---

## 4. Applications and admissions

### 4.1 Applying

**Status:** Live. **Who:** students. Steps:

1. Course page → **Apply** (or **Enrol** for courses without approval).
2. Not signed in → register or log in (you come back to the course).
3. Confirm your email; complete the required profile steps (you come back to the form).
4. Answer the course's **screening questions** (short/long text, single/multi select with optional
   "please specify", yes/no, number) and submit.

Rules: one application per student per course; 10 applications a minute; speakers can't apply. A
copy of the profile is saved with the application. If the course needs no approval, a free course
enrols at once and a paid one goes straight to payment, unless capacity is full (then waitlisted).
Emails: "application received" and every status change (`applicationStatus`). The student follows
progress on the dashboard and `/dashboard/applications/<id>` (timeline, answers, next step).
When a course is full, the course page and the form say so before applying ("Join the waitlist" for
courses without approval). The course page's **Apply** button closes by itself at the deadline.

**Withdrawing:** on `/dashboard/applications/<id>`, **Withdraw application** (confirmation) frees the
seat. Allowed before enrolment, except while a payment is under review (the student contacts the team,
see the refund policy); enrolled students go through the team. Applying again reopens the same
application. Deleting an account withdraws its open applications too (see 3.6).

### 4.2 Application statuses

| Status | Meaning | Next |
|---|---|---|
| Submitted | Waiting for review | Shortlist, accept, reject, waitlist |
| Shortlisted | Holds a seat | Accept, reject, waitlist |
| Waitlisted | No seat now (also automatic when the course is full) | Shortlist, accept, reject |
| Awaiting payment | Accepted to a paid course | Student submits payment proof |
| Payment submitted | Proof uploaded | Finance approves or rejects |
| Payment rejected | Proof refused, with a reason | Student resubmits, or reject |
| Enrolled | In the course: learn page, calendar, reminders | — |
| Rejected | Not admitted, with a reason | — |
| Withdrawn | The student withdrew (or deleted their account) | Apply again; or Enrol by email |

Seats are held by Shortlisted, Awaiting payment, Payment submitted, Payment rejected and Enrolled
(accounts pending deletion hold none).

### 4.3 Reviewing applications (admin)

**Status:** Live. **Who:** ADMISSIONS (and SUPER). Admin → Applications (or Admin → Courses → course →
Applications):

- Filter by course, status, `ref`, profile fields (country, experience, seniority, area, skills…),
  search; save a filter as a **view** (saved filters); export CSV.
- Open an application: profile snapshot, answers, CV link, history, internal **notes**.
- Actions, one by one or in bulk: **Shortlist**, **Accept**, **Reject** (with a reason the student
  sees), **Waitlist**. Accepting when full waitlists instead.
- Every change is audited and emails the student.

### 4.4 CVs

**Status:** Live. Students upload one PDF (5 MB) in their profile; admissions open it from the
application or student page through a 5-minute private link (each view audited). CVs are deleted after
the retention period (Settings, default 180 days); the student is told and can upload a new one.

### 4.5 Payments (paid courses)

**Status:** Live. **Who:** students; FINANCE reviews.

1. When accepted, the student sees **Complete payment** with the amount and the academy's InstaPay
   handle and/or Vodafone Cash number (from Settings; a method is offered only once its details are
   set).
2. The student pays outside the academy, then submits proof: method, amount, transaction reference,
   sender name and phone/handle, date paid, and a screenshot (JPG, PNG or PDF, 5 MB). 10 a minute.
3. Admin → Payments (FINANCE): pending proofs with flags for **duplicate reference**, **duplicate
   screenshot** and **amount mismatch**. Open the screenshot (5-minute link, audited), check the real
   transaction history, tick **"I verified it in the transaction history"** (required) and **Approve**
   → Enrolled (email: "your seat is confirmed"), or **Reject** with a reason → the student can
   resubmit. The queue pages through pending, approved and rejected payments, and each payment links to
   its application (for ADMISSIONS).
4. Amount, reference and phone accept digits typed on an Arabic keyboard (١٥٠٠ is read as 1500).
5. If the student deletes their account while a payment is under review, it is closed ("Closed: the
   student deleted their account") and FINANCE gets a notification (refund if the money arrived); a
   deleted account's payment can't be approved.

Card payments (Paymob) are not built (see ROADMAP.md). Screenshots are deleted after the retention
period; payment records stay.

### 4.6 Google Drive access (paid courses)

**Status:** Live (manual). Paid-course recordings live in a private Drive folder. Admin → Courses →
course → Enrolled students lists each student's Google email; the admin shares the folder with those
addresses (never "anyone with the link") and ticks **Drive access granted**. If a student changes their
Google email or deletes the account, admins (ADMISSIONS/ACADEMIC) get an alert with the address to
remove, then click **Removed**. Automatic sharing is on the roadmap.

### 4.7 Enrol by email

**Status:** Live. **Who:** ADMISSIONS. **Use:** add sponsored students, partners' employees or a
previous cohort without the form, the profile gate or payment.

1. Admin → Courses → course → **Enrol by email**.
2. Paste addresses (commas, spaces, new lines, `Name <email>`) or upload a CSV (`email[, name, note]`),
   at most 300 per batch.
3. **Preview** classifies each: *Enrol now* (verified student account), *Invite* (no account or
   unconfirmed), *Already enrolled*, *Already invited*, *Speaker/Admin/Closed account, skipped*,
   *Not a valid email*, *Listed twice*. It warns if capacity is exceeded (direct enrolment ignores
   capacity).
4. Confirm. Options: **Email them** (default on); for paid courses **Enrol them without payment** must
   be ticked (no payment is recorded).

Existing verified students are enrolled at once (email "You've been added to {course}" and an in-app
notification). Others get an invitation email; they are enrolled automatically once an account with
that address proves it owns the inbox (email confirmation, password-reset link or Google sign-in).
The list shows status, who invited, last emailed; **Resend** (once a minute, at most 3 times) and
**Revoke** pending invites; CSV export. Unused invites are deleted after 180 days.

### 4.8 Waiting list ("Notify me")

**Status:** Live; the account requirement is **Pending** (PR #62).

- **Today (production):** on a Coming soon (or not yet open) course, **Notify me** adds a signed-in
  student, or a visitor by email, to the waiting list. One confirmation email; every email has a
  one-click leave link.
- **With PR #62:** joining needs an account with a confirmed email. Signed-out visitors are sent to
  register and come back to `/courses/<slug>/notify`, which adds them. Existing guest entries are kept,
  linked to an account when one proves the address, and get a "create your academy account to apply"
  email when the course opens. Leaving still works without signing in.
- **Admin** (ADMISSIONS): Admin → Courses → course → **Waiting list**: entries, CSV export, remove an
  entry, and **Notify everyone** with a message when the course opens (in-app notification for
  accounts, `waitlistOpen` email on the bulk lane; each person is told once). Notifying is refused
  unless applications are actually open (status Open, opening date reached, deadline not passed).

---

## 5. The learn page

**Status:** Live (assessment preview rules on Staging). **Who:** enrolled students; SUPER/ACADEMIC
admins can preview any course; assigned speakers can preview assessments (Staging).

`/learn/<course-slug>`, reached from the dashboard ("Continue course") or the course page:

- **Progress** bar (sessions marked done) and **Next session**.
- **Sessions**, each with: date and time in your zone, phase (upcoming, live, ended), **Join** (the
  Google Meet/YouTube link, visible from 60 minutes before), **Add to calendar**, description ("what we
  cover"), **Recording** (YouTube player or the Drive folder for paid courses), **Materials** links,
  **Assignment** link, its **Assessments**, **Mark as done** (worth points, see section 8), and
  **Feedback** (1–5 stars and a comment, once the session has started).
- **Course feedback** opens when the last session starts.
- **Reminders:** a per-course switch for the 24 h/1 h session emails, assessment due reminders and
  publish notices.
- **Announcements** from the team and from assigned speakers ("From {name}").
- **Assessments** list with how many are due, **Leaderboard**, **How to earn the certificate** card or
  the certificate banner.
- Dashboard (`/dashboard`): my courses (all, in progress, completed), next live sessions, my
  applications, points card, badges, my certificates.

Session reminder emails go 24 hours and 1 hour before each course session to enrolled students who
didn't turn reminders off.

### Feedback emails after every session

**Status:** Pending (PR "Feedback emails"). **Who:** enrolled students; the per-course opt-out link
needs no sign-in.

- **When:** from 30 minutes to 72 hours after each course session ends, at the next hourly jobs tick
  (so usually within the hour). The wide window means a late deploy still asks about a session.
- **Who is asked:** every student (role Student) who was enrolled before the session ended, whose
  account isn't deleted, and who hasn't rated that session yet. Courses that are Open, Closed or
  Completed; it goes by the session's time, not the course status.
- **What they get:** once per student and session, an in-app notification ("How was session 3?") and
  the `feedbackPrompt` email ("How was "<session>"? Rate it in 10 seconds"), in their language. The
  button opens `/learn/<course>#session-<n>-feedback`: the session's rating form, scrolled into view
  and focused. Signed out, sign-in comes first and then lands on the same form.
- **Last session:** the email asks for the session and the whole course ("Rate the course" opens
  `#course-feedback`).
- **Wording:** never "today" or "tonight" (Cairo evening sessions, other time zones, late deploys).
- **Opt-out:** every feedback email has "Stop feedback emails for this course" (and one-click
  unsubscribe headers, so mail apps show an Unsubscribe button). The link opens `/unsubscribe`, which
  works without signing in, asks for a click (mail scanners open links) and offers "Turn them back
  on". Opted-out students still get the in-app notification. Everyone is asked by default.
- **Dashboard:** a "Rate your last session" card lists, per course, the latest session that ended in
  the last 14 days and isn't rated (at most 3 courses), with a link to its form; at the last session
  it also says "rate the course too". It is computed when the page loads and disappears once rated.
- Feedback is still the 1–5 stars and optional comment of section 5; staff views of it come in a later
  PR.

---

## 6. Assessments (quizzes, labs, assignments)

**Status:** Live; English-only editor, ↑/↓ ordering, quiz upload and publish notices are **Staging**
(PR #60); speakers creating and grading are **Staging** (PR #61).

**Who:** ACADEMIC admins and assigned speakers create and grade; enrolled students take them.

### Creating

Admin → Courses → course → **Assessments** (speakers: Speaker portal → My courses → course →
Assessments):

- **New quiz / lab / assignment**, attached to a session or to the whole course (e.g. midpoint quiz,
  capstone). Fields: title, Markdown instructions, due date, **max points**, **pass mark** (%), **counts
  toward certificate**, Draft/Published, late work allowed or not. Since PR #60 the form is English only
  (Arabic text from before is kept; students see English where Arabic is empty).
- **Quiz builder:** single choice, multiple choice (all-or-nothing) and true/false; each question has a
  weight, the correct answer(s) and an explanation. Settings: attempts (0 = unlimited), best or last
  attempt counts, reveal answers (never / after the last attempt / after the due date), time limit,
  shuffle. Up to 200 questions.
- **Upload a quiz from Excel or CSV** (Staging): download the template (.xlsx or .csv) with columns
  `type, question, option1…option6, correct, weight, explanation`; `correct` accepts `2`, `1,3`, `B`,
  `A,C` or `true/false`; `type` can be guessed. The preview lists each row's problem; **Add after the
  current questions** or **Replace** only when there are no errors. Nothing is saved until **Save**.
- **Order** with ↑/↓ buttons (Staging).
- Guards: once anyone has submitted, max points, questions, weights and the key are locked (wording
  stays editable); "answers after the due date" needs late work off; a practice quiz (unlimited attempts
  with answers after each) can't count toward the certificate.

### Taking (students)

- Quiz player: one question per screen on phones, all on one page on wider screens; progress bar;
  countdown to the server's deadline that submits automatically at zero; a confirm step lists unanswered
  questions; answers survive a reload. Score screen (e.g. 15/20, 75 %, passed); answer review with
  explanations once the reveal rule allows.
- Labs and assignments, by submission type: **GitHub repo** (must be public, checked with GitHub;
  "Couldn't verify" if GitHub is unreachable), **Drive/Docs link** (drive.google.com or
  docs.google.com, with a sharing tick), **PDF** (5 MB) or **any https link**. Resubmit until the due
  date or until graded. Late work is flagged, or refused when late work is off.

### Grading and the gradebook

- **Gradebook** per assessment: filters All, To grade, Graded, Late, Missing; GitHub check result; PDF
  through a 5-minute link (audited); grade with score, feedback and rubric notes. Quizzes grade
  themselves. Rows show "by {name}" (Staging).
- **Gradebook CSV** per course: students × published assessments, total, percent and "certificate
  assessments passed".

### Emails and notices

- **Publish notice** (Staging): the first time an assessment is published, every enrolled student gets
  an in-app notification and, unless they turned the course's reminders off, the `assessmentPublished`
  email. Only for Open or Closed courses; unpublish/republish sends nothing. From PR "Feedback emails"
  (Pending) the notices are written with the publish and sent by the durable email outbox, so a restart
  or a sleeping container can't drop them; the emails carry one-click unsubscribe headers that turn the
  course's reminders off.
- **Due reminder:** 24 hours before the due date, to students who haven't submitted (once each,
  respects the opt-out).
- **Graded:** in-app notification and `assessmentGraded` email.

---

## 7. Certificates

**Status:** Live. **Who:** ACADEMIC issues; students download and share; anyone verifies.

1. Admin → Courses → course → **Certificates** → **Certificate rule**: minimum % of sessions completed
   (optional), "pass every assessment marked *counts toward certificate*", and optional wording in
   English and Arabic (otherwise generated).
2. The **roster** shows every enrolled student with sessions %, required assessments passed (and any
   waiting to be graded), average %, capstone state and an **Eligible** badge. Filters: all, eligible,
   not issued, issued, revoked.
3. Select students → **Issue** (optional grade, e.g. "Distinction"; up to 500 at once). Issuing to a
   student who doesn't meet the rule needs an explicit confirmation. Issuing twice still gives one
   certificate.
4. **Revoke** with a reason (the public page shows Revoked, the PDF stops); **Re-issue** keeps the same
   serial with a fresh snapshot of name, title and instructors.
5. CSV export. All actions audited.

Students get the `certificateIssued` email and a notification; the dashboard's **My certificates** has
**Download PDF**, **Add to LinkedIn** (prefilled with the MLOps MENA Community organisation, so the
logo shows), **View** and **Copy link**. The PDF is a bilingual landscape A4 with the logo, serial and a
QR code to the verification page. One certificate per enrolment. Issuing adds the certificate bonus
points and the **Certified** badge; revoking takes both back.

---

## 8. Points, badges and leaderboards

**Status:** Live; speakers awarding points is **Staging** (PR #61). Full rules and the proposed scheme
for the two courses are in [POINTS.md](POINTS.md).

- **Students earn points** automatically for assessments (the counted score, rounded), for marking a
  session done (5 by default) and for a certificate (50 by default); the team adds or removes points
  by hand (community help, other, correction) or by CSV import.
- **Where students see them:** dashboard points card, Profile → Points (full history, per-course
  totals, badges).
- **Leaderboards** (learn page → Leaderboard): **This week** and **Whole course**, top 10, opt-in
  ("Show me on the leaderboard", off by default), shown as first name + last initial. Weeks run in
  Cairo time from the first session's day. Students who haven't opted in see privately where they would
  rank. After the course ends the board becomes **Best of the course**.
- **Badges:** automatic *Top of the week*, *Top of the course* (ranks 1–3), *Perfect score* (100 % on a
  quiz), *Finisher* (every session marked done), *Certified*; manual *Top performer*, *Community
  helper*, *Speaker* (also automatic when a speaker's first published session ends). Badge awards send
  an in-app notification and the `badgeAwarded` email.
- **Admin** (ACADEMIC): Admin → Points & badges (badge catalog, add manual badges, activate/deactivate,
  points CSV import with a dry-run preview); Admin → Students → student → **Award or adjust points** and
  award/revoke manual badges; Admin → Courses → course → **Leaderboard** (everyone ranked, hidden ones
  marked, CSV).
- **Speakers** (Staging): My courses → course → **Points**: give or take away course points for an
  enrolled student with a reason and a note.

---

## 9. The speaker portal

**Status:** Live; one-click publish and course drafts (PR #57) and teaching assigned courses (PR #61)
are **Staging**.

**Who:** speakers (their own account), SPEAKERS admins. **Business use:** a pipeline of community
speakers who apply, book a slot and teach, with little back-and-forth for the team.

### 9.1 Apply

1. Register with **I'm a speaker** (or from `/speakers`).
2. `/speaker/apply`: full name, phone/WhatsApp, LinkedIn (required), optional GitHub, title, company,
   country, short bio, optional photo (an https link), areas, **what you offer** (Session, Course or
   Podcast), title, abstract (50–2,000 characters), format (talk, hands-on, workshop, Q&A, course,
   podcast), language, preferred months, **how did you hear about us** (with the member's name for "An
   MLOps MENA member"), and optional **details** for the kind (audience, prerequisites, outcomes, level,
   tags; for a course: modules, outline, hours per week, weeks, materials link; for a podcast: guests,
   topics, interview or panel, host).
3. The team reviews (Admin → Speakers → Applications): **Approve** creates (or links) the public speaker
   profile; **Reject** needs a note, and the speaker can edit and resend. The speaker gets the
   `speakerReviewed` email and a notification.

### 9.2 Book a slot

1. The team publishes **availability** (Admin → Speakers → Availability: add one slot, or the bulk
   generator by weekday, Cairo time, duration and months; existing times are skipped).
2. An approved speaker sees open slots by month on `/speaker` and **books** one, with its title,
   abstract, kind and details. Limits: at most 2 upcoming bookings (Settings), only slots more than 3
   days ahead (Settings), no double booking.
3. A **Session** or **Podcast** booking creates a **draft live session**; a **Course** booking creates a
   **draft course** (Staging; Live: a draft session labelled Course). The session team addresses
   (Settings → Session team emails) each get the `speakerBookingTeam` email; admins with the SPEAKERS
   preset get an in-app notification; the speaker gets `speakerBookingConfirmed` with calendar links.
4. The speaker can edit details until the session is published, and **cancel** until 3 days before
   (the slot reopens; a draft is deleted, a published session is cancelled and its registrants
   emailed; the team is emailed). Admins can **Release** any booking.
5. When the team publishes the session, the speaker gets `speakerSessionPublished` (Staging).

### 9.3 Announcements

**Status:** Live. On `/speaker` → **My courses & sessions**, a speaker messages the enrolled students
of each course they're **assigned** to, and the registrants of each published live session where they
are speaker, host or guest (until 30 days after it starts). Compose (subject, message, optional
Arabic) → **Review and send** ("Send to N people?") → **Send now**. No approval. Limits: 5 per course or
session and 20 per speaker per 24 hours; subject 120 and message 3,000 characters, plain text. Speakers
see counts only, never who. Delivered in-app, by email (bulk lane) and on the learn page as "From
{name}"; audited.

### 9.4 Course staff and the Teaching area

**Status:** Pending (the course staff PR). Replaces "assigned speakers" (PR #54, #61).

**Who:** every course has a **staff**: a Main instructor (expected, one person), optional
Co-instructors, optional Moderators (course admins), and any other role the team creates for that
course ("Teaching assistant", "Guest lecturer", …). Anyone with an academy account can be on a
course's staff (a speaker, an admin, or a student, e.g. a past top student as a moderator), and they
reach only the courses they are on.

**Roles are per course.** Admin → Courses → {course} → **Staff** (ACADEMIC or SUPER):

- **Roles:** each course starts with three editable built-in roles. *Main instructor* (every
  permission; can be renamed and changed, never deleted), *Co-instructor* (assessments, grading,
  materials, roster, attendance, points, announcements, session feedback) and *Moderator* (roster,
  attendance, points, announcements, session feedback; anonymous). Only the Main instructor manages
  automation rules by default. Add any role: an English and Arabic name, the permission checkboxes,
  **Shown** or **Anonymous**, and an order. A role can be deleted once nobody is in it.
- **People:** add an existing account by email, or pick a public speaker profile; choose the role;
  change it or remove the person later. An account's own speaker profile comes with it (the course
  page shows it); a profile without an account is shown on the page and can do nothing.
- A warning shows when nobody is in the Main instructor role.
- The course editor's **Instructors** field and Admin → Speakers → speaker → **Assigned courses** are
  shortcuts to the same staff list (the first instructor is the Main instructor, the rest
  Co-instructors), not a second list.

**Permissions** (the checkboxes):

| Group | Permission | What it opens |
|---|---|---|
| Teaching | Manage assessments | Create, edit, publish and upload quizzes and assignments |
| Teaching | Grade | Submissions, feedback, the gradebook and its CSV |
| Course material | Manage materials | Session materials, recordings, assignment links, descriptions |
| Students and attendance | See the roster | Enrolled students' name, email (Telegram and Discord once profiles have them) |
| Students and attendance | Upload attendance | Google Meet attendance files, marking by hand |
| Students and attendance | Manage points | Add, edit and remove course points (within the speaker points cap) |
| Communication | Send announcements | Messages to enrolled students, sent at once, "From" the sender |
| Communication | See session feedback | Students' feedback on each session (no screen yet: a later PR) |
| Course management | Edit the course | Course details (not status, address, type, price or who teaches) |
| Course management | Manage sessions | Dates, Meet links, the session list |
| Course management | Review applications | This course's applications: review and move them (never one's own) |
| Course management | Enrol students | Enrol by email, invites, the waiting list. On a paid course enrolling by email skips the payment, so there only staff who are also SUPER or ADMISSIONS admins can use it (others get `PAYMENT_WAIVER_ADMIN_ONLY`; the waiting list still works) |
| Course management | Issue certificates | The rule, issue, revoke, re-issue |
| Course management | Manage automation rules | Rules that act on their own in the course (no screen yet: a later PR) |

**The Teaching area** at **/teach** (linked from the dashboard and the speaker portal) lists the
courses whose staff you are on, with your role. Each course shows only the tabs your role opens:
Assessments, Gradebook, Materials, Attendance, Points, Roster, Announcements, Details, Sessions,
Applications, Enrolment, Certificates. They are the admin screens, limited to that course. The old
`/speaker/courses/…` pages redirect there.

**Public course page:** the people in Shown roles, grouped by role (Main instructor first), with the
name, title and photo of their public speaker profile, or else their account name. Anonymous staff
never appear, and no email is ever shown.

**Rules:** checked by the API on every request, from the database: SUPER and ACADEMIC admins can do
everything in every course; anyone else needs a staff row in that course whose role has the
permission, and the course must not be archived. An id from another course is "not found". Every
change is in the audit log with the person's name. Limits as before: 30 writes a minute, 60 grading
actions a minute, 30 new assessments per 24 hours, 5 announcements per course and 20 in total per
24 hours per person.

---

## 10. Live sessions (admin side)

**Status:** Live; the publish banner, filters and speaker notice are **Staging** (PR #57).
**Who:** ACADEMIC.

1. Admin → Sessions → **New session** (or open a speaker's draft). Fields: slug, English and Arabic
   title and description (Markdown), speaker (a profile) and optional hosts/guests, text overrides,
   topics, category (hands-on, industry, talk, course recording), start time, duration, language,
   platform (Google Meet or YouTube Live), the **live link**, capacity (empty = unlimited), cover
   (upload, Staging), recording link, kind and details.
2. **Publish:** the draft banner lists what's missing (Arabic title, live link) and **Publish** saves
   and publishes in one step (Staging). The public list updates within about 2 minutes.
3. **Registrations:** Admin → Sessions → session → Registrations: list and CSV.
4. Changing the time emails registrants (`eventRescheduled`); cancelling emails them
   (`eventCancelled`).
5. After the session, add the **recording link**; it shows on the session page and in the recordings
   library.

Sessions list filters: All / Drafts / Published / Cancelled, with badges for speaker bookings and
podcasts (Staging).

---

## 11. The admin panel

`/admin`. Each admin sees only the sections their presets allow (Staging; Live: everything) and opens
on their first section. The sections:

| Section | Presets | What it does |
|---|---|---|
| Dashboard | ADMISSIONS, ACADEMIC, FINANCE | Funnel (course views → apply clicks → registered → profile completed → submitted → shortlisted → payment submitted → enrolled) and key counts |
| Payments | FINANCE | Review proofs, approve or reject (4.5) |
| Applications | ADMISSIONS | Review, bulk actions, notes, CSV, saved views (4.3) |
| Students | ADMISSIONS | Search and filter students; profile, CV, applications, notes; **Edit profile** step by step; **Add student**; **Delete account**; switch to speaker. ACADEMIC also needed for the points box |
| Points & badges | ACADEMIC | Badge catalog and points CSV import (8) |
| Courses | ACADEMIC (edit), ADMISSIONS (read) | New course, duplicate, edit, archive/delete; tabs below |
| Sessions | ACADEMIC | Free live sessions (10) |
| Speakers | SPEAKERS | Profiles (photo, bio, LinkedIn, assigned courses), Applications, Availability and bookings (9) |
| Media | CONTENT | Staging. Upload images and set course and session covers, speaker photos, recording and playlist links; no student data |
| Team | SUPER | Staging. Admins and their presets ([ADMIN-ROLES.md](ADMIN-ROLES.md)) |
| Settings | SUPER | Payment details, support email and WhatsApp, live link window (60 min), retention days (180), session points (5), certificate points (50), session team emails, speaker booking limit (2) and cancel window (3 days) |
| Audit | SUPER | Every admin action with who, when and ids (filterable) |

**Course tabs** (Admin → Courses → course): Details (ACADEMIC), Questions (ACADEMIC), Applications
(ADMISSIONS), Sessions (ACADEMIC; add, bulk add, reorder), Assessments (ACADEMIC), Leaderboard
(ACADEMIC), Enrolled students (ADMISSIONS, ACADEMIC; Drive access, learn page access), Enrol by email
(ADMISSIONS), Certificates (ACADEMIC), Announcements (ACADEMIC: message students by application
status, in-app and email, with delivery counts), Waiting list (ADMISSIONS), Feedback (ACADEMIC).

**Image uploads** (Staging): **Upload image** next to course cover, live session cover, speaker photo
fields: JPG, PNG or WebP up to 5 MB, served publicly at `/api/media/<id>` and cached for a year. To take
one down, delete it from storage and purge the URL in Cloudflare.

---

## 12. Emails and notifications

Sent from `MLOps MENA Academy <academy@mlopsmena.com>` through Resend, in the recipient's language.
**Transactional** mail always goes before **bulk** mail. Staging never emails real people (section 14).

| Email | When | Lane |
|---|---|---|
| verifyEmail | Registration, resend | Transactional |
| resetPassword | Forgot password | Transactional |
| accountCreated | Team created your account (student or admin); set-password link, 7 days | Transactional |
| securityNotice | Password changed | Transactional |
| accountDeleted | Account deleted (by you or the team) | Transactional |
| applicationStatus | Application received and every status change | Transactional |
| courseAdded | Enrolled by email | Transactional |
| courseInvite | Invited by email (no verified account yet) | Transactional |
| sessionReminder | 24 h and 1 h before each course session | Bulk |
| eventRegistered | Registered for a live session (once per person and session) | Transactional |
| eventReminder | 24 h and 1 h before a live session | Bulk |
| eventRescheduled / eventCancelled | Live session time changed / cancelled | Bulk |
| announcement | Team or speaker announcement | Bulk |
| assessmentPublished | First publish of an assessment (Staging; through the outbox from "Feedback emails") | Bulk |
| feedbackPrompt | 30 min–72 h after each course session, once per student; combined with the course rating at the last session (Pending) | Bulk |
| assessmentDue | 24 h before due, not yet submitted | Bulk |
| assessmentGraded | Work graded | Bulk |
| badgeAwarded | Badge awarded | Bulk |
| certificateIssued | Certificate issued | Bulk |
| waitlistJoined / waitlistOpen | Joined the waiting list / the course opened | Bulk |
| waitlistOpenGuest | Course opened, guest entry without an account (Pending, #62) | Bulk |
| speakerReviewed | Speaker application approved or rejected | Transactional |
| speakerBookingConfirmed | Speaker booked a slot | Transactional |
| speakerBookingTeam | Booking or cancellation, to each session team address | Bulk |
| speakerSessionPublished | The team published the speaker's session (Staging) | Transactional |
| adminAlert | Drive access to remove, and similar team alerts | Transactional |
| profileReview | Profile untouched for ~6 months | Transactional |

In-app notifications accompany most of these (see 3.7). Students turn off course reminders per course
on the learn page; marketing emails are opt-in. Feedback emails have their own per-course "stop" link
that works without signing in (section 5).

Feedback prompts and assessment publish notices go through the **durable outbox** (Pending): each
email is a database row, sent in the background with retries, so a restart doesn't lose it and the
same email is never sent twice.

---

## 13. Privacy and data

**Status:** Live. Summary of what the privacy policy promises and the code enforces:

- **Telegram and Discord usernames** are shown to the academy team only (never on public pages or
  leaderboards); they are in the data export and removed with the profile on anonymisation.
- **Data minimisation:** leaderboards show first name + last initial and only for students who opt in;
  speakers see counts, never recipients; certificates show the name the student gave.
- **Private files** (CVs, payment screenshots, assessment PDFs, certificate PDFs) are in a private
  bucket under random names, opened only through 5-minute links; views are audited.
- **Retention:** CVs, payment screenshots and assessment files are deleted after 180 days (Settings);
  unused invites after 180 days; deleted accounts anonymised after 30 days; daily database backups kept
  30 days (data from a deleted account can survive in them that long).
- **Rights:** download your data, delete your account (3.6); admins can turn consents off, never on.
- **No tracking cookies:** only strictly necessary cookies; optional analytics are cookieless.
- **Logs** contain no personal data (route patterns, not URLs); error reports strip user data.
- **Audit log** records every admin action with ids only.
- Egypt's PDPL (Law 151/2020) governs incidents: 72 hours to notify (see OPERATIONS.md).

---

## 14. Staging vs production

| | Production | Staging |
|---|---|---|
| URL | academy.mlopsmena.com | academy-staging.mlopsmena.com |
| Who uses it | Students, speakers, the team | The team and testers, before each release |
| Data | Real | Separate database and storage; test data only |
| Email | Real recipients | Everyone not on the allowlist is redirected to one team inbox, with the original recipient in the subject |
| Search engines | Indexed | `noindex`, `robots.txt` disallows everything |
| Scheduled jobs | Hourly (reminders, retention, points, anonymisation) | None by default; run by hand when testing |
| Version now | `v2026.10.11-2` (PRs up to #55) | `v2026.10.12-2` (PRs up to #61) |

New features always reach staging first. Test on staging, then promote the same tag to production.

---

## Changelog

One entry per pull request in the academy repository. Newest first.

| PR | Change | Status |
|---|---|---|
| Accounts audit | Telegram and Discord usernames (required to apply; banner for existing students; shown to admins). Audit fixes: reset-email limits, translated validation errors, social cards and 404 titles, re-opened verify links, sessions replaced at sign-in, deleted-address message, deleted-account confirmation, notification panel errors, Worker internal-route check; privacy policy updated (usernames, assessments, attendance, certificates) | Pending |
| Enrolled count | Course pages and cards show "N students enrolled" and "X seats left" / "Course full" (en/ar); per-course "Show enrolled count publicly" switch (on by default); enrolments and withdrawals refresh the public pages within seconds; public API `enrolledCount` and `seatsLeft` | Pending |
| Course staff | Course staff: per-course roles (Main instructor, Co-instructor, Moderator, custom) with permissions, Shown or Anonymous; Admin → Courses → Staff tab; Teaching area at /teach for any account; public course page shows staff by role | Pending |
| Feedback emails | "How was the session?" email and notification after every course session (course rating at the last one), per-course opt-out link without sign-in, "Rate your last session" dashboard card, links straight to the rating form; durable email outbox (publish notices moved onto it) | Pending |
| Admissions audit | Students can withdraw an application (Withdrawn status); deleting an account frees its seats and closes a pending payment; full courses say so before applying; Apply closes at the deadline; payments queue pages; Arabic digits in payment proofs; "seat confirmed" email; waiting list only notified while applications are open; admin accounts out of Admin → Students | Pending |
| #62 | The waiting list needs an academy account with a confirmed email; guest entries kept and linked; `waitlistOpenGuest` email; audit of public routes; funnel browser id tightened | Pending |
| #61 | Speakers teach their assigned courses: assessments, grading, gradebook, points, materials; assessment preview limited to SUPER/ACADEMIC and assigned speakers; "Last edited by" | Staging |
| #60 | Assessments: English-only editor, ↑/↓ ordering, quiz upload from Excel/CSV, publish notices; "Learn page access" column | Staging |
| #59 | Admin permission presets (SUPER, ACADEMIC, CONTENT, ADMISSIONS, SPEAKERS, FINANCE), Admin → Team, Admin → Media and image uploads | Staging |
| #58 | Session editor hint for course bookings; missing "not found" message | Staging |
| #57 | One-click publish for draft sessions, session filters, speaker notified on publish; course bookings become draft courses | Staging |
| #56 | Test-only: speaker announcement e2e fix | Staging |
| #55 | Test-only: "how did you hear about us" in the speaker announcement test | Live |
| #54 | Assign speakers to courses; speaker announcements to students and session registrants | Live |
| #53 | Speaker form: GitHub, how did you hear, Course/Podcast kinds and details; hiring questions removed; admins edit student profiles, add and delete students; booking error handling | Live |
| #52 | CI: releases reuse the merged PR's test run | Live |
| #51 | Enrol by email (direct enrolment and invites, auto-enrol on sign-up) | Live |
| #50 | CI: pull requests only, drafts and docs skip CI | Live |
| #49 | Points follow-ups: launch guard for leaderboard awards, anonymised accounts stay clean, repeat CSV import guard | Live |
| #48 | Certificates: rule, issue, revoke, re-issue, public verification, PDF, LinkedIn | Live |
| #47 | Points, badges and course leaderboards (weekly and whole-course) | Live |
| #46 | Assessments: quizzes with weighted auto-grading, labs and assignments, gradebook, due reminders | Live |
| #45 | Speaker portal: sign-up, application, availability slots and booking | Live |
| #44 | Fix: browsers kept edge-cached pages for 4 hours | Live |
| #43 | Fix: learning-path stepper keyboard scrolling (accessibility) | Live |
| #42 | Follow-ups to #41: show login email, tab fix, verification tidy-up | Live |
| #41 | Self-service email change removed; CVs shown in applications; course Applications tab | Live |
| #40 | Speaker photos, bios and spelling fixes | Live |
| #39 | API under load: edge-cached public API, database pool, fast restarts, less polling | Live |
| #38 | Open-source roadmaps from mlopsmena.com; "learning paths" naming | Live |
| #37 | Instructor LinkedIn, course levels and language fixes, video categories | Live |
| #36 | Simpler profile: LinkedIn and GitHub only, highest degree only, skills optional | Live |
| #35 | Light redesign: mega-menu header, learning paths, dashboard, player | Live |
| #34 | QA fixes: course filters, funnel, plurals, past sessions, Kubernetes course content | Live |
| #33 | Production scaled to the smallest setup ($5 Workers plan) | Live |
| #32 | QA fixes: form accessibility, onboarding validation, CV access, apply domain field | Live |
| #31 | QA fixes: staging noindex, page titles, favicon and OG image, CSP, HSTS | Live |
| #30 | "Will be announced soon" for unknown course details | Live |
| #29 | Speed: static/ISR public pages, edge cache | Live |
| #28 | Waiting list for upcoming courses; placeholder buttons fixed | Live |
| #27 | Profile follow-ups | Live |
| #26 | Profile: LinkedIn, GitHub and community answers required | Live |
| #25 | Archive follow-ups | Live |
| #24 | Archive: past courses, session recordings library and speaker pages | Live |
| #23 | Staging: testers receive their own email (allowlist) | Live |
| #22 | Release process: staging guards and setup-script fixes | Live |
| #21 | Closed without merging (superseded by #22) | — |
| #20 | Release process: tag → staging → production | Live |
| #19 | Fix: course page accessibility check | Live |
| #18 | Calendar sync: private subscription feed for Google, Apple and Outlook | Live |
| #17 | Free live sessions with registration, reminders and admin | Live |
| #16 | Calm redesign: logo colours, IBM Plex, mobile-first | Live |
| #15 | Required profile steps, course delete/archive, better application emails | Live |
| #14 | Go-live readiness: announcements, hostname switch, complete policies | Live |
| #13 | Launch content: AI Architecture Design, Kubernetes "Coming soon" status | Live |
| #12 | Hardening, browser tests, backups and operations docs | Live |
| #11 | Admin panel | Live |
| #10 | Course content: learn page, sessions, materials, recordings | Live |
| #9 | Payments (InstaPay, Vodafone Cash, manual review) | Live |
| #8 | Deploy to Cloudflare (Worker and Containers) | Live |
| #7 | Applications review fixes | Live |
| #6 | Applications and the application state machine | Live |
| #5 | Security fixes from the auth review | Live |
| #4 | Public catalog | Live |
| #3 | Auth and profile | Live |
| #2 | Foundation review fixes | Live |
| #1 | Foundation: monorepo, API, web, database | Live |
| — | This guide, ENGINEERING.md, ADMIN-ROLES.md, POINTS.md and the PR template | Docs |

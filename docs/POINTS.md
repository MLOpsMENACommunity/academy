# Points, badges and leaderboards

Part 1 describes the rules **exactly as the code implements them today** (`apps/api/src/points/*`,
`packages/shared/src/points.ts`, `apps/api/src/assessments/*`, `apps/api/src/certificates/*`). Part 2
is a **proposal**, for the owner to approve, of concrete values for the AI Architecture Design and
Kubernetes courses. User-facing behaviour is summarised in [FEATURES.md](FEATURES.md#8-points-badges-and-leaderboards).

Status: points, badges and leaderboards are **live** (PRs #47, #48, #49). Speakers awarding course
points is on **staging** (PR #61). The attendance upload described in Part 2 is **not built yet**.

---

## Part 1. The current rules

### 1.1 The ledger

Points are an **append-only ledger** (`PointsEntry`): every change is a new row, never an edit. A
student's total is the sum of their rows; a course total is the sum of rows tagged with that course.
Corrections are new rows with negative points, so every number can be explained line by line in
Profile → Points.

| Reason (`PointsReason`) | Source | Points |
|---|---|---|
| `ASSESSMENT` | Automatic, per assessment | The counted score, rounded to whole points |
| `SESSION_COMPLETED` | Automatic, per course session | `sessionCompletedPoints` (Settings, default **5**) |
| `CERTIFICATE` | Automatic, per certificate | `certificatePoints` (Settings, default **50**) |
| `MANUAL_COMMUNITY` | By hand: "Community help" | Any whole number −10,000…10,000 except 0 |
| `MANUAL_OTHER` | By hand: "Other" | Same |
| `ADJUSTMENT` | By hand: "Correction" | Same |

Automatic entries are idempotent: each has a source (`ASSESSMENT`/`SESSION`/`CERTIFICATE` + id) and a
sequence number, unique per student. A sync computes the target, compares it with what the ledger
already holds for that source, and appends only the difference. Running a sync twice, or two syncs at
the same moment, never double-counts.

### 1.2 Assessments

- Points = the assessment's **counted score**: the best or the last graded attempt, per the
  assessment's scoring rule, rounded (`Math.round`). So **an assessment's `maxPoints` is its weight in
  points**: a quiz with max points 20 is worth up to 20 points; the default max points is 100.
- **0 while the assessment is unpublished.** Publishing, unpublishing and switching between best and
  last attempt re-sync everyone's points.
- A better attempt or a regrade appends the difference (12 → 17.6 → 9 gives +12, +6, −9).
- **Late work earns the same points as on-time work** today (it is flagged in the gradebook, or refused
  when the assessment doesn't accept late work).
- Labs and assignments earn points once graded; quizzes when submitted (auto-graded).
- An hourly safety net re-syncs work changed in the last 26 hours.

### 1.3 Sessions

- **Retired (PR "Attendance only"):** students no longer click **Mark as done**; the endpoint answers
  410. Session points already given (`SESSION_COMPLETED`, 5 each) are kept.
- Sessions now count from **attendance** (the Google Meet file, or the team marking students, one or
  many at once): **Present or Partial** counts as attended for the learn-page progress, the
  certificate's "sessions completed %" and the **Finisher** badge. Attendance points follow each
  course's rule (`ATTENDANCE`, see guides/ATTENDANCE.md).

### 1.4 Certificate bonus

Issuing a certificate adds `certificatePoints` (50) tagged with the course, and the **Certified**
badge; revoking takes both back; re-issuing doesn't add a second bonus. A failure here never undoes the
certificate.

### 1.5 Manual points and who can award

| Who | Where | What |
|---|---|---|
| ACADEMIC admin (and SUPER) | Admin → Students → student → **Award or adjust points** | ± points, type (Community help, Other, Correction), optional course, required note (≤ 500 characters). The student page itself needs ADMISSIONS (see [ADMIN-ROLES.md](ADMIN-ROLES.md#known-gaps)) |
| ACADEMIC admin (and SUPER) | Admin → Points & badges → **Import CSV** | Many students at once (below) |
| Assigned speaker (staging) | Speaker portal → My courses → course → **Points** | ± course points for an enrolled student, with a reason and a note; always tagged with that course |

Manual entries are audited (`points.awarded`, `points.imported`); positive awards send the student an
in-app notification ("+N points"). Nothing is ever edited or deleted: to take points back, add a
negative entry with type **Correction**.

**CSV import:** columns `email, points, note, course` (header required, any order; `course` is the
course slug, optional). Up to 2,000 rows. Points are whole numbers −10,000…10,000, not 0. **Preview**
(dry run) checks every row ("Not a valid email", "No student with this email", unknown course);
**Apply** is refused while any row has an error. The same file twice is refused unless the admin ticks
"Import again anyway". Rows without a course count toward the student's overall total only, not any
course board.

### 1.6 Badges

| Badge | Kind | How it is earned | Scope |
|---|---|---|---|
| 🏅 Top of the week | Auto | Ranks 1–3 of a closed course week (ties share a rank, so more than 3 can win) | Per course week |
| 🏆 Top of the course | Auto | Ranks 1–3 once the course has ended | Per course |
| 💯 Perfect score | Auto | 100 % on a published quiz (any attempt); kept after a regrade | Once per course |
| 🏁 Finisher | Auto | Attended (Present or Partial) every session of the course | Once per course |
| 🎓 Certified | Auto | A certificate issued (removed on revoke) | Per course |
| ⭐ Top performer | Manual | Awarded by the team | Once per course, or once overall |
| 🤝 Community helper | Manual | Awarded by the team | Once per course, or once overall |
| 🎤 Speaker | Manual + auto | Automatic when a speaker account's published live session ends (within 2 days); or by hand | Overall |

- Top-3 badges go to the best students **whether or not they opted in** to the public board; a badge
  is private (dashboard, notification, email) unless the student opts in.
- Weeks and courses are awarded once, within 14 days of closing, and never re-ranked; nothing that
  started before points launched (`pointsLaunchedAt`) is ranked.
- Automatic badges can't be revoked by hand (the job would give them back): correct the points.
- Admins (ACADEMIC) add manual badges and (de)activate any badge in Admin → Points & badges, and award
  or revoke manual badges on the student page. Every award sends an in-app notification and an email.

### 1.7 Leaderboards

- **Two boards per course** on the learn page: **This week** (with a picker for past weeks) and **Whole
  course**; top 10 shown. After the course ends, the course board is labelled **Best of the course**.
- **Opt-in**, off by default ("Show me on the leaderboard"); names appear as first name + last initial.
  Non-participants are counted ("6 of 8 students take part") and see privately where they would rank.
- **Course weeks** run in **Cairo time**: week 1 starts at local midnight of the first session's day
  (lowest session order), each next week 7 calendar days later (a week spanning a DST change is 167 or
  169 hours). Points before week 1 count only for the whole-course board.
- A week's points are entries created in that week for that course; a regrade lands in the week it
  happened.
- **Course end** = the end of the course's **End date** (Cairo), or, with no end date, **7 days after
  the last session starts**.
- **Ranking:** most points first; ties share a rank (1, 1, 3) and are listed by who reached the total
  first; students with no positive points aren't ranked.
- Admin → Courses → course → **Leaderboard** (ACADEMIC) shows everyone enrolled, ranked, with hidden
  students marked, a week picker and CSV export.

---

## Part 2. Proposal: recommended scheme for the AI Architecture Design course and the Kubernetes course

> **This is a proposal for the owner to approve.** Nothing here is configured yet. Items marked
> **(today)** can be set up with what the academy already does; items marked **(needs a change)** need
> a small code change or the attendance feature before they work automatically.

### 2.1 Principles

1. **Points reward learning activity, not luck or seniority.** Most points come from showing up and
   doing the work on time; quality matters through quiz and capstone scores, but a beginner who does
   everything should beat a senior who skips half.
2. **Simple enough to explain in one slide.** A handful of round numbers, the same in both courses.
3. **No penalties for absence.** Missing something means not earning its points, never losing points.
   Negative entries are only corrections.
4. **Certificates stay separate.** Eligibility for a certificate is the course's certificate rule
   (sessions, required assessments, capstone score). It never depends on points or rank, so the
   leaderboard is a motivation tool, not a gate.
5. **Fair across time zones and devices.** Live attendance is rewarded most, but a student who can't
   attend live still earns points by watching the recording and doing the work.

### 2.2 The two courses as they are in the repository

**AI Architecture Design** (`ai-architecture-design`; seed `apps/api/prisma/seed-data.ts`): free,
Open, taught in Arabic, Mid → Senior, ~5 hours/week. **6 live sessions**, Sundays 19:00–20:30 Cairo
(90 minutes): 18 Oct, 25 Oct, 1 Nov, 15 Nov, 22 Nov, 29 Nov 2026. A **break week 8–14 Nov** with a
**Midpoint Quiz** on sessions 1–3 and the **first half of the capstone** due Saturday 14 Nov. A **short
quiz after every session** (required), an **optional assignment** after each session (each becomes a
capstone section), and a **capstone** (architecture document, C4 diagrams, ADRs, cost estimate, threat
model, evaluation and monitoring plan) due **Sunday 13 Dec 2026**, passing at **70/100**, with **bonus
points for a small proof of concept**. Certificate: all 6 session quizzes, the midpoint quiz, and the
capstone at 70/100 or more. Study groups run on Telegram.

Course weeks (Cairo): W1 18–24 Oct (S1), W2 25–31 Oct (S2), W3 1–7 Nov (S3), W4 8–14 Nov (break,
midpoint), W5 15–21 Nov (S4), W6 22–28 Nov (S5), W7 29 Nov–5 Dec (S6), W8 6–12 Dec (capstone),
W9 13–19 Dec (capstone due 13 Dec).

**Kubernetes Mastery** (`kubernetes`): paid, **Coming soon**, Junior → Mid. Dates, duration, schedule,
language and certificate are **not decided** (the seed has no sessions). The syllabus has **23
sections** (fundamentals → architecture → … → AI infrastructure → final recap), **9 hands-on labs**
(application lifecycle; networking, Ingress and Gateway API; persistent storage on EBS; scheduling
control; RBAC least privilege; security hardening; troubleshooting drill; cluster maintenance; GPU lab)
and **2 capstone projects on AWS** (WordPress + MySQL; self-managed MongoDB + Mongo Express). The GPU lab
needs optional GPU access.

### 2.3 Point values

| Activity | AI Architecture Design | Kubernetes | How it's recorded |
|---|---|---|---|
| **Live attendance** (per live session, present for at least half of it) | **10** | **10** | Attendance CSV from the Google Meet attendance tracker **(needs the attendance feature)**; until then, the points CSV import **(today)** |
| **Session done** (Mark as done: attended or watched the recording) | **5** (keep the default) | **5** | Existing "Mark as done" **(today)** |
| **Session quiz**, full score | **20** each (set max points 20) | **10** per quiz, one quiz per 2–3 syllabus sections (set max points 10) | Quiz score = points **(today)** |
| **Midpoint quiz**, full score | **40** (max points 40) | — | **(today)** |
| **Assignment** (optional), full score | **15** each (max points 15) | — | **(today)** |
| **Lab**, full score | — | **25** each for the 8 core labs (max points 25) | Graded lab **(today)** |
| **GPU lab** (optional) | — | **25** bonus (max points 25, not counting toward the certificate) | **(today)** |
| **Capstone**, full score | **100** (max points 100, pass 70 %) | **75** per capstone, two capstones (max points 75 each, pass 70 %) | **(today)** |
| **Proof-of-concept bonus** | up to **+20** | — | Manual, type Other, tagged to the course **(today)** |
| **Late work** (after the due date, when accepted) | **half** the points | **half** | **(needs a change)**; until then late work earns full points |
| **Perfect quiz** (100 % on the first attempt) | **+5** bonus | **+5** | **(needs a change)**; the Perfect score badge already exists |
| **Attendance streak** | **+10** once for 3 live sessions in a row; **+25** once for all 6 | **+10** for 3 in a row; **+25** for at least 90 % of live sessions | **(needs the attendance feature)**; manual meanwhile |
| **Community help** (a helpful answer, review or resource in the Telegram/WhatsApp groups) | **+5** each, at most **10 a week** and **50 per course** | same | Manual, type Community help, tagged to the course **(today)** |
| **Certificate bonus** | set `certificatePoints` to **0** | **0** | Setting **(today)** |
| **Penalties** | none; only corrections (e.g. plagiarised work regraded to 0) | none | Correction entry or regrade **(today)** |

Why these numbers:

- **Attendance 10 + done 5.** Live attendance gets twice the points of watching the recording, so
  showing up matters, but a student in another time zone who watches every recording still earns a
  third of the session points. Live attendees also mark the session done, so attending = 15.
- **Quizzes 20, midpoint 40, assignments 15, capstone 100** (AI Architecture). The quizzes are short and
  required, so together they (120) are worth about as much as the capstone (100). The capstone is
  already promised to students as a score out of 100, so its max points stay 100 and its pass mark 70 %
  matches the certificate rule. Optional assignments (90 in total) reward the students who build their
  capstone section by section.
- **Labs 25, capstones 75 each, quizzes 10** (Kubernetes). It is a hands-on course: labs (200 for the
  core eight) and capstones (150) carry most of the points, quizzes keep the theory honest.
- **Late = half.** Rewards on-time work without blocking certificates (the AI Architecture certificate
  needs every quiz, so late quizzes must still be accepted).
- **Community capped.** Helping others is valuable, but uncapped manual points would let a few very
  active chat members dominate the board and depend on who happens to notice; the cap keeps it at about
  10 % of a strong total.
- **Certificate bonus 0.** Every certified student would get the same 50, and certificates are issued
  after grading, often after the board closes; it adds nothing to the ranking and blurs the line
  between certificate and leaderboard. The **Certified** badge still shows the achievement. (The
  setting is global; there are no other courses with certificates today.)

### 2.4 Badge thresholds

| Badge | Rule |
|---|---|
| 🏅 Top of the week / 🏆 Top of the course | Keep the automatic top 3 |
| 💯 Perfect score, 🏁 Finisher, 🎓 Certified | Keep as they are |
| 🤝 Community helper | Awarded by the team at the end of the course to students with **at least 30 community points** in it |
| ⭐ Top performer | Awarded at the end of the course to students with **at least 85 % of the course's core points** (everything except community help and bonuses), whatever their rank |
| 📅 Always there (new manual badge) | Attended **every** live session (AI Architecture: 6 of 6; Kubernetes: at least 90 %) |

Create "Always there" in Admin → Points & badges → Add badge (manual).

### 2.5 Sample week and sample totals

**A strong week in AI Architecture Design (week 2, Session 2):**

| Item | Points |
|---|---|
| Attended Session 2 live | 10 |
| Marked it done | 5 |
| Session 2 quiz, 18/20, on time | 18 |
| Optional assignment, 13/15 | 13 |
| Two helpful answers in the study group | 10 |
| **Week total** | **56** |

**Whole course, AI Architecture Design:**

| Item | Maximum | A committed student |
|---|---|---|
| Attendance (6 × 10) | 60 | 50 (5 of 6 live) |
| Sessions done (6 × 5) | 30 | 30 |
| Session quizzes (6 × 20) | 120 | 96 (80 % average) |
| Midpoint quiz | 40 | 30 |
| Assignments (6 × 15) | 90 | 36 (3 of 6) |
| Capstone | 100 | 80 |
| Proof-of-concept bonus | 20 | 0 |
| Perfect quiz bonus (7 × 5) | 35 | 5 |
| Streak bonuses | 35 | 10 |
| Community help | 50 | 15 |
| **Total** | **580** | **352** |

The core points (without community help and bonuses) are 440 at most, so "Top performer" (85 %) needs
374 core points.

**Kubernetes (assuming 12 weekly live sessions and 10 section quizzes; adjust once the schedule is
set):** attendance 120 + sessions done 60 + quizzes 100 + core labs 200 + capstones 150 = **630 core
points**, plus up to 25 (GPU lab), 50 in perfect-quiz bonuses (10 × 5), 35 in streak bonuses and 50 for community help.

### 2.6 How certificates relate

The certificate is decided by each course's **certificate rule** (Admin → Courses → course →
Certificates), never by points:

- **AI Architecture Design:** mark the 6 session quizzes, the midpoint quiz and the capstone as
  "counts toward certificate", with pass marks of 70 % (capstone) and the team's choice for quizzes;
  "pass every required assessment" on; sessions minimum optional.
- **Kubernetes (proposal):** the 8 core labs and both capstones count toward the certificate (70 %),
  and at least 75 % of sessions done.

A student can top the leaderboard without a certificate, or earn a certificate without ever opting in
to the leaderboard. That is intended.

### 2.7 Setting it up

**Before the AI Architecture course's first session (18 Oct):**

1. Admin → Courses → AI Architecture Design → **Details**: set **End date** to **Sunday 20 Dec 2026**.
   Without it the course "ends" 7 days after the last session (6 Dec), *before* the capstone is due on
   13 Dec, so **Top of the course** would be awarded before capstones count. 20 Dec leaves a week to
   grade. Grade capstones before then: the course board is awarded once and never re-ranked.
2. Create the assessments with the max points above (session quizzes 20, midpoint 40, assignments 15,
   capstone 100) and their due dates.
3. Admin → Settings: keep **Session points** at 5; set **Certificate points** to 0.
4. Add the "Always there" badge.
5. Tell students in the first announcement how points work and that the leaderboard is opt-in.

**During the course:** after each live session, upload attendance (the coming attendance feature, or
meanwhile a points CSV: `email, points, note, course` with `10`, `Attended session N`,
`ai-architecture-design`); award community points weekly with type Community help; at the end, award
Community helper, Top performer and Always there by hand.

### 2.8 Notes for the attendance feature

The coming attendance upload (a CSV from the Google Meet attendance tracker, with points for
attending; ACADEMIC admins and assigned speakers can award, edit and remove the points) should:

- **Match students by their Google email as well as their login email.** Meet reports the Google
  account; the academy stores it as the profile's Google email, which often differs from the login
  email. Unmatched rows should be listed, not dropped silently.
- **Use the ledger, not edits:** one automatic source per student and session (like `SESSION`), so
  re-uploading a corrected file appends only the difference and removing attendance appends a negative
  entry. "Edit" and "remove" in the UI become new ledger rows, keeping the history explainable.
- **Apply a minimum duration** (proposed: half the session) from the tracker's join/leave times.
- Optionally mark the session done for attendees, so the certificate's sessions % and Finisher follow.
- Compute streak bonuses from the attendance rows.

# Course staff: roles and permissions

A short guide for the owner and academic admins: give instructors, teaching assistants and
moderators access to the courses they work on, and nothing else. The full reference is
[FEATURES.md, section 9.4](../FEATURES.md#94-course-staff-and-the-teaching-area); admin presets (who runs
the whole academy) are in [ADMIN-ROLES.md](../ADMIN-ROLES.md).

> Screenshots are optional in this guide; the names in **bold** are the labels you see in the academy.

## Two kinds of access

| | Admin presets | Course staff |
|---|---|---|
| Scope | The whole academy | One course at a time |
| Set in | Admin → **Team** (SUPER only) | Admin → Courses → {course} → **Staff** (ACADEMIC or SUPER) |
| Works in | `/admin` | **Teaching** (`/teach`) |
| Who | Academy staff accounts | Any academy account: a speaker, an admin, or a student (e.g. a past top student as a moderator) |

SUPER and ACADEMIC admins can do everything in every course already; course staff is for everyone
else.

## Roles

Every course starts with three built-in roles, which you can edit:

| Role | Default permissions | Shown on the course page |
|---|---|---|
| **Main instructor** | Every permission. Can be renamed and changed, never deleted. One person is expected | Yes |
| **Co-instructor** | Manage assessments, Grade, Manage materials, See the roster, Upload attendance, Manage points, Send announcements, See session feedback | Yes |
| **Moderator** | See the roster, Upload attendance, Manage points, Send announcements, See session feedback | No (Anonymous) |

Add any other role ("Teaching assistant", "Guest lecturer"): an English and Arabic name, the
permission checkboxes, **Shown** or **Anonymous**, and an order. A role can be deleted once nobody is in
it. Anonymous staff never appear publicly; no staff email is ever shown.

## Permissions

| Permission | Opens in Teaching |
|---|---|
| Manage assessments | Create, edit, publish, upload and import quizzes, labs and assignments ([QUIZZES.md](QUIZZES.md)) |
| Grade | Submissions, feedback, the gradebook and its CSV |
| Manage materials | Session materials, recordings, assignment links, descriptions |
| See the roster | Enrolled students' names and emails (and Telegram and Discord usernames) |
| Upload attendance | Google Meet attendance files and marking by hand ([ATTENDANCE.md](ATTENDANCE.md)) |
| Manage points | Add, edit and remove course points (within the speaker points cap) |
| Send announcements | Messages to enrolled students, "From" the sender |
| See session feedback | Students' session feedback (screen to come) |
| Edit the course | Course details (not status, address, type, price or who teaches) |
| Manage sessions | Dates, Meet links, the session list |
| Review applications | This course's applications (never one's own) |
| Enrol students | Enrol by email, invites, the waiting list. On a paid course, enrolling by email skips the payment, so only staff who are also SUPER or ADMISSIONS admins can use it there |
| Issue certificates | The certificate rule, issue, revoke, re-issue |
| Manage automation rules | Rules that act on their own (screen to come) |

## Add someone to a course

1. Admin → Courses → {course} → **Staff**.
2. Under people, add an existing account **by email**, or pick a public speaker profile.
3. Choose the role. Change it or remove the person at any time.
4. They open **Teaching** (`/teach`, linked from their dashboard and the speaker portal), pick the
   course, and see only the tabs their role opens: Assessments, Gradebook, Materials, Attendance,
   Points, Roster, Announcements, Details, Sessions, Applications, Enrolment, Certificates.

The course editor's **Instructors** field and Admin → Speakers → speaker → **Assigned courses** edit the
same staff list (the first instructor is the Main instructor, the others Co-instructors). A warning
shows when nobody is the Main instructor.

## Rules and limits

- The API checks the permission on every request, from the database: a removed person or a changed
  role takes effect at once. Archived courses are closed to staff.
- An id from another course is "not found"; staff never see other courses.
- Every change staff make is in the audit log with their name.
- Limits per person: 30 writes a minute, 60 grading actions a minute, 30 new assessments per 24 hours
  (a quiz import counts each new quiz), 5 announcements per course and 20 in total per 24 hours.

## Common setups

| Situation | Role |
|---|---|
| The lead instructor | Main instructor |
| A second instructor who writes quizzes and grades | Co-instructor |
| A teaching assistant who only grades | New role with **Grade** (and **See the roster**) |
| A community moderator who takes attendance | Moderator |
| A guest speaker for one session, shown on the page, with no access | A Shown role with no permissions |

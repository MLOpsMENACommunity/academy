# Uploading Google Meet attendance

A short guide for academic admins and course staff: record who attended each live session from the
Google Meet attendance file, and give attendance points. Who may do it is in
[COURSE-STAFF.md](COURSE-STAFF.md); how attendance points fit the points scheme is in
[POINTS.md](../POINTS.md).

> Screenshots are optional in this guide; the names in **bold** are the labels you see in the academy.

## Who can do it

| Who | Where | What |
|---|---|---|
| Super admins and **ACADEMIC** admins | Admin → Courses → {course} → **Attendance** | Upload, mark by hand, export, and change the course's attendance rule and points |
| Course staff whose role has **Upload attendance** | Teaching (`/teach`) → {course} → **Attendance** | Upload, mark by hand and export, in their courses only (the rule and points are read-only) |

## The rule and the points

Each course has an **Attendance rule and points** (admins set it in the Attendance tab):

- **Present from (%)**: a student who was in the call for at least this share of the session's
  duration is **Present** (default 50 %).
- **Partial**: at least one minute, but below the threshold.
- **Absent**: less than a minute, or not in the file.
- **Points per session**: present 10, partial 5, absent 0 by default (0–1000 each). They go to the
  course leaderboard.

A change to the rule applies the next time a session's attendance is saved.

## Get the file from Google Meet

Either of these works, as .csv or .xlsx:

- the **Google Workspace Meet attendance report** (emailed to the organiser, or in the Calendar event's
  Drive folder): First name, Last name, Email, Duration, Time joined, Time exited;
- a **Meet attendance Chrome extension** ("Google Meet Attendance List", "Meet Attendance"): Name,
  Email (often missing), First seen, Last seen, Time in call, or one column per snapshot time.

Title rows above the header are skipped, and rows for the same person (Meet writes one per rejoin) are
added together. Up to 2,000 rows and 5 MB per file.

## Upload, step by step

1. Open the course's **Attendance** tab and pick the session (**Sessions** list).
2. Under **Upload the Meet attendance file**, press **Choose a file**. The file is read in your
   browser; nothing is saved yet.
3. Optional: **Present from (%) for this session only** overrides the course's threshold (for example
   for a session that ran long).
4. Check the **preview**:
   - a summary ("18 present · 3 partial · 4 absent (present from 50 %)") and how points change;
   - one row per enrolled student with minutes, status and points. Students are matched by **email**
     (the account email or the Google email on their profile), then by **exact name**. A name match
     says **Matched by name: check**; if it is the wrong person, choose **Not them: ignore**;
   - **Not matched to a student**: pick the enrolled student for each row, or **Ignore** it (a guest).
     Unmatched rows are never saved and no account is created;
   - change any student's status in the preview if you know better (it shows **Set by hand**);
   - rows that were skipped (no name or email, or an unreadable duration) are listed by row number.
5. Press **Save attendance**. If the session already has attendance, the button says **Replace
   attendance**: saving replaces it and adjusts points by the difference (points are never counted
   twice).

## After the upload

- **Mark by hand:** change one student's status in **Recorded attendance** at any time (also without
  a file, for example for someone who joined by phone and isn't in the report). Their points follow.
- **Attendance CSV** (top of the tab): one row per student, one column per session, then Present,
  Partial, Absent and Attendance points.
- **Students** see their own attendance under each session on the learn page ("Present · 85 min").
- Every upload and change is in the audit log with who made it.

## Common problems

| Problem | Fix |
|---|---|
| "No header row found" | The file needs a Name (or First name / Last name) or Email column: use the file as Meet exported it |
| "No duration found" | The file needs a Duration or Time in call column, joined and left times, or one column per time |
| Many students unmatched | Their Meet name differs from the profile name and Meet gave no email: match them by hand, or ask students to join with their profile's Google account |
| A guest is matched to a student by name | Choose **Not them: ignore** on that row |
| Wrong session uploaded | Upload the right file to that session: saving replaces it and corrects the points |

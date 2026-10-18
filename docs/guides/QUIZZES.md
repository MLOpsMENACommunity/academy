# Setting up quizzes, labs and assignments

A step-by-step guide for the academy owner, academic admins and course staff. It covers building a
quiz by hand, uploading one quiz from a spreadsheet, importing many quizzes for many sessions from one
file, what students receive, and what you can still change once students have answered.

The feature reference is [FEATURES.md, section 6](../FEATURES.md#6-assessments-quizzes-labs-assignments).
Who may do what is in [COURSE-STAFF.md](COURSE-STAFF.md) and [ADMIN-ROLES.md](../ADMIN-ROLES.md).

> Screenshots are optional in this guide. The text describes every screen; the names in **bold** are
> the labels you see in the academy.

## Contents

1. [Who can set up quizzes](#1-who-can-set-up-quizzes)
2. [Create a quiz by hand](#2-create-a-quiz-by-hand)
3. [Questions, weights and scoring](#3-questions-weights-and-scoring)
4. [Upload one quiz's questions from a file](#4-upload-one-quizs-questions-from-a-file)
5. [Import many quizzes for many sessions from one file](#5-import-many-quizzes-for-many-sessions-from-one-file)
6. [Column reference](#6-column-reference)
7. [The templates](#7-the-templates)
8. [Common errors and how to fix them](#8-common-errors-and-how-to-fix-them)
9. [Publishing and what students receive](#9-publishing-and-what-students-receive)
10. [Editing after students have submitted](#10-editing-after-students-have-submitted)
11. [The gradebook and the CSV export](#11-the-gradebook-and-the-csv-export)
12. [Labs and assignments](#12-labs-and-assignments)
13. [Course staff in /teach](#13-course-staff-in-teach)
14. [Checklist before a course starts](#14-checklist-before-a-course-starts)

---

## 1. Who can set up quizzes

| Who | Where | What |
|---|---|---|
| Super admins and **ACADEMIC** admins | Admin → Courses → {course} → **Assessments** | Everything in this guide, in every course |
| Course staff whose role has **Manage assessments** | Teaching (`/teach`) → {course} → **Assessments** | Create, edit, publish, upload and import, in their courses only |
| Course staff whose role has **Grade** | Teaching → {course} → **Assessments** and **Gradebook** | Grade submissions and download the gradebook |

Other admin presets (CONTENT, ADMISSIONS, FINANCE, SPEAKERS) can't open assessments.

## 2. Create a quiz by hand

1. Go to **Admin → Courses**, open the course, and choose the **Assessments** tab.
2. Press **+ New assessment**. The **New assessment** form opens.
3. **Type:** choose **Quiz**. (Labs and assignments are in [section 12](#12-labs-and-assignments).)
4. **Status:** leave **Draft** while you build it. Students only see **Published** assessments.
5. **Session:** pick the session the quiz belongs to (it is shown under that session on the learn
   page), or leave **Whole course** for a course-level quiz such as a midpoint or final quiz. Sessions
   are listed by their number in the course: "Session 2: Deployments and services".
6. **Title:** for example "Session 2 review". Titles and text are written in English; students on the
   Arabic site see the same English text, with True/False shown in Arabic.
7. **Instructions (Markdown):** what to read first, how many attempts, the time limit. Optional.
8. **Due date:** in your own time zone (the form shows your browser's time). Leave it empty for no due
   date. Students see it in their own time zone.
9. **Max points:** what the quiz is worth (default 100). The score is scaled to this number.
10. **Pass mark (%):** the score needed to pass (default 70).
11. **Accept late work (marked late):** on by default. Turn it off to close the quiz at the due date.
12. **Certificate:** **Mandatory for the certificate** (the student must pass it) or **Optional**
    (graded and earns points, but doesn't affect the certificate). New quizzes start Optional. If the
    course's certificate rule doesn't require assessments, the form says the choice has no effect yet,
    with a link to the **Certificates** tab.
13. **Quiz settings:**
    - **Attempts allowed:** 1 by default; 0 means unlimited; at most 20.
    - **Which attempt counts:** **Best attempt** (default) or **Last attempt**.
    - **Show the answers:** **Never**, **After the student's last attempt** (default) or **After the
      due date**. "After the due date" needs a due date and late work turned off. With unlimited
      attempts, "after the last attempt" shows the answers after every attempt: that is a practice
      quiz, and it can't be mandatory for the certificate.
    - **Time limit (minutes):** empty for none, up to 600. The server enforces it; the student sees a
      countdown, and the attempt is submitted automatically at zero.
    - **Shuffle questions and options for each attempt:** each attempt gets its own order.
14. **Questions:** press **+ Add question** for each one (next section), or upload them from a file
    ([section 4](#4-upload-one-quizs-questions-from-a-file)).
15. Press **Save assessment**. The quiz appears in the list with its session, due date, points and
    badges (Quiz, Draft or Published, number of questions, Mandatory or Optional).
16. Check it as a student would: once published, **Preview** opens the student page.
17. When it is ready, open it with **Edit**, set **Status** to **Published** and save
    ([section 9](#9-publishing-and-what-students-receive)).

Use the ↑ and ↓ buttons in the list to set the order students see.

## 3. Questions, weights and scoring

Each question has a **Question type**, the question text, its options, the correct answer(s), a
**Weight (points)** and an optional **Explanation**.

| Type | Options | Correct answers | How it is marked |
|---|---|---|---|
| **Single choice** | 2 to 10 | Exactly one | Right if the student picks that one |
| **Multiple choice (all-or-nothing)** | 2 to 10 | One or more | Right only if the student picks exactly the correct ones: no partial credit |
| **True / false** | Fixed: True, False | One | Right if the student picks it. Students see True and False in their own language |

**Weights.** A weight is a whole number from 1 to 100 (default 1). A question with weight 2 counts
twice as much as one with weight 1. The editor shows the **Total weight** under **Questions**.

**The score:**

```
score = (sum of the weights of the questions answered right ÷ total weight) × max points
```

Example: "Session 1 check-in" has three questions with weights 1, 2 and 1 (total 4) and max points
10. A student who gets the first and the third right earns 1 + 1 = 2 of 4, so 2 ÷ 4 × 10 = **5 / 10**,
50 %. With a pass mark of 70 % that is not a pass. Getting only the weight-2 question right gives the
same 5 / 10.

With several attempts, **Which attempt counts** decides the recorded score (best or last). Scores are
rounded to two decimals.

**Explanations** are shown with the answers, when the **Show the answers** rule allows: never while an
attempt is open.

Limits: 200 questions per quiz, 10 options per question, 2,000 characters per question or
explanation, 500 per option.

## 4. Upload one quiz's questions from a file

Inside a quiz you are creating or editing, the **Upload questions from Excel or CSV** box fills the
question list from a spreadsheet. Use it when you have one quiz's questions in a sheet.

1. Press **Download the template (.xlsx)** (or **Template (.csv)**). It has one example of each type.
2. Fill it in Excel, Google Sheets or Numbers: one question per row. The columns are in
   [section 6.1](#61-question-columns); `weight` is the question's points.
3. Back in the quiz, press **Choose a file** and pick your .xlsx or .csv (5 MB at most; old .xls
   files: save them as .xlsx first). The file is read in your browser.
4. A preview lists every question with its type, options (✓ marks the correct ones) and weight. If a
   row has a problem, the preview lists it as "Row 7: …" and nothing can be added: fix the file and
   choose it again.
5. Press **Add after the current questions**, or **Replace the current questions**.
6. Review the questions in the editor, then press **Save assessment**. Nothing is saved before that.

The box is switched off once students have submitted the quiz (the questions are locked).

## 5. Import many quizzes for many sessions from one file

**Import quizzes from a file** creates several quizzes at once, each on its session, with all their
questions and settings. Use it to load a whole course's quizzes before it starts.

1. In the course's **Assessments** tab, press **Import quizzes from a file**.
2. Press **Download the template (.xlsx)** (or **Template (.csv)**). It holds two example quizzes, on
   sessions 1 and 2, with every question type and different weights
   ([section 7](#7-the-templates)).
3. Fill it in, one row per question:
   - `quiz` is the quiz title. Every row with the same title (in any case) belongs to that quiz; the
     rows don't need to be next to each other.
   - `session` is the session number, its position in the course (1, 2, 3…), as in the
     **Sessions** tab. Write `course` or leave it empty for a whole-course quiz. Later rows of a quiz
     may leave it empty; if they fill it in, it must match the first row.
   - The question columns are the same as for one quiz ([section 6.1](#61-question-columns)).
   - The settings (`pass_percent`, `due`, `attempts`, …) are read from each quiz's **first row**
     only; leave them empty on the other rows. Empty settings take the defaults
     ([section 6.2](#62-quiz-settings-columns)).
4. Make sure the course has the sessions the file names: add them in the **Sessions** tab first.
5. Press **Choose a file** and pick your .xlsx or .csv. The file is read in your browser; nothing is
   sent yet.
6. Check the **preview**:
   - one row per quiz: title (and the sheet row it starts on), **Session**, **Questions** (with how
     many of each type), **Total weight** (and each question's weight, e.g. `1 + 2 + 1`), **Settings**
     (Draft or Published, Mandatory or Optional, pass mark, due date in your time zone, attempts, time
     limit, when answers are shown, max points) and **On import** (New, Skipped, or Replaces);
   - above it, every problem with its sheet row and quiz, e.g. "Row 5 (Session 2 review): Unknown
     reveal "sometimes"". While there is any problem, nothing can be imported.
7. Quizzes whose title is already used by a quiz **of the same session** are **skipped**. To update
   them instead, tick **Replace existing quizzes with the same title**: their settings and questions
   are replaced by the file's. A quiz that students have already submitted can't be replaced; the
   import then stops with its name and saves nothing.
8. Press **Import N quizzes**. All the quizzes are saved together; if anything fails, none is saved.
   The list then shows them on their sessions, with a message such as "Import finished: 2 quizzes
   created, 0 replaced, 0 skipped".
9. Open each quiz with **Edit** to check it, add anything the file doesn't set (for example **Which
   attempt counts** or **Shuffle**), and publish it when it is ready.

**Defaults:** imported quizzes are **Draft** unless the `status` column says `published`. Publishing
from the file tells the students at once ([section 9](#9-publishing-and-what-students-receive)): the
preview warns you how many quizzes would be published.

**Limits:** 30 quizzes and 1,000 questions per file, 200 questions per quiz, 5 MB. Split a larger set
into several files. Course staff also count imported quizzes toward their limit of 30 new
assessments per 24 hours.

Every import is recorded in the audit log (who, which course, how many created, replaced, skipped,
questions and published), and each new quiz has its own "created" entry.

## 6. Column reference

Header names are not case-sensitive, spaces, `_` and `-` don't matter, the columns can be in any
order, and the aliases in the tables work too. Unknown columns are ignored.

### 6.1 Question columns

Used by both the single-quiz upload and the import.

| Column | Aliases | Required | What to write | Examples |
|---|---|---|---|---|
| `type` | `kind`, `question type` | No | `single`, `multiple` or `true_false` (also `mcq`, `checkbox`, `tf`, `boolean`). Empty: guessed (true/false with no options, multiple when several answers are correct, otherwise single) | `single` |
| `question` | `prompt`, `question text`, `text` | Yes | The question | `Which tool tracks ML experiments?` |
| `option1` … `option6` | `option A` … `option F`, `choice 1`, `opt 1` | Single and multiple: at least two | The choices. Leave unused ones empty; true/false needs none | `Nginx`, `MLflow`, `Excel` |
| `correct` | `answer`, `answers`, `correct answer`, `key` | Yes | Option numbers or letters; several separated by commas. True/false: `true` or `false` (also yes/no, صح/خطأ) | `2`, `1,3`, `B`, `A,C`, `true` |
| `weight` | `points`, `marks`, `score` | No | The question's points: a whole number 1–100. Empty = 1 | `1`, `2`, `3` |
| `explanation` | `explain`, `why`, `rationale`, `feedback` | No | Shown with the answers | `MLflow logs runs.` |

### 6.2 Quiz settings columns

Import only. Read from each quiz's first row.

| Column | Aliases | Default | What to write | Examples |
|---|---|---|---|---|
| `quiz` | `quiz title`, `quiz name`, `title`, `assessment`, `test`, `exam` | Required | The quiz title, 2–200 characters. Same title = same quiz | `Session 1 check-in` |
| `session` | `session number`, `session no`, `session #`, `lesson` | Whole course | The session's number in the course, or `course` / empty | `1`, `Session 2`, `S3`, `course` |
| `pass_percent` | `pass`, `pass %`, `pass mark`, `passing score` | 70 | 0–100 (a `%` sign and Excel percentage cells work) | `70`, `70%` |
| `due` | `due date`, `due at`, `deadline` | No due date | `YYYY-MM-DD HH:mm` in **Cairo time**; a date alone means 23:59 Cairo; an ISO time with a zone is taken as written; Excel date cells work | `2027-03-01 20:00`, `2027-03-01`, `2027-03-01T18:00:00Z` |
| `attempts` | `attempts allowed`, `max attempts`, `tries` | 1 | 0–20; `0` or `unlimited` for no limit | `2`, `unlimited` |
| `time_limit_min` | `time limit`, `minutes`, `duration` | None | 1–600 minutes; empty, `0` or `none` for no limit | `15`, `30 min` |
| `reveal` | `reveal answers`, `show answers` | `after_submit` | `never`, `after_submit` (after the student's last attempt) or `after_due` (needs a due date; late work is then turned off) | `after_submit` |
| `mandatory` | `required`, `counts for certificate`, `certificate` | `no` | `yes` (mandatory for the certificate) or `no` (optional); also true/false, نعم/لا | `yes` |
| `status` | `publish`, `published`, `state` | `draft` | `draft` or `published` | `draft` |
| `max_points` | `total points`, `out of`, `max score` | 100 | 1–1000 | `10` |
| `instructions` | `description`, `intro` | Empty | Markdown shown above the questions | `Two attempts; the best counts.` |

Not in the file (set them by hand after importing if you need them): **Which attempt counts** (best),
**Accept late work** (on, except with `reveal` = `after_due`), **Shuffle** (off).

## 7. The templates

### 7.1 Import template (many quizzes)

From **Import quizzes from a file → Download the template**. As a table (empty cells left out):

| quiz | session | type | question | option1 | option2 | option3 | correct | weight | explanation | settings on the first row |
|---|---|---|---|---|---|---|---|---|---|---|
| Session 1 check-in | 1 | single | Which tool tracks ML experiments? | Nginx | MLflow | Excel | 2 | 1 | MLflow logs parameters, metrics and artifacts for each run. | pass_percent 70, due 2027-03-01 20:00, attempts 2, time_limit_min 15, reveal after_submit, mandatory yes, status draft, max_points 10, instructions |
| Session 1 check-in | 1 | multiple | Which of these are feature stores? | Feast | Grafana | Tecton | 1,3 | 2 | Feast and Tecton serve features; Grafana draws dashboards. | |
| Session 1 check-in | 1 | true_false | A model registry stores versioned models. | | | | true | 1 | | |
| Session 2 review | 2 | single | Which Kubernetes object runs a batch task to completion? | Deployment | Job | Service | B | 2 | | pass_percent 60, attempts 1, reveal never, mandatory no, status draft |
| Session 2 review | 2 | multiple | Which are common ways to serve a model? | A REST API | Batch scoring | A printed report | A,B | 3 | | |
| Session 2 review | 2 | true_false | Data drift means the input data changes over time. | | | | true | 1 | Drift is a change in the data the model sees after training. | |

The same file as CSV (you can paste this into a `.csv` file):

```csv
"quiz","session","type","question","option1","option2","option3","option4","option5","option6","correct","weight","explanation","pass_percent","due","attempts","time_limit_min","reveal","mandatory","status","max_points","instructions"
"Session 1 check-in","1","single","Which tool tracks ML experiments?","Nginx","MLflow","Excel","","","","2","1","MLflow logs parameters, metrics and artifacts for each run.","70","2027-03-01 20:00","2","15","after_submit","yes","draft","10","Answer every question. You have two attempts; the best one counts."
"Session 1 check-in","1","multiple","Which of these are feature stores?","Feast","Grafana","Tecton","","","","1,3","2","Feast and Tecton serve features; Grafana draws dashboards.","","","","","","","","",""
"Session 1 check-in","1","true_false","A model registry stores versioned models.","","","","","","","true","1","","","","","","","","","",""
"Session 2 review","2","single","Which Kubernetes object runs a batch task to completion?","Deployment","Job","Service","","","","B","2","","60","","1","","never","no","draft","",""
"Session 2 review","2","multiple","Which are common ways to serve a model?","A REST API","Batch scoring","A printed report","","","","A,B","3","","","","","","","","","",""
"Session 2 review","2","true_false","Data drift means the input data changes over time.","","","","","","","true","1","Drift is a change in the data the model sees after training.","","","","","","","","",""
```

What it creates: two draft quizzes. "Session 1 check-in" on session 1: total weight 4, max 10 points,
pass 70 %, due 1 March 2027 at 20:00 Cairo time, 2 attempts, 15 minutes, mandatory. "Session 2
review" on session 2: total weight 6, max 100 points, pass 60 %, no due date, 1 attempt, answers never
shown, optional.

### 7.2 Single-quiz template (one quiz's questions)

From the quiz editor's **Upload questions from Excel or CSV → Download the template**:

```csv
"type","question","option1","option2","option3","option4","option5","option6","correct","weight","explanation"
"single","Which tool tracks ML experiments?","Nginx","MLflow","Excel","","","","2","1","MLflow logs parameters, metrics and artifacts for each run."
"multiple","Which of these are feature stores?","Feast","Grafana","Tecton","","","","1,3","2",""
"true_false","Kubernetes schedules containers onto nodes.","","","","","","","true","1",""
```

The `weight` column is each question's points (here 1, 2 and 1).

## 8. Common errors and how to fix them

The preview names the sheet row (row 1 is the header) and, for the import, the quiz.

| Message | Why | Fix |
|---|---|---|
| The first row needs a "quiz" (or "question", "correct") column | The header row is missing a required column or it is misspelled | Start from the template; keep the header row as the first non-empty row |
| The "quiz" column is empty | A question row has no quiz title | Write the quiz title on every row of that quiz |
| "two" isn't a session number | The `session` cell isn't a number | Use 1, 2, 3… or `course` |
| This course has no session 3 | The course has fewer sessions | Add the session in the **Sessions** tab, or fix the number |
| This row says session "2", but the quiz's first row says "1" | Two rows of one quiz name different sessions | Use one session per quiz; give quizzes in different sessions different titles |
| "9" isn't an option number or letter / The correct answer is option 4, but that option is empty | `correct` points to an option that doesn't exist | Fix `correct`, or fill in the option |
| A single-choice question has exactly one correct answer | `type` is `single` but `correct` lists several | Change `type` to `multiple`, or keep one answer |
| A true/false answer must be true or false | `correct` isn't true/false | Write `true` or `false` |
| Give at least two options | A single or multiple question has fewer than two options | Add options, or use `true_false` |
| The weight "0" must be a whole number from 1 to 100 | Weight out of range or with decimals | Use 1–100 |
| "31/12/2026" isn't a date | The `due` cell isn't in a known format | Write `2026-12-31 18:00` (Cairo time), or format the cell as a date |
| Answers shown after the due date need a due date | `reveal` is `after_due` with no `due` | Add a due date, or choose another reveal |
| Unlimited attempts with answers after each one is a practice quiz: it can't be mandatory | `attempts` 0 + `reveal` `after_submit` + `mandatory` yes | Make it optional, limit attempts, or reveal after the due date |
| The file has 31 quizzes: at most 30 / The file has 1,200 questions: at most 1,000 | Over the import limits | Split the file |
| That file couldn't be read | Not a real .xlsx or .csv (e.g. an old .xls, or a renamed file) | Save as .xlsx or .csv |
| Students have submitted "…": those quizzes can't be replaced | **Replace** is on and a matching quiz has submissions | Rename that quiz in the file (it becomes a new quiz), or turn **Replace** off |
| This would go over the daily limit on new assessments | Course staff: more than 30 new assessments in 24 hours | Import fewer quizzes, or ask an academic admin |
| The course's sessions changed | A session was deleted or renumbered after you previewed | Reload the page and choose the file again |

## 9. Publishing and what students receive

- **Publishing** is the **Status** field: set it to **Published** and save (or `status` =
  `published` in an import). A quiz needs at least one question to be published.
- **The first time** an assessment is published, every enrolled student gets:
  - an **in-app notice** ("New quiz: Session 2 review", with the course and the due date), and
  - an **email** ("New quiz …" with a button to open it), unless they turned off reminders for that
    course on their learn page. Emails go out through the email outbox within a minute or so.
  Only courses that are Open or Closed send notices. Unpublishing and publishing again sends nothing
  new. Importing 10 published quizzes sends each student 10 notices: import as drafts and publish one
  at a time if you prefer.
- **The 24-hour due reminder:** 24 hours before the due date, students who haven't submitted get an
  email reminder (once each; it respects the same per-course opt-out).
- **Graded:** when a lab or assignment is graded, the student gets an in-app notice and an email with
  the score. Quizzes are graded on submission and the student sees the score at once.
- **What students see:** on the learn page, under the quiz's session (or in the course's Assessments
  list), with how many are due. When the course's certificate requires assessments, each one shows
  **Required for certificate** or **Optional**.

## 10. Editing after students have submitted

Once anyone has submitted, the list and the editor say how many students have, and:

| Locked (can't change) | Still editable |
|---|---|
| The type | Wording: title, instructions, question text, options, explanations |
| Max points | The order of questions and options |
| Which questions exist, their types, their weights and the answer key | Due date, pass mark, attempts, reveal rule, time limit, shuffle, mandatory/optional, session, status |

Changing wording doesn't regrade earlier attempts. To change the questions or the key, create a new
quiz (for example duplicate it by importing a file with a new title) and unpublish the old one.

An assessment with submissions can't be deleted: set it to **Draft** instead. Unpublishing takes its
points back from the leaderboard; publishing again restores them.

## 11. The gradebook and the CSV export

- **Gradebook** (the button on each assessment) lists every enrolled student with their state (To
  grade, Graded, Late, Missing), attempts, score and who graded it. Quizzes grade themselves; open a
  quiz submission to see each answer against the key.
- **Gradebook CSV** (top of the Assessments tab): one row per student, one column per **published**
  assessment ("Title (/max points)"), then Total, Possible, Percent and "Certificate assessments
  passed". A cell says `pending` (submitted, not graded) or `missing`. Downloading is audited.

## 12. Labs and assignments

Labs and assignments are created with the same form: choose **Type** = **Lab** or **Assignment**, then
**How students submit**:

| Submission kind | What students send | Checks |
|---|---|---|
| **GitHub repository (must be public)** | A github.com repository link | The academy checks with GitHub that it is public; "Couldn't verify" if GitHub is unreachable |
| **Google Drive / Docs link** | A drive.google.com or docs.google.com link | The student ticks that sharing is "Anyone with the link can view" |
| **PDF upload (5 MB max)** | A PDF file | Opened by graders through a 5-minute link (audited) |
| **Any link** | Any https link | None |

Students can resubmit until the due date or until graded. You grade each submission in the
**Gradebook** with a score, feedback and optional rubric notes; the student is told. The quiz settings
(attempts, reveal, time limit, questions) don't apply to labs and assignments, and they can't be
imported from a file.

## 13. Course staff in /teach

Course staff open **Teaching** (`/teach`, linked from the dashboard and the speaker portal), choose
the course, and see only the tabs their role opens:

- **Assessments** (Manage assessments): the same list, editor, single-quiz upload and **Import quizzes
  from a file** as admins have, for that course only.
- **Gradebook** (Grade): grading and the gradebook CSV.

Limits for staff: 30 writes a minute, 30 new assessments per 24 hours (an import counts each new
quiz), 10 imports a minute. Every change is in the audit log with their name, and the assessment list
shows "Last edited by {name}". See [COURSE-STAFF.md](COURSE-STAFF.md).

## 14. Checklist before a course starts

1. The course's **Sessions** exist and are in order (the session numbers the quiz file uses).
2. The **Certificates** rule says whether passing mandatory assessments is required.
3. Quizzes are created (by hand or imported) as **Draft**, each on its session, with due dates.
4. Each quiz is checked in **Edit**: weights, the answer key, reveal rule, attempts.
5. Each quiz is published when its session is close, so students get the notice at the right time.

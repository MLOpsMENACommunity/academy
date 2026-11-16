-- Course Q&A, part 2: "Answer questions" (ANSWER_QUESTIONS) for the three built-in roles of every
-- course (Main instructor, Co-instructor, Moderator), like their defaults for new courses
-- (packages/shared/src/course-staff.ts). A separate migration because the enum value added in
-- 20261116180000_course_qa can't be used in the transaction that adds it. Custom roles are left
-- alone (admins tick the box). Idempotent: a role that already has it is skipped.
UPDATE "CourseRole"
SET "permissions" = array_append("permissions", 'ANSWER_QUESTIONS'::"CoursePermission"), "updatedAt" = NOW()
WHERE "builtin" IN ('MAIN', 'CO', 'MODERATOR')
  AND NOT ('ANSWER_QUESTIONS'::"CoursePermission" = ANY("permissions"));

-- Course staff: per-course roles with permissions (CourseRole) and the people in them
-- (CourseStaff). Additive only: CourseInstructor stays, derived from CourseStaff from now on.
--
-- Backfill (below the tables):
--   1. every course gets the three built-in roles (Main instructor, Co-instructor, Moderator);
--   2. every CourseInstructor row becomes a CourseStaff row: the lowest order of each course in
--      the Main instructor role, the others Co-instructors; instructorId is the profile and
--      userId the speaker account behind it (Instructor.userId), when there is one.
-- Built-in names and permissions must match BUILTIN_ROLE_DEFAULTS in packages/shared/src/course-staff.ts.

-- CreateEnum
CREATE TYPE "CoursePermission" AS ENUM ('MANAGE_ASSESSMENTS', 'GRADE', 'MANAGE_MATERIALS', 'VIEW_ROSTER', 'UPLOAD_ATTENDANCE', 'MANAGE_POINTS', 'ANNOUNCE', 'EDIT_COURSE', 'MANAGE_SESSIONS', 'MANAGE_APPLICATIONS', 'ENROL', 'ISSUE_CERTIFICATES');

-- CreateEnum
CREATE TYPE "StaffVisibility" AS ENUM ('SHOWN', 'ANONYMOUS');

-- CreateEnum
CREATE TYPE "BuiltinCourseRole" AS ENUM ('MAIN', 'CO', 'MODERATOR');

-- CreateTable
CREATE TABLE "CourseRole" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameAr" TEXT,
    "permissions" "CoursePermission"[] DEFAULT ARRAY[]::"CoursePermission"[],
    "visibility" "StaffVisibility" NOT NULL DEFAULT 'SHOWN',
    "builtin" "BuiltinCourseRole",
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourseRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourseStaff" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "userId" TEXT,
    "instructorId" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourseStaff_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CourseRole_courseId_idx" ON "CourseRole"("courseId");

-- CreateIndex
CREATE UNIQUE INDEX "CourseRole_courseId_builtin_key" ON "CourseRole"("courseId", "builtin");

-- CreateIndex
CREATE INDEX "CourseStaff_userId_idx" ON "CourseStaff"("userId");

-- CreateIndex
CREATE INDEX "CourseStaff_instructorId_idx" ON "CourseStaff"("instructorId");

-- CreateIndex
CREATE INDEX "CourseStaff_roleId_idx" ON "CourseStaff"("roleId");

-- CreateIndex
CREATE UNIQUE INDEX "CourseStaff_courseId_userId_key" ON "CourseStaff"("courseId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "CourseStaff_courseId_instructorId_key" ON "CourseStaff"("courseId", "instructorId");

-- AddForeignKey
ALTER TABLE "CourseRole" ADD CONSTRAINT "CourseRole_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseStaff" ADD CONSTRAINT "CourseStaff_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseStaff" ADD CONSTRAINT "CourseStaff_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "CourseRole"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseStaff" ADD CONSTRAINT "CourseStaff_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseStaff" ADD CONSTRAINT "CourseStaff_instructorId_fkey" FOREIGN KEY ("instructorId") REFERENCES "Instructor"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- A staff row is an account, a public speaker profile, or both.
ALTER TABLE "CourseStaff" ADD CONSTRAINT "CourseStaff_user_or_instructor" CHECK ("userId" IS NOT NULL OR "instructorId" IS NOT NULL);

-- Deleting a profile or an account sets the column to NULL (foreign keys above); a row that would
-- be left with neither goes first, so the check constraint never blocks those deletes.
CREATE OR REPLACE FUNCTION course_staff_drop_orphan_instructor() RETURNS trigger AS $$
BEGIN
  DELETE FROM "CourseStaff" WHERE "instructorId" = OLD."id" AND "userId" IS NULL;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION course_staff_drop_orphan_user() RETURNS trigger AS $$
BEGIN
  DELETE FROM "CourseStaff" WHERE "userId" = OLD."id" AND "instructorId" IS NULL;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Instructor_course_staff_orphans" BEFORE DELETE ON "Instructor"
  FOR EACH ROW EXECUTE FUNCTION course_staff_drop_orphan_instructor();
CREATE TRIGGER "User_course_staff_orphans" BEFORE DELETE ON "User"
  FOR EACH ROW EXECUTE FUNCTION course_staff_drop_orphan_user();

-- ---------------------------------------------------------------- backfill

-- 1. The three built-in roles for every course.
INSERT INTO "CourseRole" ("id", "courseId", "name", "nameAr", "permissions", "visibility", "builtin", "order", "createdAt", "updatedAt")
SELECT 'crl' || replace(gen_random_uuid()::text, '-', ''), c."id", b."name", b."nameAr", b."permissions"::"CoursePermission"[], b."visibility"::"StaffVisibility", b."builtin"::"BuiltinCourseRole", b."order", NOW(), NOW()
FROM "Course" c
CROSS JOIN (VALUES
  ('MAIN', 'Main instructor', 'المدرّب الرئيسي',
    '{MANAGE_ASSESSMENTS,GRADE,MANAGE_MATERIALS,VIEW_ROSTER,UPLOAD_ATTENDANCE,MANAGE_POINTS,ANNOUNCE,EDIT_COURSE,MANAGE_SESSIONS,MANAGE_APPLICATIONS,ENROL,ISSUE_CERTIFICATES}',
    'SHOWN', 0),
  ('CO', 'Co-instructor', 'مدرّب مشارك',
    '{MANAGE_ASSESSMENTS,GRADE,MANAGE_MATERIALS,VIEW_ROSTER,UPLOAD_ATTENDANCE,MANAGE_POINTS,ANNOUNCE}',
    'SHOWN', 1),
  ('MODERATOR', 'Moderator', 'مشرف',
    '{VIEW_ROSTER,UPLOAD_ATTENDANCE,MANAGE_POINTS,ANNOUNCE}',
    'ANONYMOUS', 2)
) AS b("builtin", "name", "nameAr", "permissions", "visibility", "order");

-- 2. Every course instructor becomes staff: the first in order is the Main instructor.
INSERT INTO "CourseStaff" ("id", "courseId", "roleId", "userId", "instructorId", "order", "createdAt", "updatedAt")
SELECT 'cst' || replace(gen_random_uuid()::text, '-', ''), ranked."courseId", r."id", i."userId", ranked."instructorId", ranked.n - 1, NOW(), NOW()
FROM (
  SELECT ci."courseId", ci."instructorId", ROW_NUMBER() OVER (PARTITION BY ci."courseId" ORDER BY ci."order", ci."instructorId") AS n
  FROM "CourseInstructor" ci
) ranked
JOIN "Instructor" i ON i."id" = ranked."instructorId"
JOIN "CourseRole" r ON r."courseId" = ranked."courseId" AND r."builtin" = (CASE WHEN ranked.n = 1 THEN 'MAIN' ELSE 'CO' END)::"BuiltinCourseRole";

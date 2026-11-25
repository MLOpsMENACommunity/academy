-- Private courses: only the accounts whose (lower-cased, trimmed) emails are listed see the course;
-- an empty list is a normal public course. Additive only: one column with a default, so the
-- previous release keeps working against this schema (it never reads or writes it).
-- Nullable like every other Prisma scalar list here (Prisma has no NOT NULL lists; NOT NULL would
-- show as drift); the default and the API never leave it NULL.
ALTER TABLE "Course" ADD COLUMN "visibleToEmails" TEXT[] DEFAULT ARRAY[]::TEXT[];

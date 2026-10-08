-- Archive: completed courses that stay public, filter topics, speaker pages, and
-- bookkeeping for prisma/import-archive.ts. Additive only: new enum value, new
-- nullable/defaulted columns, new indexes, one optional foreign key.

-- A past cohort that stays public.
ALTER TYPE "CourseStatus" ADD VALUE 'COMPLETED';

ALTER TABLE "Course" ADD COLUMN     "cohortNumber" INTEGER,
ADD COLUMN     "endDate" TIMESTAMP(3),
ADD COLUMN     "externalPlatform" TEXT,
ADD COLUMN     "externalUrl" TEXT,
ADD COLUMN     "importHash" TEXT,
ADD COLUMN     "publicRecordings" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "source" TEXT,
ADD COLUMN     "topics" TEXT[] DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "CourseSession" ADD COLUMN     "topics" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Instructors double as speakers, each with a public page at /speakers/{slug}.
ALTER TABLE "Instructor" ADD COLUMN     "githubUrl" TEXT,
ADD COLUMN     "importHash" TEXT,
ADD COLUMN     "slug" TEXT,
ADD COLUMN     "source" TEXT;

-- Give existing instructors a slug from their name ("Eng. Sameh Amin" -> "eng-sameh-amin").
-- A repeated name gets its id appended, so the unique index below always builds.
UPDATE "Instructor" AS i
SET "slug" = s."slug"
FROM (
  SELECT "id", CASE WHEN rn = 1 THEN base ELSE base || '-' || "id" END AS "slug"
  FROM (
    SELECT "id", base, row_number() OVER (PARTITION BY base ORDER BY "createdAt", "id") AS rn
    FROM (
      SELECT "id", "createdAt",
             left(COALESCE(NULLIF(trim(BOTH '-' FROM lower(regexp_replace("name", '[^A-Za-z0-9]+', '-', 'g'))), ''), 'speaker'), 60) AS base
      FROM "Instructor"
    ) named
  ) ranked
) s
WHERE i."id" = s."id";

ALTER TABLE "LiveEvent" ADD COLUMN     "importHash" TEXT,
ADD COLUMN     "source" TEXT,
ADD COLUMN     "speakerId" TEXT,
ADD COLUMN     "topics" TEXT[] DEFAULT ARRAY[]::TEXT[];

CREATE UNIQUE INDEX "Instructor_slug_key" ON "Instructor"("slug");
CREATE INDEX "LiveEvent_speakerId_idx" ON "LiveEvent"("speakerId");
CREATE INDEX "LiveEvent_topics_idx" ON "LiveEvent" USING GIN ("topics");

ALTER TABLE "LiveEvent" ADD CONSTRAINT "LiveEvent_speakerId_fkey" FOREIGN KEY ("speakerId") REFERENCES "Instructor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

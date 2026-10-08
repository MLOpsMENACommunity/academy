-- Archive follow-ups. Data only: no schema change.

-- 1. Speaker slugs the admin form would reject. The archive migration cut long names at 60
--    characters (which can leave a trailing dash) and appended the id to repeated names (up to
--    86 characters). Rewrite those as "<up to 50 characters of the slug>-<id>": valid and unique.
UPDATE "Instructor"
SET "slug" = COALESCE(NULLIF(trim(BOTH '-' FROM left(trim(BOTH '-' FROM "slug"), 50)), ''), 'speaker')
             || '-' || lower(regexp_replace("id", '[^A-Za-z0-9]+', '', 'g'))
WHERE "slug" IS NOT NULL
  AND ("slug" !~ '^[a-z0-9]+(-[a-z0-9]+)*$' OR length("slug") > 80);

-- 2. The archive import now treats importHash = NULL as "an admin has taken this record over"
--    (every admin save clears it). Records an admin already edited under the previous rule
--    (any audited admin action on them) keep that protection.
UPDATE "Instructor" AS i SET "importHash" = NULL
WHERE i."source" = 'import' AND i."importHash" IS NOT NULL
  AND EXISTS (SELECT 1 FROM "AuditLog" a WHERE a."actorId" IS NOT NULL AND a."entityType" = 'Instructor' AND a."entityId" = i."id");

UPDATE "LiveEvent" AS e SET "importHash" = NULL
WHERE e."source" = 'import' AND e."importHash" IS NOT NULL
  AND EXISTS (SELECT 1 FROM "AuditLog" a WHERE a."actorId" IS NOT NULL AND a."entityType" = 'LiveEvent' AND a."entityId" = e."id");

UPDATE "Course" AS c SET "importHash" = NULL
WHERE c."source" = 'import' AND c."importHash" IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM "AuditLog" a
    WHERE a."actorId" IS NOT NULL
      AND (
        (a."entityType" = 'Course' AND a."entityId" = c."id")
        OR (a."entityType" = 'CourseSession' AND a."entityId" IN (SELECT s."id" FROM "CourseSession" s WHERE s."courseId" = c."id"))
      )
  );

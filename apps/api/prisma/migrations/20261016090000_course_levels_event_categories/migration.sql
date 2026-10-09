-- Course levels as a multi-select (Junior, Mid, Senior, Lead) and a category for live sessions
-- in the recordings library. Additive: two enums and three columns, nothing is dropped.
-- The old single "level" column stays (derived from "levels" on every save) for older clients.

-- CreateEnum
CREATE TYPE "AudienceLevel" AS ENUM ('JUNIOR', 'MID', 'SENIOR', 'LEAD');

-- CreateEnum
CREATE TYPE "EventCategory" AS ENUM ('HANDS_ON', 'INDUSTRY', 'COURSE_RECORDING', 'TALK');

-- AlterTable
ALTER TABLE "Course" ADD COLUMN     "levelProgression" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "levels" "AudienceLevel"[] DEFAULT ARRAY[]::"AudienceLevel"[];

-- AlterTable
ALTER TABLE "LiveEvent" ADD COLUMN     "category" "EventCategory";

-- Backfill: every course keeps the meaning of its old level (mirrors levelsFromLegacy in
-- @academy/shared). ALL_LEVELS stays empty, which means "all levels".
UPDATE "Course" SET "levels" = CASE "level"
    WHEN 'BEGINNER' THEN ARRAY['JUNIOR']::"AudienceLevel"[]
    WHEN 'INTERMEDIATE' THEN ARRAY['MID']::"AudienceLevel"[]
    WHEN 'ADVANCED' THEN ARRAY['SENIOR']::"AudienceLevel"[]
    ELSE ARRAY[]::"AudienceLevel"[]
  END;

-- Backfill: categories for the sessions the archive import created (prisma/archive). Untouched
-- ones also get theirs from the import. This reaches those an admin has edited since, which the
-- import no longer touches. The column is new, so no admin value can be overwritten, and only
-- rows still without a category are set.
UPDATE "LiveEvent" SET "category" = 'HANDS_ON'
  WHERE "source" = 'import' AND "category" IS NULL AND "slug" IN (
    'docker-deep-dive',
    'hands-on-cicd-github-actions',
    'hands-on-fastapi-backend-for-mlops',
    'uv-for-legacy-python-projects',
    'ruff-python-linting-formatting-ci',
    'prometheus-grafana-monitoring-stack-part-1',
    'kubernetes-deployment-strategies-part-1',
    'kubernetes-deployment-strategies-part-2',
    'redis-for-semantic-caching'
  );
UPDATE "LiveEvent" SET "category" = 'INDUSTRY'
  WHERE "source" = 'import' AND "category" IS NULL AND "slug" IN (
    'on-prem-mlops-playbook',
    'introduction-to-llm-inference-engines'
  );

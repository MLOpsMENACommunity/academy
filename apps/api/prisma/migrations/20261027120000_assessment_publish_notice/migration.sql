-- Assessments: when enrolled students were told it was published (set once, on the
-- first publish), so unpublishing and publishing again never tells them twice.
-- Additive: a nullable column. Assessments that are already published count as
-- notified (students can already see them); only this new column is written.
ALTER TABLE "Assessment" ADD COLUMN "publishedNotifiedAt" TIMESTAMP(3);

UPDATE "Assessment" SET "publishedNotifiedAt" = "updatedAt" WHERE "status" = 'PUBLISHED';

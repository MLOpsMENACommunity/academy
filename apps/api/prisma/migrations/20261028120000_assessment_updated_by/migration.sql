-- Assessments: who saved one last (an admin or a teaching speaker), so admins see
-- "by {name}". Additive: a nullable column and its foreign key; nothing else changes.
ALTER TABLE "Assessment" ADD COLUMN "updatedById" TEXT;

ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

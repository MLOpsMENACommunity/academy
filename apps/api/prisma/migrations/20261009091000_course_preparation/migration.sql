-- Markdown shown after the prerequisites on the course page ("Before the course starts").
ALTER TABLE "Course" ADD COLUMN "preparation" JSONB NOT NULL DEFAULT '{"en":"","ar":""}';

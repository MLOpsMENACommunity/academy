-- Points follow-ups: the hourly sweep looks up recently changed submissions.
CREATE INDEX "Submission_updatedAt_idx" ON "Submission"("updatedAt");

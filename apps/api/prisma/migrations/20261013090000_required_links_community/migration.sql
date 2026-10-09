-- LinkedIn, GitHub and the community questions became required profile steps;
-- industry became optional and company size is no longer asked (the column stays).
ALTER TABLE "Profile" ADD COLUMN "communityAnsweredAt" TIMESTAMP(3);

-- Profiles that were complete under the old rule but miss a newly required answer are
-- marked incomplete, so onboarding asks for it before the student applies again.
-- Existing applications are untouched and no profile data is changed or removed.
UPDATE "Profile"
SET "coreCompletedAt" = NULL
WHERE "coreCompletedAt" IS NOT NULL
  AND (
    COALESCE(TRIM("linkedinUrl"), '') = ''
    OR COALESCE(TRIM("githubUrl"), '') = ''
    OR "referralSource" IS NULL
    OR "communityAnsweredAt" IS NULL
  );

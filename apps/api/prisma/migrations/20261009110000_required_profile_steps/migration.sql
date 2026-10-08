-- Professional background and education became required profile steps.
-- Profiles that were "complete" under the old rule but miss any newly required
-- field are marked incomplete, so onboarding asks for the missing details before
-- the student can apply again. No profile data is changed or removed.
UPDATE "Profile"
SET "coreCompletedAt" = NULL
WHERE "coreCompletedAt" IS NOT NULL
  AND (
    "industry" IS NULL
    OR "mlExperienceYears" IS NULL
    OR "seniority" IS NULL
    OR "educationLevel" IS NULL
    OR COALESCE(TRIM("fieldOfStudy"), '') = ''
    OR COALESCE(TRIM("university"), '') = ''
  );

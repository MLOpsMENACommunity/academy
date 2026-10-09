-- Students can no longer change their login email (security).
-- Drop any change still waiting for confirmation, and spend the links sent for it,
-- so an old confirmation link cannot change anyone's login email.
UPDATE "EmailVerificationToken" t
SET "usedAt" = NOW()
FROM "User" u
WHERE t."userId" = u."id"
  AND t."usedAt" IS NULL
  AND t."email" <> u."email";

UPDATE "User" SET "pendingEmail" = NULL WHERE "pendingEmail" IS NOT NULL;

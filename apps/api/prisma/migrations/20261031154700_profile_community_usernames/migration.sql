-- Telegram and Discord usernames on the student profile (community step). Additive and nullable:
-- students who joined before they were asked keep everything and are asked to add them.
ALTER TABLE "Profile" ADD COLUMN "telegramUsername" TEXT;
ALTER TABLE "Profile" ADD COLUMN "discordUsername" TEXT;

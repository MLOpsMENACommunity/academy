-- Telegram course groups: the student's connected Telegram account, each course's group and its
-- join-request link, the groups the bot was added to, and join requests waiting for an account.
-- Additive only: nullable columns and two new tables, so the previous release keeps working
-- against this schema (it never reads or writes them).
-- AlterTable
ALTER TABLE "Profile" ADD COLUMN     "telegramLinkedAt" TIMESTAMP(3),
ADD COLUMN     "telegramUserId" BIGINT;

-- AlterTable
ALTER TABLE "Course" ADD COLUMN     "telegramChatId" BIGINT,
ADD COLUMN     "telegramInviteLink" TEXT;

-- CreateTable
CREATE TABLE "TelegramChat" (
    "id" BIGINT NOT NULL,
    "title" TEXT NOT NULL,
    "botIsAdmin" BOOLEAN NOT NULL DEFAULT false,
    "canInvite" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TelegramChat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelegramJoinRequest" (
    "chatId" BIGINT NOT NULL,
    "telegramUserId" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TelegramJoinRequest_pkey" PRIMARY KEY ("chatId","telegramUserId")
);

-- CreateIndex
CREATE INDEX "TelegramJoinRequest_telegramUserId_idx" ON "TelegramJoinRequest"("telegramUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Profile_telegramUserId_key" ON "Profile"("telegramUserId");


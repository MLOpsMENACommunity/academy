-- DropIndex
DROP INDEX "Payment_transactionRef_idx";

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "transactionRefKey" TEXT NOT NULL DEFAULT '';

-- CreateIndex
CREATE INDEX "Payment_transactionRefKey_idx" ON "Payment"("transactionRefKey");

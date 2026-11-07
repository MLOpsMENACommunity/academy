-- Card payments through Paymob: one row per checkout attempt. Additive only: a new table, so the
-- previous release keeps working against this schema (it never reads or writes it).
-- CreateTable
CREATE TABLE "CardCheckout" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "intentionId" TEXT,
    "providerOrderId" TEXT,
    "transactionId" TEXT,
    "paymentId" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CardCheckout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CardCheckout_transactionId_key" ON "CardCheckout"("transactionId");

-- CreateIndex
CREATE UNIQUE INDEX "CardCheckout_paymentId_key" ON "CardCheckout"("paymentId");

-- CreateIndex
CREATE INDEX "CardCheckout_applicationId_idx" ON "CardCheckout"("applicationId");

-- CreateIndex
CREATE INDEX "CardCheckout_providerOrderId_idx" ON "CardCheckout"("providerOrderId");

-- AddForeignKey
ALTER TABLE "CardCheckout" ADD CONSTRAINT "CardCheckout_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardCheckout" ADD CONSTRAINT "CardCheckout_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

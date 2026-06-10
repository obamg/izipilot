-- CreateTable
CREATE TABLE "login_otps" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_otps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "login_otps_userId_idx" ON "login_otps"("userId");

-- CreateIndex
CREATE INDEX "login_otps_expiresAt_idx" ON "login_otps"("expiresAt");

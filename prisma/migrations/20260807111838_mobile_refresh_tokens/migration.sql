-- CreateTable
CREATE TABLE "mobile_refresh_tokens" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "deviceName" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mobile_refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mobile_refresh_tokens_tokenHash_key" ON "mobile_refresh_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "mobile_refresh_tokens_userId_idx" ON "mobile_refresh_tokens"("userId");

-- CreateIndex
CREATE INDEX "mobile_refresh_tokens_expiresAt_idx" ON "mobile_refresh_tokens"("expiresAt");

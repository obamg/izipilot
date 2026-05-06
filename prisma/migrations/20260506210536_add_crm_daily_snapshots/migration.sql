-- CreateTable
CREATE TABLE "crm_daily_snapshots" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "gleapProjectKey" TEXT NOT NULL,
    "snapshotDate" DATE NOT NULL,
    "openTickets" INTEGER,
    "totalTickets" INTEGER,
    "slaBreachedInSample" INTEGER,
    "sampleSize" INTEGER,
    "agentsActive" INTEGER,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_daily_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "crm_daily_snapshots_orgId_snapshotDate_idx" ON "crm_daily_snapshots"("orgId", "snapshotDate");

-- CreateIndex
CREATE UNIQUE INDEX "crm_daily_snapshots_orgId_gleapProjectKey_snapshotDate_key" ON "crm_daily_snapshots"("orgId", "gleapProjectKey", "snapshotDate");

-- AddForeignKey
ALTER TABLE "crm_daily_snapshots" ADD CONSTRAINT "crm_daily_snapshots_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

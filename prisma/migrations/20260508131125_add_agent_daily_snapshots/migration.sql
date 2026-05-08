-- CreateTable
CREATE TABLE "agent_daily_snapshots" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "gleapProjectKey" TEXT NOT NULL,
    "snapshotDate" DATE NOT NULL,
    "agentId" TEXT NOT NULL,
    "agentName" TEXT NOT NULL,
    "agentEmail" TEXT,
    "ticketsHandled" INTEGER NOT NULL DEFAULT 0,
    "slaBreached" INTEGER NOT NULL DEFAULT 0,
    "avgResolutionHours" DOUBLE PRECISION,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_daily_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_daily_snapshots_orgId_snapshotDate_idx" ON "agent_daily_snapshots"("orgId", "snapshotDate");

-- CreateIndex
CREATE UNIQUE INDEX "agent_daily_snapshots_orgId_gleapProjectKey_snapshotDate_ag_key" ON "agent_daily_snapshots"("orgId", "gleapProjectKey", "snapshotDate", "agentId");

-- AddForeignKey
ALTER TABLE "agent_daily_snapshots" ADD CONSTRAINT "agent_daily_snapshots_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

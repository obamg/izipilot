-- CreateEnum
CREATE TYPE "AccessTaskAction" AS ENUM ('GRANT', 'CHANGE_LEVEL', 'RENEW', 'REVOKE', 'EXPIRY_REMOVAL');

-- CreateEnum
CREATE TYPE "AccessTaskState" AS ENUM ('READY', 'CLAIMED', 'BLOCKED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AccessTaskEventType" AS ENUM ('RELEASED', 'CLAIMED', 'HANDED_OVER', 'BLOCKED', 'RESUMED', 'PARTIAL_REMOVAL', 'COMPLETED', 'RECONCILED', 'CANCELLED');

-- DropIndex
DROP INDEX "one_nonterminal_request_enforced_in_service";

-- AlterTable
ALTER TABLE "access_requests" ADD COLUMN     "closedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "access_request_versions" ADD COLUMN     "cancelRequestedAt" TIMESTAMP(3),
ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "outcome" TEXT;

-- CreateTable
CREATE TABLE "access_fulfilment_tasks" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "beneficiaryId" TEXT NOT NULL,
    "action" "AccessTaskAction" NOT NULL,
    "state" "AccessTaskState" NOT NULL DEFAULT 'READY',
    "requestVersionId" TEXT,
    "sourceAssignmentId" TEXT,
    "sourceAssignmentVersion" INTEGER,
    "fromLevelId" TEXT,
    "toLevelId" TEXT,
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "expectedAssignmentVersion" INTEGER NOT NULL,
    "claimantId" TEXT,
    "claimedAt" TIMESTAMP(3),
    "blockedReason" TEXT,
    "progress" JSONB,
    "completedAt" TIMESTAMP(3),
    "completionReference" TEXT,
    "completionNote" TEXT,
    "completionMethod" TEXT,
    "completedById" TEXT,
    "outcome" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "releasedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "access_fulfilment_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "access_task_events" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "type" "AccessTaskEventType" NOT NULL,
    "actorId" TEXT,
    "actingAs" TEXT,
    "toUserId" TEXT,
    "reason" TEXT,
    "facts" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "access_task_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "access_fulfilment_tasks_idempotencyKey_key" ON "access_fulfilment_tasks"("idempotencyKey");

-- CreateIndex
CREATE INDEX "access_fulfilment_tasks_orgId_state_idx" ON "access_fulfilment_tasks"("orgId", "state");

-- CreateIndex
CREATE INDEX "access_fulfilment_tasks_orgId_assetId_state_idx" ON "access_fulfilment_tasks"("orgId", "assetId", "state");

-- CreateIndex
CREATE INDEX "access_fulfilment_tasks_requestVersionId_idx" ON "access_fulfilment_tasks"("requestVersionId");

-- CreateIndex
CREATE INDEX "access_fulfilment_tasks_sourceAssignmentId_idx" ON "access_fulfilment_tasks"("sourceAssignmentId");

-- CreateIndex
CREATE INDEX "access_task_events_taskId_occurredAt_idx" ON "access_task_events"("taskId", "occurredAt");

-- AddForeignKey
ALTER TABLE "access_fulfilment_tasks" ADD CONSTRAINT "access_fulfilment_tasks_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_fulfilment_tasks" ADD CONSTRAINT "access_fulfilment_tasks_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "access_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_fulfilment_tasks" ADD CONSTRAINT "access_fulfilment_tasks_requestVersionId_fkey" FOREIGN KEY ("requestVersionId") REFERENCES "access_request_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_task_events" ADD CONSTRAINT "access_task_events_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "access_fulfilment_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ─── SQL brut (phase 3b) — Prisma ne sait pas exprimer ces index partiels ───
-- Ils sont invisibles pour `prisma migrate diff` (qui ignore les index
-- partiels, comme ceux de la phase 1) : aucune migration future ne les
-- supprimera par dérive.

-- D-4 : une demande n'est plus supprimée à l'état terminal ; l'unicité « une
-- demande ouverte par employé/actif » ne porte que sur les demandes non closes.
CREATE UNIQUE INDEX "one_open_request_per_pair"
  ON "access_requests" ("orgId", "beneficiaryId", "assetId")
  WHERE "closedAt" IS NULL;

-- D-20 : au plus une tâche ouverte par version de demande.
CREATE UNIQUE INDEX "one_open_task_per_version"
  ON "access_fulfilment_tasks" ("requestVersionId")
  WHERE "requestVersionId" IS NOT NULL AND "state" IN ('READY', 'CLAIMED', 'BLOCKED');

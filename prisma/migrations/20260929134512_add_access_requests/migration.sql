-- CreateEnum
CREATE TYPE "AccessRequestKind" AS ENUM ('GRANT', 'UPGRADE', 'RENEW', 'REDUCE', 'REVOKE');

-- CreateEnum
CREATE TYPE "AccessRequestState" AS ENUM ('PENDING_APPROVAL', 'CLARIFICATION_REQUIRED', 'REVISION_REQUIRED', 'AUTHORIZED_WAITING_START', 'READY_FOR_FULFILMENT', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ApprovalStageRole" AS ENUM ('DEPARTMENT_HEAD', 'CISO', 'COO');

-- CreateEnum
CREATE TYPE "ApprovalDecision" AS ENUM ('APPROVE', 'REJECT', 'CLARIFY', 'RETURN');

-- CreateTable
CREATE TABLE "access_requests" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "beneficiaryId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "access_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "access_request_versions" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "kind" "AccessRequestKind" NOT NULL,
    "initiatorId" TEXT NOT NULL,
    "targetLevelId" TEXT,
    "justification" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3),
    "departmentSnapshot" TEXT NOT NULL,
    "assignmentVersion" INTEGER NOT NULL,
    "catalogueVersion" INTEGER NOT NULL,
    "state" "AccessRequestState" NOT NULL,
    "exceptionReason" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "access_request_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "access_approval_stages" (
    "id" TEXT NOT NULL,
    "requestVersionId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "role" "ApprovalStageRole" NOT NULL,
    "actorId" TEXT,
    "actedAsPrimary" BOOLEAN,
    "decision" "ApprovalDecision",
    "reason" TEXT,
    "clarificationResponse" TEXT,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "access_approval_stages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "access_requests_orgId_beneficiaryId_idx" ON "access_requests"("orgId", "beneficiaryId");

-- CreateIndex
CREATE INDEX "access_requests_orgId_assetId_idx" ON "access_requests"("orgId", "assetId");

-- CreateIndex
CREATE UNIQUE INDEX "one_nonterminal_request_enforced_in_service" ON "access_requests"("orgId", "beneficiaryId", "assetId");

-- CreateIndex
CREATE INDEX "access_request_versions_requestId_idx" ON "access_request_versions"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "access_request_versions_requestId_versionNumber_key" ON "access_request_versions"("requestId", "versionNumber");

-- CreateIndex
CREATE INDEX "access_approval_stages_requestVersionId_idx" ON "access_approval_stages"("requestVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "access_approval_stages_requestVersionId_sequence_key" ON "access_approval_stages"("requestVersionId", "sequence");

-- AddForeignKey
ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_request_versions" ADD CONSTRAINT "access_request_versions_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "access_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_approval_stages" ADD CONSTRAINT "access_approval_stages_requestVersionId_fkey" FOREIGN KEY ("requestVersionId") REFERENCES "access_request_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

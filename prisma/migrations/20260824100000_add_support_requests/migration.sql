-- CreateEnum
CREATE TYPE "SupportRequestCategory" AS ENUM ('INCIDENT', 'ACCESS', 'EQUIPMENT', 'SOFTWARE', 'DATA', 'IMPROVEMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "SupportRequestPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "SupportRequestStatus" AS ENUM ('SUBMITTED', 'TRIAGED', 'IN_PROGRESS', 'ON_HOLD', 'RESOLVED', 'CLOSED', 'REJECTED', 'CANCELLED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'SUPPORT_REQUEST_NEW';
ALTER TYPE "NotificationType" ADD VALUE 'SUPPORT_REQUEST_UPDATE';
ALTER TYPE "NotificationType" ADD VALUE 'SUPPORT_REQUEST_OVERDUE';

-- AlterTable
ALTER TABLE "departments" ADD COLUMN     "acceptsRequests" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "supportUserId" TEXT;

-- AlterTable
ALTER TABLE "notification_preferences" ADD COLUMN     "supportRequest" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "support_requests" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "assigneeId" TEXT,
    "category" "SupportRequestCategory" NOT NULL DEFAULT 'OTHER',
    "priority" "SupportRequestPriority" NOT NULL DEFAULT 'NORMAL',
    "status" "SupportRequestStatus" NOT NULL DEFAULT 'SUBMITTED',
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3),
    "firstResponseAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "closedById" TEXT,
    "resolutionNote" TEXT,
    "lastOverdueNotifiedAt" TIMESTAMP(3),
    "taskId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "support_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_request_comments" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "isInternal" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_request_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_request_attachments" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_request_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "support_requests_orgId_status_idx" ON "support_requests"("orgId", "status");

-- CreateIndex
CREATE INDEX "support_requests_orgId_departmentId_status_idx" ON "support_requests"("orgId", "departmentId", "status");

-- CreateIndex
CREATE INDEX "support_requests_requesterId_idx" ON "support_requests"("requesterId");

-- CreateIndex
CREATE INDEX "support_requests_assigneeId_idx" ON "support_requests"("assigneeId");

-- CreateIndex
CREATE INDEX "support_requests_orgId_dueAt_idx" ON "support_requests"("orgId", "dueAt");

-- CreateIndex
CREATE INDEX "support_requests_taskId_idx" ON "support_requests"("taskId");

-- CreateIndex
CREATE UNIQUE INDEX "support_requests_orgId_reference_key" ON "support_requests"("orgId", "reference");

-- CreateIndex
CREATE INDEX "support_request_comments_requestId_idx" ON "support_request_comments"("requestId");

-- CreateIndex
CREATE INDEX "support_request_comments_authorId_idx" ON "support_request_comments"("authorId");

-- CreateIndex
CREATE UNIQUE INDEX "support_request_attachments_storageKey_key" ON "support_request_attachments"("storageKey");

-- CreateIndex
CREATE INDEX "support_request_attachments_requestId_idx" ON "support_request_attachments"("requestId");

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_supportUserId_fkey" FOREIGN KEY ("supportUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_requests" ADD CONSTRAINT "support_requests_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_requests" ADD CONSTRAINT "support_requests_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_requests" ADD CONSTRAINT "support_requests_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_requests" ADD CONSTRAINT "support_requests_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_requests" ADD CONSTRAINT "support_requests_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_requests" ADD CONSTRAINT "support_requests_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "sprint_tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_request_comments" ADD CONSTRAINT "support_request_comments_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "support_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_request_comments" ADD CONSTRAINT "support_request_comments_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_request_attachments" ADD CONSTRAINT "support_request_attachments_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "support_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_request_attachments" ADD CONSTRAINT "support_request_attachments_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Ouvre le guichet de demandes internes sur le département IT (D2) de chaque
-- organisation — c'est le périmètre de lancement du module. Les autres
-- départements restent fermés jusqu'à activation explicite côté admin.
UPDATE "departments" SET "acceptsRequests" = true WHERE "code" = 'D2';

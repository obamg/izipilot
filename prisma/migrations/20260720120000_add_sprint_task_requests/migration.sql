-- CreateEnum
CREATE TYPE "RequestKind" AS ENUM ('INPUT', 'REVIEW', 'APPROVAL', 'DATA', 'OTHER');

-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('OPEN', 'RESOLVED', 'DECLINED', 'CANCELLED');

-- CreateTable
CREATE TABLE "sprint_task_requests" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "kind" "RequestKind" NOT NULL DEFAULT 'INPUT',
    "message" TEXT NOT NULL,
    "targetUserId" TEXT,
    "targetDepartmentId" TEXT,
    "targetProductId" TEXT,
    "status" "RequestStatus" NOT NULL DEFAULT 'OPEN',
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolutionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sprint_task_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sprint_task_requests_orgId_status_idx" ON "sprint_task_requests"("orgId", "status");

-- CreateIndex
CREATE INDEX "sprint_task_requests_taskId_idx" ON "sprint_task_requests"("taskId");

-- CreateIndex
CREATE INDEX "sprint_task_requests_targetUserId_idx" ON "sprint_task_requests"("targetUserId");

-- CreateIndex
CREATE INDEX "sprint_task_requests_targetDepartmentId_idx" ON "sprint_task_requests"("targetDepartmentId");

-- CreateIndex
CREATE INDEX "sprint_task_requests_targetProductId_idx" ON "sprint_task_requests"("targetProductId");

-- AddForeignKey
ALTER TABLE "sprint_task_requests" ADD CONSTRAINT "sprint_task_requests_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sprint_task_requests" ADD CONSTRAINT "sprint_task_requests_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "sprint_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sprint_task_requests" ADD CONSTRAINT "sprint_task_requests_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sprint_task_requests" ADD CONSTRAINT "sprint_task_requests_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sprint_task_requests" ADD CONSTRAINT "sprint_task_requests_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sprint_task_requests" ADD CONSTRAINT "sprint_task_requests_targetDepartmentId_fkey" FOREIGN KEY ("targetDepartmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sprint_task_requests" ADD CONSTRAINT "sprint_task_requests_targetProductId_fkey" FOREIGN KEY ("targetProductId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

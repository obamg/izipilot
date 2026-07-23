-- CreateTable
CREATE TABLE "sprint_task_steps" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "ActionStatus" NOT NULL DEFAULT 'TODO',
    "storyPoints" INTEGER,
    "assigneeId" TEXT,
    "createdById" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sprint_task_steps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sprint_task_steps_taskId_idx" ON "sprint_task_steps"("taskId");

-- CreateIndex
CREATE INDEX "sprint_task_steps_orgId_idx" ON "sprint_task_steps"("orgId");

-- CreateIndex
CREATE INDEX "sprint_task_steps_assigneeId_idx" ON "sprint_task_steps"("assigneeId");

-- AddForeignKey
ALTER TABLE "sprint_task_steps" ADD CONSTRAINT "sprint_task_steps_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sprint_task_steps" ADD CONSTRAINT "sprint_task_steps_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "sprint_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sprint_task_steps" ADD CONSTRAINT "sprint_task_steps_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sprint_task_steps" ADD CONSTRAINT "sprint_task_steps_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


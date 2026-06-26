-- CreateEnum
CREATE TYPE "SprintStatus" AS ENUM ('PLANNED', 'ACTIVE', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "sprints" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "goal" TEXT,
    "status" "SprintStatus" NOT NULL DEFAULT 'PLANNED',
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sprints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sprint_tasks" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "sprintId" TEXT,
    "krId" TEXT,
    "departmentId" TEXT,
    "productId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "ActionStatus" NOT NULL DEFAULT 'TODO',
    "priority" "ActionPriority" NOT NULL DEFAULT 'MEDIUM',
    "storyPoints" INTEGER,
    "assigneeId" TEXT,
    "createdById" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "dueDate" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sprint_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sprint_task_comments" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sprint_task_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sprint_capacities" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "sprintId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "capacityPoints" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,

    CONSTRAINT "sprint_capacities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sprints_orgId_status_idx" ON "sprints"("orgId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "sprints_orgId_number_key" ON "sprints"("orgId", "number");

-- CreateIndex
CREATE INDEX "sprint_tasks_orgId_sprintId_status_idx" ON "sprint_tasks"("orgId", "sprintId", "status");

-- CreateIndex
CREATE INDEX "sprint_tasks_assigneeId_idx" ON "sprint_tasks"("assigneeId");

-- CreateIndex
CREATE INDEX "sprint_tasks_krId_idx" ON "sprint_tasks"("krId");

-- CreateIndex
CREATE INDEX "sprint_tasks_departmentId_idx" ON "sprint_tasks"("departmentId");

-- CreateIndex
CREATE INDEX "sprint_tasks_productId_idx" ON "sprint_tasks"("productId");

-- CreateIndex
CREATE INDEX "sprint_task_comments_taskId_idx" ON "sprint_task_comments"("taskId");

-- CreateIndex
CREATE INDEX "sprint_task_comments_authorId_idx" ON "sprint_task_comments"("authorId");

-- CreateIndex
CREATE INDEX "sprint_capacities_orgId_idx" ON "sprint_capacities"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "sprint_capacities_sprintId_userId_key" ON "sprint_capacities"("sprintId", "userId");

-- AddForeignKey
ALTER TABLE "sprints" ADD CONSTRAINT "sprints_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sprints" ADD CONSTRAINT "sprints_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sprint_tasks" ADD CONSTRAINT "sprint_tasks_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sprint_tasks" ADD CONSTRAINT "sprint_tasks_sprintId_fkey" FOREIGN KEY ("sprintId") REFERENCES "sprints"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sprint_tasks" ADD CONSTRAINT "sprint_tasks_krId_fkey" FOREIGN KEY ("krId") REFERENCES "key_results"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sprint_tasks" ADD CONSTRAINT "sprint_tasks_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sprint_tasks" ADD CONSTRAINT "sprint_tasks_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sprint_tasks" ADD CONSTRAINT "sprint_tasks_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sprint_tasks" ADD CONSTRAINT "sprint_tasks_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sprint_task_comments" ADD CONSTRAINT "sprint_task_comments_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "sprint_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sprint_task_comments" ADD CONSTRAINT "sprint_task_comments_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sprint_capacities" ADD CONSTRAINT "sprint_capacities_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sprint_capacities" ADD CONSTRAINT "sprint_capacities_sprintId_fkey" FOREIGN KEY ("sprintId") REFERENCES "sprints"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sprint_capacities" ADD CONSTRAINT "sprint_capacities_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

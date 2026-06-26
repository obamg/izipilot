-- CreateTable
CREATE TABLE "standup_entries" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "sprintId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "yesterday" TEXT,
    "today" TEXT,
    "blockers" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "standup_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "standup_entries_orgId_sprintId_date_idx" ON "standup_entries"("orgId", "sprintId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "standup_entries_sprintId_userId_date_key" ON "standup_entries"("sprintId", "userId", "date");

-- AddForeignKey
ALTER TABLE "standup_entries" ADD CONSTRAINT "standup_entries_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "standup_entries" ADD CONSTRAINT "standup_entries_sprintId_fkey" FOREIGN KEY ("sprintId") REFERENCES "sprints"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "standup_entries" ADD CONSTRAINT "standup_entries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

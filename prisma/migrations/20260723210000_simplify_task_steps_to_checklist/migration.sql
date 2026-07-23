-- Simplify task steps from full sub-tasks to a plain checklist:
-- title + done, ordered. Existing DONE statuses are preserved as checked.

-- DropForeignKey
ALTER TABLE "sprint_task_steps" DROP CONSTRAINT "sprint_task_steps_assigneeId_fkey";

-- DropIndex
DROP INDEX "sprint_task_steps_assigneeId_idx";

-- AlterTable: add the checkbox first so we can carry the status over.
ALTER TABLE "sprint_task_steps" ADD COLUMN "done" BOOLEAN NOT NULL DEFAULT false;

UPDATE "sprint_task_steps" SET "done" = true WHERE "status" = 'DONE';

-- AlterTable: drop the sub-task-only columns.
ALTER TABLE "sprint_task_steps" DROP COLUMN "assigneeId",
DROP COLUMN "completedAt",
DROP COLUMN "status",
DROP COLUMN "storyPoints";

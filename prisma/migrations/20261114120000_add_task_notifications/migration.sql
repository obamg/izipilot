-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'TASK_ASSIGNED';
ALTER TYPE "NotificationType" ADD VALUE 'TASK_DUE_REMINDER';
ALTER TYPE "NotificationType" ADD VALUE 'TASK_OVERDUE_TEAM';

-- AlterTable
ALTER TABLE "notification_preferences" ADD COLUMN "taskAssigned" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "taskDue" BOOLEAN NOT NULL DEFAULT true;

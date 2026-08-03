-- AlterEnum
ALTER TYPE "RecurrenceFrequency" ADD VALUE 'PER_SPRINT';

-- AlterTable
ALTER TABLE "recurring_tasks" ALTER COLUMN "nextRunAt" DROP NOT NULL;


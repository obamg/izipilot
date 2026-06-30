-- Lien vers le rapport de tâche (document externe) sur chaque carte du board.

-- AlterTable
ALTER TABLE "sprint_tasks" ADD COLUMN "reportUrl" TEXT;

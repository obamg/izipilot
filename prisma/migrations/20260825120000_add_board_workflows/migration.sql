-- CreateEnum
CREATE TYPE "BoardColumnCategory" AS ENUM ('TODO', 'IN_PROGRESS', 'BLOCKED', 'DONE', 'CANCELLED');

-- AlterTable
ALTER TABLE "departments" ADD COLUMN     "workflowId" TEXT;

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "workflowId" TEXT;

-- AlterTable
ALTER TABLE "sprint_tasks" ADD COLUMN     "columnId" TEXT;

-- CreateTable
CREATE TABLE "board_workflows" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "board_workflows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "board_columns" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#5f6e7a',
    "category" "BoardColumnCategory" NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "wipLimit" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "board_columns_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "board_workflows_orgId_idx" ON "board_workflows"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "board_workflows_orgId_name_key" ON "board_workflows"("orgId", "name");

-- CreateIndex
CREATE INDEX "board_columns_workflowId_sortOrder_idx" ON "board_columns"("workflowId", "sortOrder");

-- CreateIndex
CREATE INDEX "board_columns_orgId_idx" ON "board_columns"("orgId");

-- CreateIndex
CREATE INDEX "sprint_tasks_columnId_idx" ON "sprint_tasks"("columnId");

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "board_workflows"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "board_workflows"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sprint_tasks" ADD CONSTRAINT "sprint_tasks_columnId_fkey" FOREIGN KEY ("columnId") REFERENCES "board_columns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "board_workflows" ADD CONSTRAINT "board_workflows_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "board_columns" ADD CONSTRAINT "board_columns_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "board_columns" ADD CONSTRAINT "board_columns_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "board_workflows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Backfill : chaque org reçoit un flux par défaut reproduisant à l'identique
-- les cinq colonnes codées en dur jusqu'ici, puis toute tâche existante est
-- rattachée à la colonne correspondant à son statut. Après cette migration le
-- tableau est visuellement inchangé — seule la source des colonnes a bougé.
-- ---------------------------------------------------------------------------

INSERT INTO "board_workflows" ("id", "orgId", "name", "description", "isDefault", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, o."id", 'Flux par défaut',
       'Colonnes standard appliquées à toute équipe sans flux dédié.',
       true, NOW(), NOW()
FROM "organizations" o;

INSERT INTO "board_columns" ("id", "orgId", "workflowId", "label", "color", "category", "sortOrder", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, w."orgId", w."id", c.label, c.color,
       c.category::"BoardColumnCategory", c.sort_order, NOW(), NOW()
FROM "board_workflows" w
CROSS JOIN (VALUES
  ('À faire',  '#5f6e7a', 'TODO',        0),
  ('En cours', '#185FA5', 'IN_PROGRESS', 1),
  ('Bloquée',  '#e23c4a', 'BLOCKED',     2),
  ('Terminée', '#1d9e75', 'DONE',        3),
  ('Annulée',  '#8a9aa5', 'CANCELLED',   4)
) AS c(label, color, category, sort_order)
WHERE w."isDefault" = true;

UPDATE "sprint_tasks" t
SET "columnId" = c."id"
FROM "board_columns" c
JOIN "board_workflows" w ON w."id" = c."workflowId"
WHERE w."orgId" = t."orgId"
  AND w."isDefault" = true
  AND c."category"::text = t."status"::text;


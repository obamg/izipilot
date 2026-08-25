-- AlterTable
ALTER TABLE "actions" ADD COLUMN     "columnId" TEXT;

-- CreateIndex
CREATE INDEX "actions_columnId_idx" ON "actions"("columnId");

-- AddForeignKey
ALTER TABLE "actions" ADD CONSTRAINT "actions_columnId_fkey" FOREIGN KEY ("columnId") REFERENCES "board_columns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Backfill : chaque action rejoint la colonne de SON équipe correspondant à son
-- statut. L'équipe vient du KR (action → key_result → objective → produit ou
-- département) ; le produit prime sur le département, comme partout ailleurs,
-- et à défaut de flux dédié on retombe sur le flux par défaut de l'org.
--
-- DISTINCT ON est indispensable : un flux peut avoir plusieurs colonnes d'une
-- même catégorie (deux colonnes « En cours », par exemple). Sans lui, le JOIN
-- rendrait plusieurs lignes et Postgres en choisirait une au hasard ; on veut
-- la première dans l'ordre d'affichage.
-- ---------------------------------------------------------------------------

UPDATE "actions" a
SET "columnId" = pick.column_id
FROM (
  SELECT DISTINCT ON (a2.id) a2.id AS action_id, c.id AS column_id
  FROM "actions" a2
  JOIN "key_results" kr ON kr.id = a2."krId"
  JOIN "objectives" o ON o.id = kr."objectiveId"
  LEFT JOIN "products" p ON p.id = o."productId"
  LEFT JOIN "departments" d ON d.id = o."departmentId"
  JOIN "board_workflows" w
    ON w."orgId" = a2."orgId"
   AND w.id = COALESCE(
         p."workflowId",
         d."workflowId",
         (SELECT dw.id FROM "board_workflows" dw
           WHERE dw."orgId" = a2."orgId" AND dw."isDefault" LIMIT 1)
       )
  JOIN "board_columns" c
    ON c."workflowId" = w.id
   AND c.category::text = a2.status::text
  ORDER BY a2.id, c."sortOrder", c.label
) pick
WHERE a.id = pick.action_id;


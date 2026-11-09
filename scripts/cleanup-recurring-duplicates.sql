-- Nettoyage ponctuel des doublons de tâches récurrentes (cf. PR #76).
--
-- Pour chaque modèle récurrent, garde la carte non terminée la plus récente et
-- passe les autres en CANCELLED, dans la colonne « Annulée » de leur flux.
--
-- Simulation (ROLLBACK) :
--   psql -U izipilot -d izipilot -v apply=false -f cleanup-recurring-duplicates.sql
-- Application :
--   psql -U izipilot -d izipilot -v apply=true  -f cleanup-recurring-duplicates.sql

\set ON_ERROR_STOP on
BEGIN;

CREATE TEMP TABLE dup ON COMMIT DROP AS
SELECT id FROM (
  SELECT t.id,
         row_number() OVER (PARTITION BY t."recurringTaskId"
                            ORDER BY t."createdAt" DESC, t.id DESC) AS rn
  FROM sprint_tasks t
  WHERE t."recurringTaskId" IS NOT NULL
    AND t.status IN ('TODO', 'IN_PROGRESS', 'BLOCKED')
) x
WHERE rn > 1;

-- Aperçu : doublons par modèle.
SELECT r.title, count(*) AS cartes_annulees
FROM dup d
JOIN sprint_tasks t ON t.id = d.id
JOIN recurring_tasks r ON r.id = t."recurringTaskId"
GROUP BY r.title
ORDER BY 2 DESC;

UPDATE sprint_tasks t
SET status = 'CANCELLED',
    "columnId" = (
      SELECT c2.id
      FROM board_columns c1
      JOIN board_columns c2 ON c2."workflowId" = c1."workflowId"
                           AND c2.category = 'CANCELLED'
      WHERE c1.id = t."columnId"
      ORDER BY c2."sortOrder"
      LIMIT 1
    ),
    "updatedAt" = now()
FROM dup d
WHERE t.id = d.id;

\if :apply
COMMIT;
\echo 'Appliqué.'
\else
ROLLBACK;
\echo 'Simulation : rien n a été modifié (relancer avec -v apply=true).'
\endif

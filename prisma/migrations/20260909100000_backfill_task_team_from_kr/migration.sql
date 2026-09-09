-- Rattrapage : équipe d'une tâche déduite de l'entité de son KR.
--
-- « Équipe » et « Key Result lié » étaient deux champs facultatifs et
-- indépendants du formulaire de tâche, mais seul le premier alimente
-- productId / departmentId — ce que lisent le filtre d'équipe, le flux de
-- colonnes du tableau et la pastille de la carte. Une tâche créée sur un KR de
-- P6 « Carte Virtuelle » sans équipe choisie n'apparaissait donc sous aucun
-- filtre d'équipe (18 tâches en production au 2026-09-09, dont 13 pour P6).
--
-- Le champ est désormais obligatoire (lib/validations/sprints.ts), ce qui
-- protège l'avenir mais ne répare rien. Ici on répare l'existant, pour les
-- seules lignes qui portent un KR : son objectif dit à quelle entité la tâche
-- sert. On ne touche QUE les lignes sans aucune étiquette — une équipe posée à
-- la main, même contredisant le KR, reste intacte.
--
-- Restent 155 tâches sans équipe NI KR : rien ne permet de deviner leur
-- rattachement, elles seront étiquetées à la main (le formulaire l'exige
-- désormais à la première modification).

UPDATE "sprint_tasks" t
SET "productId"    = o."productId",
    "departmentId" = o."departmentId"
FROM "key_results" kr
JOIN "objectives" o ON o."id" = kr."objectiveId"
WHERE t."krId" = kr."id"
  AND t."orgId" = o."orgId"
  AND t."productId" IS NULL
  AND t."departmentId" IS NULL
  AND (o."productId" IS NOT NULL OR o."departmentId" IS NOT NULL);

-- Même correction pour les modèles récurrents, sinon chaque sprint réengendre
-- des tâches sans équipe.
UPDATE "recurring_tasks" r
SET "productId"    = o."productId",
    "departmentId" = o."departmentId"
FROM "key_results" kr
JOIN "objectives" o ON o."id" = kr."objectiveId"
WHERE r."krId" = kr."id"
  AND r."orgId" = o."orgId"
  AND r."productId" IS NULL
  AND r."departmentId" IS NULL
  AND (o."productId" IS NOT NULL OR o."departmentId" IS NOT NULL);

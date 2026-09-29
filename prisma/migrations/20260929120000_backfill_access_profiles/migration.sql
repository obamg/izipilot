-- Rattrapage : un AccessProfile ACTIVE pour chaque utilisateur existant qui
-- n'en a pas encore (spec §9, module de gestion des accès — phase 1). Sans
-- ce rattrapage, tous les utilisateurs créés avant la migration
-- 20260928120000 n'ont aucun profil : PATCH /api/access/profiles/[userId]
-- leur renvoie 404 et le panneau des employés sans département principal les
-- ignore silencieusement.
--
-- primaryDepartmentId n'est renseigné que si l'utilisateur appartient à
-- EXACTEMENT un département — sinon NULL, à choisir par le CEO via
-- /access/roles (ConfigIssuesPanel gère déjà ce cas, Ruling C). Idempotent
-- (ON CONFLICT ... DO NOTHING sur la contrainte unique userId) : rejouable
-- sans risque si exécuté deux fois.

INSERT INTO "access_profiles" ("id", "orgId", "userId", "primaryDepartmentId", "lifecycle", "revision", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, u."orgId", u."id", single_dept."departmentId", 'ACTIVE', 1, NOW(), NOW()
FROM "users" u
LEFT JOIN (
  SELECT "userId", MIN("departmentId") AS "departmentId"
  FROM "department_members"
  GROUP BY "userId"
  HAVING COUNT(*) = 1
) single_dept ON single_dept."userId" = u."id"
ON CONFLICT ("userId") DO NOTHING;

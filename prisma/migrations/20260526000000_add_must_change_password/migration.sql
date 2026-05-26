-- Force tous les utilisateurs existants à changer leur mot de passe par défaut
ALTER TABLE "users" ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;

UPDATE "users" SET "mustChangePassword" = true WHERE "passwordHash" IS NOT NULL;

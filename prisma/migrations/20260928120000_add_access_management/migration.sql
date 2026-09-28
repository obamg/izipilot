-- CreateEnum
CREATE TYPE "AccessModuleRole" AS ENUM ('IT_ACCESS_OPERATOR', 'HR', 'CISO', 'COO', 'ASSET_ADMINISTRATOR', 'AUDIT_VIEWER', 'DEPARTMENT_HEAD');

-- CreateEnum
CREATE TYPE "AccessLifecycle" AS ENUM ('ACTIVE', 'OFFBOARDING', 'DEPARTED');

-- CreateEnum
CREATE TYPE "AccessAssignmentStatus" AS ENUM ('ACTIVE', 'EXPIRED_REMOVAL_PENDING', 'REVOKED');

-- CreateEnum
CREATE TYPE "AccessVerification" AS ENUM ('IMPORTED_UNREVIEWED', 'OWNER_CONFIRMED');

-- CreateEnum
CREATE TYPE "AccessAssignmentSource" AS ENUM ('LEGACY_IMPORT', 'REQUEST');

-- CreateTable
CREATE TABLE "access_profiles" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "primaryDepartmentId" TEXT,
    "lifecycle" "AccessLifecycle" NOT NULL DEFAULT 'ACTIVE',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "access_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "access_role_assignments" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "role" "AccessModuleRole" NOT NULL,
    "userId" TEXT,
    "departmentId" TEXT,
    "backupUserId" TEXT,
    "primaryUnavailable" BOOLEAN NOT NULL DEFAULT false,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "access_role_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "access_assets" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "ownerId" TEXT,
    "backupOwnerId" TEXT,
    "requestsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "catalogueVersion" INTEGER NOT NULL DEFAULT 1,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "sourceLabel" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "access_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "access_levels" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priority" INTEGER,
    "isAdmin" BOOLEAN,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "sourceLabel" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "access_levels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "access_assignments" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "levelId" TEXT,
    "status" "AccessAssignmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "verification" "AccessVerification",
    "source" "AccessAssignmentSource" NOT NULL DEFAULT 'LEGACY_IMPORT',
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "grantedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "access_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "access_assignment_events" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "beforeLevelId" TEXT,
    "afterLevelId" TEXT,
    "actorId" TEXT,
    "actorRole" "AccessModuleRole",
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT,
    "outcome" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "access_assignment_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "access_audit_events" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT NOT NULL,
    "actorRole" "AccessModuleRole",
    "primaryCoveredId" TEXT,
    "scopeType" TEXT NOT NULL,
    "scopeId" TEXT,
    "eventType" TEXT NOT NULL,
    "objectType" TEXT NOT NULL,
    "objectId" TEXT NOT NULL,
    "objectVersion" INTEGER,
    "beneficiaryId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,
    "outcome" TEXT NOT NULL,
    "correlationId" TEXT,

    CONSTRAINT "access_audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "access_profiles_userId_key" ON "access_profiles"("userId");

-- CreateIndex
CREATE INDEX "access_profiles_orgId_lifecycle_idx" ON "access_profiles"("orgId", "lifecycle");

-- CreateIndex
CREATE UNIQUE INDEX "access_role_assignments_departmentId_key" ON "access_role_assignments"("departmentId");

-- CreateIndex
CREATE INDEX "access_role_assignments_orgId_role_idx" ON "access_role_assignments"("orgId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "access_role_assignments_orgId_role_userId_key" ON "access_role_assignments"("orgId", "role", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "access_role_assignments_orgId_departmentId_key" ON "access_role_assignments"("orgId", "departmentId");

-- CreateIndex
CREATE UNIQUE INDEX "access_assets_orgId_name_key" ON "access_assets"("orgId", "name");

-- CreateIndex
CREATE INDEX "access_levels_assetId_idx" ON "access_levels"("assetId");

-- CreateIndex
CREATE UNIQUE INDEX "access_levels_assetId_name_key" ON "access_levels"("assetId", "name");

-- CreateIndex
CREATE INDEX "access_assignments_orgId_assetId_idx" ON "access_assignments"("orgId", "assetId");

-- CreateIndex
CREATE INDEX "access_assignments_orgId_userId_idx" ON "access_assignments"("orgId", "userId");

-- CreateIndex
CREATE INDEX "access_assignments_orgId_status_idx" ON "access_assignments"("orgId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "access_assignments_userId_assetId_key" ON "access_assignments"("userId", "assetId");

-- CreateIndex
CREATE INDEX "access_assignment_events_orgId_assignmentId_idx" ON "access_assignment_events"("orgId", "assignmentId");

-- CreateIndex
CREATE INDEX "access_audit_events_orgId_occurredAt_idx" ON "access_audit_events"("orgId", "occurredAt");

-- CreateIndex
CREATE INDEX "access_audit_events_orgId_objectType_objectId_idx" ON "access_audit_events"("orgId", "objectType", "objectId");

-- CreateIndex
CREATE INDEX "access_audit_events_orgId_beneficiaryId_idx" ON "access_audit_events"("orgId", "beneficiaryId");

-- CreateIndex
CREATE INDEX "access_audit_events_orgId_actorId_idx" ON "access_audit_events"("orgId", "actorId");

-- CreateIndex
CREATE INDEX "access_audit_events_orgId_correlationId_idx" ON "access_audit_events"("orgId", "correlationId");

-- AddForeignKey
ALTER TABLE "access_profiles" ADD CONSTRAINT "access_profiles_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_profiles" ADD CONSTRAINT "access_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_profiles" ADD CONSTRAINT "access_profiles_primaryDepartmentId_fkey" FOREIGN KEY ("primaryDepartmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_role_assignments" ADD CONSTRAINT "access_role_assignments_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_role_assignments" ADD CONSTRAINT "access_role_assignments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_role_assignments" ADD CONSTRAINT "access_role_assignments_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_role_assignments" ADD CONSTRAINT "access_role_assignments_backupUserId_fkey" FOREIGN KEY ("backupUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_assets" ADD CONSTRAINT "access_assets_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_assets" ADD CONSTRAINT "access_assets_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_assets" ADD CONSTRAINT "access_assets_backupOwnerId_fkey" FOREIGN KEY ("backupOwnerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_levels" ADD CONSTRAINT "access_levels_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "access_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_assignments" ADD CONSTRAINT "access_assignments_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_assignments" ADD CONSTRAINT "access_assignments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_assignments" ADD CONSTRAINT "access_assignments_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "access_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_assignments" ADD CONSTRAINT "access_assignments_levelId_fkey" FOREIGN KEY ("levelId") REFERENCES "access_levels"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_assignment_events" ADD CONSTRAINT "access_assignment_events_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_assignment_events" ADD CONSTRAINT "access_assignment_events_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "access_assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_audit_events" ADD CONSTRAINT "access_audit_events_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Un seul titulaire CISO et un seul titulaire COO par organisation (routage déterministe, spec §3).
CREATE UNIQUE INDEX "access_role_assignments_org_ciso_unique"
  ON "access_role_assignments" ("orgId")
  WHERE "role" = 'CISO' AND "userId" IS NOT NULL;

CREATE UNIQUE INDEX "access_role_assignments_org_coo_unique"
  ON "access_role_assignments" ("orgId")
  WHERE "role" = 'COO' AND "userId" IS NOT NULL;

-- Une affectation de rôle porte soit un titulaire (userId), soit un département
-- (DEPARTMENT_HEAD), jamais aucun des deux ni les deux à la fois.
ALTER TABLE "access_role_assignments"
  ADD CONSTRAINT "access_role_assignments_holder_check"
  CHECK (
    ("role" = 'DEPARTMENT_HEAD' AND "departmentId" IS NOT NULL AND "userId" IS NULL)
    OR ("role" != 'DEPARTMENT_HEAD' AND "userId" IS NOT NULL AND "departmentId" IS NULL)
  );

-- Le suppléant n'est jamais la même personne que le titulaire.
ALTER TABLE "access_role_assignments"
  ADD CONSTRAINT "access_role_assignments_backup_distinct_check"
  CHECK ("backupUserId" IS NULL OR "backupUserId" != "userId");

-- Priorité positive uniquement si renseignée (les brouillons d'import ont priority NULL).
ALTER TABLE "access_levels"
  ADD CONSTRAINT "access_levels_priority_positive_check"
  CHECK ("priority" IS NULL OR "priority" > 0);

-- Priorité unique parmi les niveaux activés et non archivés d'un même actif
-- (la spec autorise des priorités non définies ou dupliquées sur des brouillons
-- désactivés, mais jamais sur deux niveaux sélectionnables du même actif).
CREATE UNIQUE INDEX "access_levels_asset_priority_unique"
  ON "access_levels" ("assetId", "priority")
  WHERE "enabled" = true AND "archivedAt" IS NULL AND "priority" IS NOT NULL;

-- Le propriétaire de secours d'un actif n'est jamais le propriétaire principal.
ALTER TABLE "access_assets"
  ADD CONSTRAINT "access_assets_backup_owner_distinct_check"
  CHECK ("backupOwnerId" IS NULL OR "backupOwnerId" != "ownerId");


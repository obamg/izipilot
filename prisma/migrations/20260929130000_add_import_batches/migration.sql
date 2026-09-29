-- CreateEnum
CREATE TYPE "ImportMode" AS ENUM ('CATALOGUE_SEED', 'BASELINE_ASSIGNMENTS');

-- CreateEnum
CREATE TYPE "ImportRowOutcome" AS ENUM ('MATCHED', 'DRAFT_CREATED', 'TO_CREATE', 'NOOP_UNCHANGED', 'NOOP_DUPLICATE', 'UNRESOLVED', 'CONFLICT');

-- CreateTable
CREATE TABLE "import_batches" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "mode" "ImportMode" NOT NULL,
    "fileHash" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "totalRows" INTEGER NOT NULL,
    "committedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_rows" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "rowIndex" INTEGER NOT NULL,
    "sourceFields" JSONB NOT NULL,
    "resolvedAssetId" TEXT,
    "resolvedLevelId" TEXT,
    "resolvedUserId" TEXT,
    "outcome" "ImportRowOutcome" NOT NULL,
    "reason" TEXT,

    CONSTRAINT "import_rows_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "import_batches_orgId_mode_createdAt_idx" ON "import_batches"("orgId", "mode", "createdAt");

-- CreateIndex
CREATE INDEX "import_rows_batchId_idx" ON "import_rows"("batchId");

-- AddForeignKey
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "import_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

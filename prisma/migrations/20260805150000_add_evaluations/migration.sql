-- CreateTable
CREATE TABLE "evaluations" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "evaluatorId" TEXT NOT NULL,
    "periodMonth" INTEGER NOT NULL,
    "periodYear" INTEGER NOT NULL,
    "scoreQuality" INTEGER NOT NULL,
    "scoreCollaboration" INTEGER NOT NULL,
    "scoreInitiative" INTEGER NOT NULL,
    "deliveryScore" DECIMAL(3,1),
    "overall" DECIMAL(3,1) NOT NULL,
    "comment" TEXT,
    "statsSnapshot" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "evaluations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "evaluations_orgId_periodYear_periodMonth_idx" ON "evaluations"("orgId", "periodYear", "periodMonth");

-- CreateIndex
CREATE INDEX "evaluations_subjectId_idx" ON "evaluations"("subjectId");

-- CreateIndex
CREATE UNIQUE INDEX "evaluations_subjectId_evaluatorId_periodMonth_periodYear_key" ON "evaluations"("subjectId", "evaluatorId", "periodMonth", "periodYear");

-- AddForeignKey
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_evaluatorId_fkey" FOREIGN KEY ("evaluatorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

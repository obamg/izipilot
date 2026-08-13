-- CreateEnum
CREATE TYPE "AppraisalStatus" AS ENUM ('SELF_ASSESSMENT', 'MANAGER_ASSESSMENT', 'SHARED', 'ACKNOWLEDGED');

-- CreateTable
CREATE TABLE "appraisals" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "managerId" TEXT NOT NULL,
    "quarter" "Quarter" NOT NULL,
    "year" INTEGER NOT NULL,
    "status" "AppraisalStatus" NOT NULL DEFAULT 'SELF_ASSESSMENT',
    "selfCompetencies" JSONB,
    "selfComment" TEXT,
    "selfSubmittedAt" TIMESTAMP(3),
    "managerCompetencies" JSONB,
    "strengths" TEXT,
    "improvements" TEXT,
    "developmentPlan" TEXT,
    "managerComment" TEXT,
    "managerSubmittedAt" TIMESTAMP(3),
    "goals" JSONB,
    "monthlyRollup" JSONB,
    "overall" DECIMAL(3,1),
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgeComment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "appraisals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "appraisals_orgId_year_quarter_idx" ON "appraisals"("orgId", "year", "quarter");

-- CreateIndex
CREATE INDEX "appraisals_managerId_idx" ON "appraisals"("managerId");

-- CreateIndex
CREATE UNIQUE INDEX "appraisals_subjectId_quarter_year_key" ON "appraisals"("subjectId", "quarter", "year");

-- AddForeignKey
ALTER TABLE "appraisals" ADD CONSTRAINT "appraisals_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appraisals" ADD CONSTRAINT "appraisals_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appraisals" ADD CONSTRAINT "appraisals_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterEnum
ALTER TYPE "EntityType" ADD VALUE 'COMPANY';

-- AlterTable
ALTER TABLE "key_results" ADD COLUMN     "isInverse" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "objectives" ADD COLUMN     "parentId" TEXT;

-- CreateIndex
CREATE INDEX "objectives_parentId_idx" ON "objectives"("parentId");

-- AddForeignKey
ALTER TABLE "objectives" ADD CONSTRAINT "objectives_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "objectives"("id") ON DELETE SET NULL ON UPDATE CASCADE;

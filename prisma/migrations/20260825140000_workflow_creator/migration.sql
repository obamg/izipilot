-- AlterTable
ALTER TABLE "board_workflows" ADD COLUMN     "createdById" TEXT;

-- AddForeignKey
ALTER TABLE "board_workflows" ADD CONSTRAINT "board_workflows_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


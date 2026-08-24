-- AlterTable
ALTER TABLE "support_requests" ADD COLUMN     "requestedAssigneeId" TEXT;

-- AddForeignKey
ALTER TABLE "support_requests" ADD CONSTRAINT "support_requests_requestedAssigneeId_fkey" FOREIGN KEY ("requestedAssigneeId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


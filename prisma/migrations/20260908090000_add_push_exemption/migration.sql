-- AlterTable
ALTER TABLE "users" ADD COLUMN     "pushExemptAt" TIMESTAMP(3),
ADD COLUMN     "pushExemptReason" TEXT;


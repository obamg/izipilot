-- CreateEnum
CREATE TYPE "AlertSource" AS ENUM ('AUTOMATIC', 'MANUAL');

-- AlterTable
ALTER TABLE "alerts" ADD COLUMN "source" "AlertSource" NOT NULL DEFAULT 'AUTOMATIC';

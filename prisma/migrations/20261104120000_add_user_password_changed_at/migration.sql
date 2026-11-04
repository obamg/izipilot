-- Sessions (JWT) issued before this instant are revoked on the next revalidation.
ALTER TABLE "users" ADD COLUMN "passwordChangedAt" TIMESTAMP(3);

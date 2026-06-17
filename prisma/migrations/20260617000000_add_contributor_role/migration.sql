-- Add CONTRIBUTOR value to UserRole enum
-- PostgreSQL requires ALTER TYPE to add enum values
ALTER TYPE "UserRole" ADD VALUE 'CONTRIBUTOR';

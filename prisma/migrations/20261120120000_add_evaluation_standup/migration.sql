-- Point du jour dans la notation mensuelle : note auto figée + absences justifiées.
ALTER TABLE "evaluations" ADD COLUMN "standupScore" DECIMAL(3,1),
ADD COLUMN "excusedDays" INTEGER NOT NULL DEFAULT 0;

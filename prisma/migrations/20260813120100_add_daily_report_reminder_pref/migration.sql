-- Per-user opt-out for the daily standup reminder (default on).
ALTER TABLE "notification_preferences" ADD COLUMN "dailyReportReminder" BOOLEAN NOT NULL DEFAULT true;

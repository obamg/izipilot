-- Adds the indexes called out by the security/perf audit and drops one
-- single-column index that the composite [orgId, type, isResolved] makes
-- redundant. Tables are small at IziChange scale, so plain CREATE INDEX
-- runs fast and the brief locks are not user-visible.

-- Notification: support the check-alerts dedup query
--   `notifications.none.alertId = X AND isSent = true`
CREATE INDEX "notifications_alertId_idx" ON "notifications"("alertId");

-- Alert: redundant single-column index removed in favour of the composite,
-- and resolvedBy gets its own index for "alerts I resolved" joins.
DROP INDEX "alerts_isResolved_idx";
CREATE INDEX "alerts_resolvedBy_idx" ON "alerts"("resolvedBy");

-- Decision: nullable FKs that had no index — joins on them did seq scans.
CREATE INDEX "decisions_alertId_idx" ON "decisions"("alertId");
CREATE INDEX "decisions_sessionId_idx" ON "decisions"("sessionId");

-- Action: createdBy for "my created actions" filters.
CREATE INDEX "actions_createdById_idx" ON "actions"("createdById");

-- KeyResult: every active-KR query filters on (orgId, isActive, deletedAt)
-- together; a covering composite avoids per-row deletedAt checks.
CREATE INDEX "key_results_orgId_isActive_deletedAt_idx"
  ON "key_results"("orgId", "isActive", "deletedAt");

-- ─── Migration: KPI Audience Control ─────────────────────────────────────────
--
-- Adds an `audience` field to kpis so org admins can restrict which KPIs
-- are visible to contributors vs managers/admins.
--
-- 'everyone'        → all org users can see this KPI (default)
-- 'management_only' → only users with role 'admin' or 'manager' can see it
--
-- Note: A future Phase 4 Teams module will complement this with team-scoped
-- visibility using the existing kpis.team_id column — no further schema change
-- will be needed at that point.

ALTER TABLE kpis
  ADD COLUMN IF NOT EXISTS audience TEXT NOT NULL DEFAULT 'everyone'
    CHECK (audience IN ('everyone', 'management_only'));

-- Phase 7: Performance Reviews + Custom Field Values
-- Adds performance_review as a 4th meeting type and the field_values
-- storage table that backs the /admin/fields custom field system.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Extend meeting_type CHECK to include performance_review
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE meetings DROP CONSTRAINT IF EXISTS meetings_meeting_type_check;
ALTER TABLE meetings
  ADD CONSTRAINT meetings_meeting_type_check
  CHECK (meeting_type IN ('one_on_one', 'team_meeting', 'project_meeting', 'performance_review'));

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Performance-review-specific columns on meetings
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE meetings
  ADD COLUMN IF NOT EXISTS review_period     VARCHAR(100),   -- e.g. "Q1 2026", "Annual 2025"
  ADD COLUMN IF NOT EXISTS overall_rating    TEXT,           -- exceeds | meets | development_required | unsatisfactory
  ADD COLUMN IF NOT EXISTS goals_next_period TEXT;           -- agreed goals for the next review period

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. field_values — stores values for custom field definitions (/admin/fields)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS field_values (
  id               UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id  UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entity_type      TEXT        NOT NULL,   -- 'meeting', 'user', 'kpi', etc.
  entity_id        UUID        NOT NULL,
  field_key        TEXT        NOT NULL,
  value            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id, entity_type, entity_id, field_key)
);

ALTER TABLE field_values ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org users read field values"
  ON field_values FOR SELECT
  USING (organization_id = public.user_organization_id());

CREATE POLICY "Org users write field values"
  ON field_values FOR ALL
  USING (organization_id = public.user_organization_id());

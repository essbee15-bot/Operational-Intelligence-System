-- ============================================================
-- Migration: Meeting Dimension Scores
-- Per-dimension scores for each meeting, replacing single-score model
-- ============================================================

CREATE TABLE IF NOT EXISTS meeting_dimension_scores (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id     UUID        NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  dimension_key  TEXT        NOT NULL,
  self_score     INTEGER     CHECK (self_score     BETWEEN 1 AND 9),
  manager_score  INTEGER     CHECK (manager_score  BETWEEN 1 AND 9),
  adjusted_score INTEGER     CHECK (adjusted_score BETWEEN 1 AND 9),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (meeting_id, dimension_key)
);

ALTER TABLE meeting_dimension_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant isolation for meeting_dimension_scores" ON meeting_dimension_scores
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM meetings m
      WHERE m.id = meeting_id
        AND m.organization_id = public.user_organization_id()
    )
  );

CREATE POLICY "Org members can manage meeting_dimension_scores" ON meeting_dimension_scores
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM meetings m
      WHERE m.id = meeting_id
        AND m.organization_id = public.user_organization_id()
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- Migrate existing one_on_one_scores data into the new table
-- Map old single score → 'adaptability' dimension (best-effort mapping)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO meeting_dimension_scores (meeting_id, dimension_key, self_score, manager_score, adjusted_score, updated_at)
SELECT
  oos.meeting_id,
  'adaptability',
  oos.self_score,
  oos.manager_score,
  oos.adjusted_score,
  oos.updated_at
FROM one_on_one_scores oos
ON CONFLICT (meeting_id, dimension_key) DO NOTHING;

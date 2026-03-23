-- ============================================================
-- Migration: Score Dimensions
-- Adds configurable scoring dimensions (system defaults + org overrides)
-- ============================================================

CREATE TABLE IF NOT EXISTS score_dimensions (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID        REFERENCES organizations(id) ON DELETE CASCADE,  -- NULL = system default
  key             TEXT        NOT NULL,
  name            TEXT        NOT NULL,
  description     TEXT,
  source          TEXT        NOT NULL CHECK (source IN ('system', 'human')),
  is_active       BOOLEAN     NOT NULL DEFAULT true,
  display_order   INTEGER     NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, key)
);

ALTER TABLE score_dimensions ENABLE ROW LEVEL SECURITY;

-- System defaults (org NULL) visible to everyone; org-specific visible to org members
CREATE POLICY "Score dimensions visible to org members" ON score_dimensions
  FOR SELECT USING (
    organization_id IS NULL
    OR organization_id = public.user_organization_id()
  );

-- Org admins can manage their own custom dimensions
CREATE POLICY "Org admins can manage score dimensions" ON score_dimensions
  FOR ALL USING (
    organization_id = public.user_organization_id()
    AND public.is_org_admin()
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- Seed 6 system default dimensions
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO score_dimensions (organization_id, key, name, description, source, display_order) VALUES
  (NULL, 'execution',            'Execution',            'Delivery against commitments and action items',            'system', 1),
  (NULL, 'reliability',          'Reliability',           'Consistency of follow-through on deadlines and promises',  'system', 2),
  (NULL, 'collaboration',        'Collaboration',         'Effectiveness working with others and across teams',       'system', 3),
  (NULL, 'adaptability',         'Adaptability',          'Response to change, feedback, and new challenges',         'human',  4),
  (NULL, 'growth',               'Growth',                'Personal development and skill progression',               'human',  5),
  (NULL, 'leadership_potential', 'Leadership Potential',  'Readiness for increased responsibility and influence',     'human',  6);

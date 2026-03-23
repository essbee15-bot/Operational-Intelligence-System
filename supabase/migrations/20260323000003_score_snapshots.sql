-- ============================================================
-- Migration: Score Config, Bands, and Snapshots
-- Organisation-level scoring configuration, band definitions, and point-in-time snapshots
-- ============================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. score_config — per-org scoring parameters
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS score_config (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID        NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
  rolling_window_months INTEGER     NOT NULL DEFAULT 12,
  min_meetings_human    INTEGER     NOT NULL DEFAULT 3,
  min_actions_system    INTEGER     NOT NULL DEFAULT 5,
  ntr_default_months    INTEGER     NOT NULL DEFAULT 3,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE score_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can read score_config" ON score_config
  FOR SELECT USING (organization_id = public.user_organization_id());

CREATE POLICY "Org admins can manage score_config" ON score_config
  FOR ALL USING (
    organization_id = public.user_organization_id()
    AND public.is_org_admin()
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. score_bands — label ranges (system defaults + org overrides)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS score_bands (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID        REFERENCES organizations(id) ON DELETE CASCADE,  -- NULL = system default
  band_key        TEXT        NOT NULL,
  label           TEXT        NOT NULL,
  min_score       DECIMAL     NOT NULL,
  max_score       DECIMAL     NOT NULL,
  color           TEXT        NOT NULL DEFAULT '#6b7280',
  display_order   INTEGER     NOT NULL DEFAULT 0,
  UNIQUE (organization_id, band_key)
);

ALTER TABLE score_bands ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Score bands visible to org members" ON score_bands
  FOR SELECT USING (
    organization_id IS NULL
    OR organization_id = public.user_organization_id()
  );

CREATE POLICY "Org admins can manage score bands" ON score_bands
  FOR ALL USING (
    organization_id = public.user_organization_id()
    AND public.is_org_admin()
  );

-- Seed system default bands
INSERT INTO score_bands (organization_id, band_key, label, min_score, max_score, color, display_order) VALUES
  (NULL, 'exceptional',    'Exceptional',     7.5,  9.0,  '#166534', 1),
  (NULL, 'strong',         'Strong',          5.5,  7.49, '#1d4ed8', 2),
  (NULL, 'developing',     'Developing',      3.5,  5.49, '#92400e', 3),
  (NULL, 'needs_support',  'Needs Support',   1.0,  3.49, '#991b1b', 4);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. score_snapshots — point-in-time scores per user per dimension
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS score_snapshots (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  dimension_key   TEXT        NOT NULL,
  score           DECIMAL     NOT NULL CHECK (score >= 1.0 AND score <= 9.0),
  band_key        TEXT,
  snapshot_date   DATE        NOT NULL DEFAULT CURRENT_DATE,
  is_ntr          BOOLEAN     NOT NULL DEFAULT false,
  data_points     INTEGER     NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id, dimension_key, snapshot_date)
);

ALTER TABLE score_snapshots ENABLE ROW LEVEL SECURITY;

-- Users can see their own snapshots
CREATE POLICY "Users can see own score_snapshots" ON score_snapshots
  FOR SELECT USING (user_id = auth.uid());

-- Managers can see their direct reports' snapshots
CREATE POLICY "Managers can see reports score_snapshots" ON score_snapshots
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = score_snapshots.user_id
        AND u.manager_id = auth.uid()
    )
  );

-- Org admins can see all org snapshots
CREATE POLICY "Org admins can see all score_snapshots" ON score_snapshots
  FOR SELECT USING (
    organization_id = public.user_organization_id()
    AND public.is_org_admin()
  );

-- System / admin write access
CREATE POLICY "Org admins can manage score_snapshots" ON score_snapshots
  FOR ALL USING (
    organization_id = public.user_organization_id()
    AND public.is_org_admin()
  );

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_score_snapshots_user_dim_date
  ON score_snapshots (user_id, dimension_key, snapshot_date DESC);

CREATE INDEX IF NOT EXISTS idx_score_snapshots_org_date
  ON score_snapshots (organization_id, snapshot_date DESC);

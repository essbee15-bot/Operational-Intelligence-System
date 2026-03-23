-- ============================================================
-- Migration: Yearly Score Archives
-- End-of-year snapshots for historical reporting and trend analysis
-- ============================================================

CREATE TABLE IF NOT EXISTS score_archives (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id             UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  dimension_key       TEXT        NOT NULL,
  year                INTEGER     NOT NULL,
  start_of_year_score DECIMAL     CHECK (start_of_year_score >= 1.0 AND start_of_year_score <= 9.0),
  start_of_year_band  TEXT,
  end_of_year_score   DECIMAL     CHECK (end_of_year_score >= 1.0 AND end_of_year_score <= 9.0),
  end_of_year_band    TEXT,
  avg_score           DECIMAL,
  min_score           DECIMAL,
  max_score           DECIMAL,
  data_points         INTEGER     NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id, dimension_key, year)
);

ALTER TABLE score_archives ENABLE ROW LEVEL SECURITY;

-- Users can see their own archives
CREATE POLICY "Users can see own score_archives" ON score_archives
  FOR SELECT USING (user_id = auth.uid());

-- Managers can see their direct reports' archives
CREATE POLICY "Managers can see reports score_archives" ON score_archives
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = score_archives.user_id
        AND u.manager_id = auth.uid()
    )
  );

-- Org admins can see all org archives
CREATE POLICY "Org admins can see all score_archives" ON score_archives
  FOR SELECT USING (
    organization_id = public.user_organization_id()
    AND public.is_org_admin()
  );

-- Org admins can manage archives
CREATE POLICY "Org admins can manage score_archives" ON score_archives
  FOR ALL USING (
    organization_id = public.user_organization_id()
    AND public.is_org_admin()
  );

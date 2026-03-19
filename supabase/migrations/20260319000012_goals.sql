-- ─── Migration: Goals / OKR Module ──────────────────────────────────────────
--
-- Creates `objectives` and `key_results` tables for the OKR layer.
--
-- An Objective describes *what* the org/team wants to achieve.
-- Key Results are measurable outcomes that define success for that objective.
-- Each Key Result can optionally reference an existing org KPI for context.
--
-- Visibility: all org users can view objectives; managers and admins can create
-- and update them. Only admins can delete an objective.

-- ─── Objectives ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS objectives (
  id               UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id  UUID        NOT NULL REFERENCES organizations(id),
  title            VARCHAR(300) NOT NULL,
  description      TEXT,
  owner_id         UUID        REFERENCES users(id)  ON DELETE SET NULL,
  team_id          UUID        REFERENCES teams(id)  ON DELETE SET NULL,
  period_label     VARCHAR(100),            -- e.g. "Q1 2026", "Annual 2026"
  start_date       DATE,
  end_date         DATE,
  status           TEXT        NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active', 'complete', 'cancelled')),
  created_by       UUID        NOT NULL REFERENCES users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE objectives ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org users view objectives"
  ON objectives FOR SELECT
  USING (
    organization_id = (
      SELECT organization_id FROM users WHERE id = auth.uid()
    )
  );

CREATE POLICY "Managers and admins manage objectives"
  ON objectives FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE id             = auth.uid()
        AND role           IN ('admin', 'manager')
        AND organization_id = objectives.organization_id
    )
  );

-- ─── Key Results ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS key_results (
  id               UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id  UUID        NOT NULL REFERENCES organizations(id),
  objective_id     UUID        NOT NULL REFERENCES objectives(id) ON DELETE CASCADE,
  title            VARCHAR(300) NOT NULL,
  description      TEXT,
  kpi_id           UUID        REFERENCES kpis(id) ON DELETE SET NULL,
  target_value     DECIMAL,
  unit             VARCHAR(50),
  current_value    DECIMAL,
  status           TEXT        NOT NULL DEFAULT 'not_started'
                   CHECK (status IN ('not_started', 'on_track', 'at_risk', 'complete', 'missed')),
  display_order    INTEGER     NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE key_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org users view key results"
  ON key_results FOR SELECT
  USING (
    organization_id = (
      SELECT organization_id FROM users WHERE id = auth.uid()
    )
  );

CREATE POLICY "Managers and admins manage key results"
  ON key_results FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE id             = auth.uid()
        AND role           IN ('admin', 'manager')
        AND organization_id = key_results.organization_id
    )
  );

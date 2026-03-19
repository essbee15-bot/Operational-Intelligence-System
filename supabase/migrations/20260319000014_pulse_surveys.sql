-- Phase 8: Pulse Surveys — anonymous team-level feedback
-- Four tables: survey definitions, periods, anonymous responses, completion tracking.
-- Privacy design: pulse_responses deliberately has NO user_id.
-- pulse_completions tracks who responded but cannot be joined to responses.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. pulse_surveys (admin-defined survey templates)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE pulse_surveys (
  id              UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            VARCHAR(200) NOT NULL,
  description     TEXT,
  frequency       TEXT        NOT NULL DEFAULT 'monthly'
    CHECK (frequency IN ('weekly', 'monthly', 'quarterly', 'annual', 'ad_hoc')),
  questions       JSONB       NOT NULL DEFAULT '[]',
  -- [{key, label, type ('rating_5'|'rating_10'|'nps'|'yes_no'|'text'), required}]
  is_active       BOOLEAN     NOT NULL DEFAULT true,
  created_by      UUID        REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE pulse_surveys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members read pulse surveys"
  ON pulse_surveys FOR SELECT
  USING (organization_id = public.user_organization_id());

CREATE POLICY "Org admins manage pulse surveys"
  ON pulse_surveys FOR ALL
  USING (organization_id = public.user_organization_id() AND public.is_org_admin());

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. pulse_periods (each survey run, sent org-wide)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE pulse_periods (
  id              UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  survey_id       UUID        NOT NULL REFERENCES pulse_surveys(id) ON DELETE CASCADE,
  organization_id UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  period_label    VARCHAR(100) NOT NULL,   -- e.g. "March 2026", "Q1 2026"
  opens_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  closes_at       TIMESTAMPTZ,
  is_closed       BOOLEAN     NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE pulse_periods ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members read pulse periods"
  ON pulse_periods FOR SELECT
  USING (organization_id = public.user_organization_id());

CREATE POLICY "Org admins manage pulse periods"
  ON pulse_periods FOR ALL
  USING (organization_id = public.user_organization_id() AND public.is_org_admin());

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. pulse_responses — anonymous, no user_id
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE pulse_responses (
  id              UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  period_id       UUID        NOT NULL REFERENCES pulse_periods(id)  ON DELETE CASCADE,
  organization_id UUID        NOT NULL REFERENCES organizations(id)  ON DELETE CASCADE,
  team_id         UUID        NOT NULL REFERENCES teams(id)          ON DELETE CASCADE,
  answers         JSONB       NOT NULL,   -- [{key, value}]
  submitted_at    TIMESTAMPTZ NOT NULL DEFAULT now()
  -- NOTE: no user_id column — by design, responses cannot be linked to individuals
);

ALTER TABLE pulse_responses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members insert pulse responses"
  ON pulse_responses FOR INSERT
  WITH CHECK (organization_id = public.user_organization_id());

CREATE POLICY "Org admins read pulse responses"
  ON pulse_responses FOR SELECT
  USING (organization_id = public.user_organization_id() AND public.is_org_admin());

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. pulse_completions — tracks who responded (separate; NOT joinable to responses)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE pulse_completions (
  period_id    UUID        NOT NULL REFERENCES pulse_periods(id) ON DELETE CASCADE,
  user_id      UUID        NOT NULL REFERENCES users(id)         ON DELETE CASCADE,
  team_id      UUID        NOT NULL REFERENCES teams(id)         ON DELETE CASCADE,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (period_id, user_id, team_id)
);

ALTER TABLE pulse_completions ENABLE ROW LEVEL SECURITY;

-- Users can see their own completions (to check if they've already responded)
CREATE POLICY "Users see own completions"
  ON pulse_completions FOR SELECT
  USING (user_id = auth.uid());

-- Users can record their own completion
CREATE POLICY "Users insert own completions"
  ON pulse_completions FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM pulse_periods pp
      WHERE pp.id = period_id
        AND pp.organization_id = public.user_organization_id()
        AND pp.is_closed = false
    )
  );

-- Admins can read all completions (for response rate tracking)
CREATE POLICY "Admins read all completions"
  ON pulse_completions FOR SELECT
  USING (public.is_org_admin());

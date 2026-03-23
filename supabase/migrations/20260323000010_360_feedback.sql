-- Migration: 20260323000010_360_feedback
-- Feature: 360 Feedback — review cycles, anonymous responses, and completion tracking
-- Anonymity model: review_responses has NO user_id. review_completions tracks who responded
-- but is intentionally not joinable to review_responses.

CREATE TABLE review_cycles (
  id              UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            VARCHAR(200) NOT NULL,
  description     TEXT,
  opens_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  closes_at       TIMESTAMPTZ,
  is_closed       BOOLEAN     NOT NULL DEFAULT false,
  custom_questions JSONB      NOT NULL DEFAULT '[]',
  -- each: {key, label, type:'rating_5'|'text', required}
  created_by      UUID        REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE review_cycles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Org members read review cycles"  ON review_cycles FOR SELECT
  USING (organization_id = public.user_organization_id());
CREATE POLICY "Org admins manage review cycles" ON review_cycles FOR ALL
  USING (organization_id = public.user_organization_id() AND public.is_org_admin());

CREATE TABLE review_responses (
  id              UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  cycle_id        UUID        NOT NULL REFERENCES review_cycles(id)   ON DELETE CASCADE,
  organization_id UUID        NOT NULL REFERENCES organizations(id)   ON DELETE CASCADE,
  manager_id      UUID        NOT NULL REFERENCES users(id)           ON DELETE CASCADE,
  answers         JSONB       NOT NULL,
  -- NO user_id — intentionally anonymous
  submitted_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE review_responses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Org members insert review responses" ON review_responses FOR INSERT
  WITH CHECK (organization_id = public.user_organization_id());
CREATE POLICY "Org admins read review responses" ON review_responses FOR SELECT
  USING (organization_id = public.user_organization_id() AND public.is_org_admin());
CREATE POLICY "Managers read own review responses" ON review_responses FOR SELECT
  USING (organization_id = public.user_organization_id() AND manager_id = auth.uid());

CREATE TABLE review_completions (
  cycle_id     UUID        NOT NULL REFERENCES review_cycles(id) ON DELETE CASCADE,
  user_id      UUID        NOT NULL REFERENCES users(id)         ON DELETE CASCADE,
  manager_id   UUID        NOT NULL REFERENCES users(id)         ON DELETE CASCADE,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (cycle_id, user_id, manager_id)
);
ALTER TABLE review_completions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own completions" ON review_completions FOR SELECT
  USING (user_id = auth.uid());
CREATE POLICY "Users insert own completions" ON review_completions FOR INSERT
  WITH CHECK (user_id = auth.uid() AND EXISTS (
    SELECT 1 FROM review_cycles rc WHERE rc.id = cycle_id
      AND rc.organization_id = public.user_organization_id()
  ));
CREATE POLICY "Admins read all completions" ON review_completions FOR SELECT
  USING (public.is_org_admin());

CREATE INDEX idx_review_responses_cycle_manager ON review_responses(cycle_id, manager_id);
CREATE INDEX idx_review_completions_cycle ON review_completions(cycle_id);

-- ─── Migration: Setup Progress ────────────────────────────────────────────────
--
-- Tracks each organisation's progress through the initial setup wizard.
-- Stores diagnostic questionnaire answers as JSONB and which step the admin
-- has reached, so they can resume if they leave partway through.

CREATE TABLE setup_progress (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID        NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
  diagnostic_answers JSONB,
  current_step    INTEGER     NOT NULL DEFAULT 0,
  is_complete     BOOLEAN     NOT NULL DEFAULT false,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE setup_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org admins manage setup"
  ON setup_progress FOR ALL
  USING (organization_id = public.user_organization_id() AND public.is_org_admin())
  WITH CHECK (organization_id = public.user_organization_id() AND public.is_org_admin());

CREATE POLICY "Org members read setup"
  ON setup_progress FOR SELECT
  USING (organization_id = public.user_organization_id());

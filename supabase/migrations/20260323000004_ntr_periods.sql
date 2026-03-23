-- ============================================================
-- Migration: NTR (Not To Rate) Periods
-- Tracks periods where a user should be excluded from scoring
-- (new hire, promotion, role change, team move, etc.)
-- ============================================================

CREATE TABLE IF NOT EXISTS ntr_periods (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason          TEXT        NOT NULL CHECK (reason IN ('new_hire', 'promotion', 'role_change', 'team_move', 'other')),
  reason_note     TEXT,
  starts_at       DATE        NOT NULL DEFAULT CURRENT_DATE,
  ends_at         DATE        NOT NULL,
  created_by      UUID        REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE ntr_periods ENABLE ROW LEVEL SECURITY;

-- Users can see their own NTR periods
CREATE POLICY "Users can see own ntr_periods" ON ntr_periods
  FOR SELECT USING (user_id = auth.uid());

-- Managers can see their direct reports' NTR periods
CREATE POLICY "Managers can see reports ntr_periods" ON ntr_periods
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = ntr_periods.user_id
        AND u.manager_id = auth.uid()
    )
  );

-- Managers can create NTR periods for their direct reports
CREATE POLICY "Managers can insert ntr_periods for reports" ON ntr_periods
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = ntr_periods.user_id
        AND u.manager_id = auth.uid()
    )
  );

-- Org admins can see and manage all org NTR periods
CREATE POLICY "Org admins can see all ntr_periods" ON ntr_periods
  FOR SELECT USING (
    organization_id = public.user_organization_id()
    AND public.is_org_admin()
  );

CREATE POLICY "Org admins can manage ntr_periods" ON ntr_periods
  FOR ALL USING (
    organization_id = public.user_organization_id()
    AND public.is_org_admin()
  );

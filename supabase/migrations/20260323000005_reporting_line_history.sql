-- ============================================================
-- Migration: Reporting Line History
-- Tracks manager changes over time for historical score attribution
-- ============================================================

CREATE TABLE IF NOT EXISTS reporting_line_history (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  manager_id      UUID        REFERENCES users(id) ON DELETE SET NULL,
  started_at      DATE        NOT NULL DEFAULT CURRENT_DATE,
  ended_at        DATE,
  changed_by      UUID        REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE reporting_line_history ENABLE ROW LEVEL SECURITY;

-- Users can see their own reporting history
CREATE POLICY "Users can see own reporting_line_history" ON reporting_line_history
  FOR SELECT USING (user_id = auth.uid());

-- Managers can see their direct reports' reporting history
CREATE POLICY "Managers can see reports reporting_line_history" ON reporting_line_history
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = reporting_line_history.user_id
        AND u.manager_id = auth.uid()
    )
  );

-- Org admins can see all org reporting history
CREATE POLICY "Org admins can see all reporting_line_history" ON reporting_line_history
  FOR SELECT USING (
    organization_id = public.user_organization_id()
    AND public.is_org_admin()
  );

CREATE POLICY "Org admins can manage reporting_line_history" ON reporting_line_history
  FOR ALL USING (
    organization_id = public.user_organization_id()
    AND public.is_org_admin()
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- Trigger: log manager changes automatically
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.log_manager_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Close the previous reporting line record
  UPDATE reporting_line_history
  SET ended_at = CURRENT_DATE
  WHERE user_id = NEW.id
    AND ended_at IS NULL;

  -- Insert the new reporting line record
  INSERT INTO reporting_line_history (organization_id, user_id, manager_id, started_at, changed_by)
  VALUES (NEW.organization_id, NEW.id, NEW.manager_id, CURRENT_DATE, auth.uid());

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_log_manager_change
  AFTER UPDATE OF manager_id ON users
  FOR EACH ROW
  WHEN (OLD.manager_id IS DISTINCT FROM NEW.manager_id)
  EXECUTE FUNCTION public.log_manager_change();

-- ─────────────────────────────────────────────────────────────────────────────
-- Backfill: seed current reporting lines for all non-anonymised users
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO reporting_line_history (organization_id, user_id, manager_id, started_at)
SELECT
  u.organization_id,
  u.id,
  u.manager_id,
  u.created_at::date
FROM users u
WHERE u.is_anonymised IS NOT TRUE
ON CONFLICT DO NOTHING;

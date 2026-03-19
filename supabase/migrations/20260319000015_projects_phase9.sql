-- ─── Migration: Projects Phase 9 ─────────────────────────────────────────────
--
-- Extends the existing `projects` table with additional columns and enables RLS.
-- Adds 'on_hold' and 'cancelled' to the project_status enum.
-- NOTE: ALTER TYPE ... ADD VALUE must run outside a transaction.

-- 1. Extend enum
ALTER TYPE project_status ADD VALUE IF NOT EXISTS 'on_hold';
ALTER TYPE project_status ADD VALUE IF NOT EXISTS 'cancelled';

-- 2. Add missing columns to projects
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS description    TEXT,
  ADD COLUMN IF NOT EXISTS team_id        UUID        REFERENCES teams(id)  ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS priority       TEXT        NOT NULL DEFAULT 'medium'
                                            CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  ADD COLUMN IF NOT EXISTS created_by     UUID        REFERENCES users(id)  ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS created_at     TIMESTAMPTZ NOT NULL DEFAULT now();

-- 3. Enable RLS on projects (was missing from initial schema)
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

-- 4. RLS policies
-- All org members can read (app layer filters further by role)
CREATE POLICY "Org members read projects"
  ON projects FOR SELECT
  USING (organization_id = public.user_organization_id());

-- Only admins and managers can insert / update / delete
CREATE POLICY "Managers and admins manage projects"
  ON projects FOR ALL
  USING (
    organization_id = public.user_organization_id()
    AND public.is_manager_or_admin()
  )
  WITH CHECK (
    organization_id = public.user_organization_id()
    AND public.is_manager_or_admin()
  );

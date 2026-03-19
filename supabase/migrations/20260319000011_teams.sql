-- ─── Migration: Team Members ─────────────────────────────────────────────────
--
-- Creates a team_members junction table so users can belong to multiple teams.
-- The existing `teams` table (id, organization_id, name, lead_id) and
-- `kpis.team_id` column are already in place from the initial schema.
--
-- With this table the KPI visibility logic can be extended:
--   - If kpi.team_id IS NULL → audience rules apply (everyone / management_only)
--   - If kpi.team_id IS SET  → contributor must also be a member of that team

CREATE TABLE IF NOT EXISTS team_members (
  team_id         UUID NOT NULL REFERENCES teams(id)         ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id)         ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id),
  PRIMARY KEY (team_id, user_id)
);

ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;

-- Users can read their own team memberships (needed by /kpis page filtering)
CREATE POLICY "Users can read their own team memberships"
  ON team_members FOR SELECT
  USING (user_id = auth.uid());

-- Org admins can manage all team_members within their org
CREATE POLICY "Org admins manage team members"
  ON team_members FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE id             = auth.uid()
        AND role           = 'admin'
        AND organization_id = team_members.organization_id
    )
  );

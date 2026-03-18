-- Phase 2: Core Meeting System
-- Adds meeting types, attendees, agenda, action carry-forward, scoring,
-- milestones, and predefined dropdown options for clean data capture.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Extend meetings table
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE meetings
  ADD COLUMN meeting_type    TEXT    NOT NULL DEFAULT 'one_on_one'
    CHECK (meeting_type IN ('one_on_one', 'team_meeting', 'project_meeting')),
  ADD COLUMN purpose         VARCHAR(300),   -- team/project: meeting purpose
  ADD COLUMN aob_notes       VARCHAR(2000),  -- 1:1 Any Other Business
  ADD COLUMN kpi_notes       VARCHAR(2000);  -- 1:1 KPI/KRA context placeholder

-- Fix existing free-text columns to have sensible limits
-- (existing columns general_notes, outcomes etc. left as TEXT to avoid data issues,
--  limits enforced at application layer for now)

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Extend action_items table
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE action_items
  ADD COLUMN risk_blockers   JSONB,   -- {selected: "label", notes: "text"}
  ADD COLUMN risk_support    JSONB,   -- {selected: "label", notes: "text"}
  ADD COLUMN risk_mitigation JSONB,   -- {selected: "label", notes: "text"}
  ADD COLUMN is_closed       BOOLEAN NOT NULL DEFAULT false,
  -- Rename title to action_text concept: keep title but add VARCHAR constraint via check
  ADD COLUMN action_text     VARCHAR(300);

-- Backfill action_text from title for existing rows
UPDATE action_items SET action_text = LEFT(title, 300) WHERE action_text IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. meeting_attendees (for team/project meetings)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE meeting_attendees (
  meeting_id UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  PRIMARY KEY (meeting_id, user_id)
);

ALTER TABLE meeting_attendees ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant isolation for meeting_attendees" ON meeting_attendees
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM meetings m
      WHERE m.id = meeting_id
        AND m.organization_id = public.user_organization_id()
    )
  );

CREATE POLICY "Org members can manage meeting_attendees" ON meeting_attendees
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM meetings m
      WHERE m.id = meeting_id
        AND m.organization_id = public.user_organization_id()
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. agenda_items
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE agenda_items (
  id            UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id    UUID    NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  content       VARCHAR(300) NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0
);

ALTER TABLE agenda_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant isolation for agenda_items" ON agenda_items
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM meetings m
      WHERE m.id = meeting_id
        AND m.organization_id = public.user_organization_id()
    )
  );

CREATE POLICY "Org members can manage agenda_items" ON agenda_items
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM meetings m
      WHERE m.id = meeting_id
        AND m.organization_id = public.user_organization_id()
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. action_reviews
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE action_reviews (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_id  UUID NOT NULL REFERENCES action_items(id) ON DELETE CASCADE,
  meeting_id UUID NOT NULL REFERENCES meetings(id)    ON DELETE CASCADE,
  outcome    TEXT NOT NULL CHECK (outcome IN ('complete', 'ongoing', 'missed')),
  went_well  JSONB,  -- {selected: "label", notes: "text (max 300)"}
  went_badly JSONB,
  learned    JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE action_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant isolation for action_reviews" ON action_reviews
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM action_items ai
      JOIN meetings m ON m.id = ai.meeting_id
      WHERE ai.id = action_id
        AND m.organization_id = public.user_organization_id()
    )
  );

CREATE POLICY "Org members can manage action_reviews" ON action_reviews
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM action_items ai
      JOIN meetings m ON m.id = ai.meeting_id
      WHERE ai.id = action_id
        AND m.organization_id = public.user_organization_id()
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. one_on_one_scores
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE one_on_one_scores (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id     UUID NOT NULL UNIQUE REFERENCES meetings(id) ON DELETE CASCADE,
  self_score     INTEGER CHECK (self_score     BETWEEN 1 AND 9),
  manager_score  INTEGER CHECK (manager_score  BETWEEN 1 AND 9),
  adjusted_score INTEGER CHECK (adjusted_score BETWEEN 1 AND 9),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE one_on_one_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant isolation for one_on_one_scores" ON one_on_one_scores
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM meetings m
      WHERE m.id = meeting_id
        AND m.organization_id = public.user_organization_id()
    )
  );

CREATE POLICY "Org members can manage one_on_one_scores" ON one_on_one_scores
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM meetings m
      WHERE m.id = meeting_id
        AND m.organization_id = public.user_organization_id()
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. milestones (for project meetings)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE milestones (
  id              UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID    NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  meeting_id      UUID    NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  milestone_text  VARCHAR(300) NOT NULL,
  owner_id        UUID    REFERENCES users(id) ON DELETE SET NULL,
  expected_date   DATE,
  status          TEXT    NOT NULL DEFAULT 'not_started'
    CHECK (status IN ('not_started', 'in_progress', 'complete', 'missed')),
  display_order   INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE milestones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant isolation for milestones" ON milestones
  FOR SELECT USING (organization_id = public.user_organization_id());

CREATE POLICY "Org members can manage milestones" ON milestones
  FOR ALL USING (organization_id = public.user_organization_id());

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. predefined_options (admin-configurable dropdown options)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE predefined_options (
  id              UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID    REFERENCES organizations(id) ON DELETE CASCADE,  -- NULL = system default
  category        TEXT    NOT NULL,
  label           VARCHAR(300) NOT NULL,
  display_order   INTEGER NOT NULL DEFAULT 0,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE predefined_options ENABLE ROW LEVEL SECURITY;

-- System defaults (org NULL) readable by everyone; org-specific readable by org members
CREATE POLICY "Predefined options visible to org members" ON predefined_options
  FOR SELECT USING (
    organization_id IS NULL
    OR organization_id = public.user_organization_id()
  );

CREATE POLICY "Org admins can manage their predefined options" ON predefined_options
  FOR ALL USING (
    organization_id = public.user_organization_id()
    AND public.is_org_admin()
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. Seed system default options
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO predefined_options (organization_id, category, label, display_order) VALUES
  -- went_well
  (NULL, 'went_well', 'Stayed on track',          1),
  (NULL, 'went_well', 'Hit targets',               2),
  (NULL, 'went_well', 'Good team collaboration',   3),
  (NULL, 'went_well', 'Strong communication',      4),
  (NULL, 'went_well', 'Overcame a challenge',      5),

  -- went_badly
  (NULL, 'went_badly', 'Missed deadline',          1),
  (NULL, 'went_badly', 'Resource constraints',     2),
  (NULL, 'went_badly', 'Unclear brief',            3),
  (NULL, 'went_badly', 'Poor communication',       4),
  (NULL, 'went_badly', 'External blockers',        5),

  -- learned
  (NULL, 'learned', 'Process improvement identified', 1),
  (NULL, 'learned', 'Skills gap found',               2),
  (NULL, 'learned', 'Better planning needed',         3),
  (NULL, 'learned', 'Positive approach confirmed',    4),
  (NULL, 'learned', 'New dependency found',           5),

  -- risk_blockers
  (NULL, 'risk_blockers', 'Workload / capacity',    1),
  (NULL, 'risk_blockers', 'Missing information',    2),
  (NULL, 'risk_blockers', 'Dependency on others',   3),
  (NULL, 'risk_blockers', 'Technical complexity',   4),
  (NULL, 'risk_blockers', 'Unclear requirements',   5),

  -- risk_support
  (NULL, 'risk_support', 'Additional resource',    1),
  (NULL, 'risk_support', 'Clearer brief',           2),
  (NULL, 'risk_support', 'Stakeholder sign-off',   3),
  (NULL, 'risk_support', 'Training / guidance',    4),
  (NULL, 'risk_support', 'More time',              5),

  -- risk_mitigation
  (NULL, 'risk_mitigation', 'Escalate early',            1),
  (NULL, 'risk_mitigation', 'Break into smaller steps',  2),
  (NULL, 'risk_mitigation', 'Assign backup owner',       3),
  (NULL, 'risk_mitigation', 'Flag in next meeting',      4),
  (NULL, 'risk_mitigation', 'Adjust timeline',           5),

  -- development_type
  (NULL, 'development_type', 'Required (role)',    1),
  (NULL, 'development_type', 'Wanted (personal)',  2),
  (NULL, 'development_type', 'Ongoing',            3),
  (NULL, 'development_type', 'Qualification',      4),

  -- meeting_purpose
  (NULL, 'meeting_purpose', 'Review & planning',   1),
  (NULL, 'meeting_purpose', 'Project update',      2),
  (NULL, 'meeting_purpose', 'Problem solving',     3),
  (NULL, 'meeting_purpose', 'Decision making',     4),
  (NULL, 'meeting_purpose', 'Team alignment',      5);

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. Add write RLS policies to meetings table (needed for user-created meetings)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE POLICY "Org members can create meetings" ON meetings
  FOR INSERT WITH CHECK (organization_id = public.user_organization_id());

CREATE POLICY "Org members can update their meetings" ON meetings
  FOR UPDATE USING (organization_id = public.user_organization_id());

CREATE POLICY "Org members can delete their meetings" ON meetings
  FOR DELETE USING (organization_id = public.user_organization_id());

-- Add write policies for action_items too
CREATE POLICY "Org members can create action_items" ON action_items
  FOR INSERT WITH CHECK (organization_id = public.user_organization_id());

CREATE POLICY "Org members can update action_items" ON action_items
  FOR UPDATE USING (organization_id = public.user_organization_id());

CREATE POLICY "Org members can delete action_items" ON action_items
  FOR DELETE USING (organization_id = public.user_organization_id());

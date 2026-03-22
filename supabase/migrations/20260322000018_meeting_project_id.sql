-- Allow meetings to be linked to a specific project
-- (used by project_meeting type to carry forward attendees correctly)
ALTER TABLE meetings
  ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS meetings_project_id_idx ON meetings (project_id);

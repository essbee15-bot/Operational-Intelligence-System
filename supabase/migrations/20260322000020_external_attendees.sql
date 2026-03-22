-- supabase/migrations/20260322000020_external_attendees.sql
-- Adds optional free-text external attendees to meetings.
ALTER TABLE meetings
  ADD COLUMN IF NOT EXISTS external_attendees TEXT NULL;

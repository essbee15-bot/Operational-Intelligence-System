-- ============================================================
-- Migration: Action Item Timestamps
-- Adds created_at and completed_at to action_items for scoring calculations
-- ============================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Add columns
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE action_items
  ADD COLUMN IF NOT EXISTS created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS completed_at  TIMESTAMPTZ;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Backfill created_at from the associated meeting date where available
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE action_items ai
SET created_at = m.date
FROM meetings m
WHERE ai.meeting_id = m.id
  AND ai.meeting_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Backfill completed_at for already-completed actions
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE action_items
SET completed_at = now()
WHERE status = 'completed'
  AND completed_at IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Trigger: auto-set completed_at on status changes
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_action_completed_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'completed' AND OLD.status != 'completed' THEN
    NEW.completed_at := now();
  ELSIF NEW.status != 'completed' AND OLD.status = 'completed' THEN
    -- Reopened: clear completed_at
    NEW.completed_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_action_completed_at
  BEFORE UPDATE OF status ON action_items
  FOR EACH ROW
  EXECUTE FUNCTION public.set_action_completed_at();

-- Add anonymisation tracking columns to users
-- When a user leaves, their personal data is wiped but activity data (meetings,
-- projects, action items) is retained, attributed to 'Leaver'.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS is_anonymised BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS anonymised_at TIMESTAMPTZ;

-- Remove the FK cascade from public.users.id to auth.users so that
-- anonymised public profiles can outlive the deleted auth account.
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_id_fkey;

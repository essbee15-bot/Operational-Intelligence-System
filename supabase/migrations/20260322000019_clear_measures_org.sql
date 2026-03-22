-- supabase/migrations/20260322000019_clear_measures_org.sql
-- Creates the Clear Measures organisation and assigns the platform admin to it.
-- Safe to re-run: uses ON CONFLICT DO NOTHING.

DO $$
DECLARE
  org_id UUID := gen_random_uuid();
  existing_org_id UUID;
BEGIN
  -- Check if Clear Measures org already exists
  SELECT id INTO existing_org_id
  FROM public.organizations
  WHERE name = 'Clear Measures'
  LIMIT 1;

  -- Create org only if it doesn't exist
  IF existing_org_id IS NULL THEN
    INSERT INTO public.organizations (id, name, subscription_status, created_at)
    VALUES (org_id, 'Clear Measures', 'active', now());
  ELSE
    org_id := existing_org_id;
  END IF;

  -- Assign the platform admin to this org as admin
  -- (keeps is_platform_admin = true)
  UPDATE public.users
  SET
    organization_id = org_id,
    role = 'admin'
  WHERE email = 'hello@clearmeasures.co.uk'
    AND is_platform_admin = true;
END;
$$;

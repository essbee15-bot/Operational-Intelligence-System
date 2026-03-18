-- Platform admins do not belong to any organisation.
-- Make organization_id nullable so the platform owner can exist in the users table
-- without being tied to a tenant.

ALTER TABLE users ALTER COLUMN organization_id DROP NOT NULL;

-- Update the helper function to handle a null org gracefully.
-- Returns null for platform admins (which means org-scoped RLS policies
-- will simply not match any org rows, preventing unintended access).
CREATE OR REPLACE FUNCTION public.user_organization_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT organization_id FROM public.users WHERE id = auth.uid();
$$;

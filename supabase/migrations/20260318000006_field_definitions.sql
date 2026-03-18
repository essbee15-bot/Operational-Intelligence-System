-- Custom field definitions allow org admins to define additional fields
-- for meetings, projects, KPIs and users without code changes.
-- Field data is stored in JSONB metadata columns added to those tables later.
CREATE TABLE field_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('user', 'meeting', 'project', 'kpi')),
  label TEXT NOT NULL,
  field_key TEXT NOT NULL,
  field_type TEXT NOT NULL CHECK (field_type IN ('text', 'number', 'date', 'select', 'textarea', 'checkbox')),
  options JSONB DEFAULT '[]'::jsonb,
  is_required BOOLEAN NOT NULL DEFAULT FALSE,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  UNIQUE (organization_id, entity_type, field_key)
);

ALTER TABLE field_definitions ENABLE ROW LEVEL SECURITY;

-- All org members can read field definitions (needed when filling in forms)
CREATE POLICY "Org members can read field definitions" ON field_definitions
  FOR SELECT USING (organization_id = public.user_organization_id());

-- Only org admins can create / update / delete field definitions
CREATE POLICY "Org admins can manage field definitions" ON field_definitions
  FOR ALL USING (
    organization_id = public.user_organization_id()
    AND public.is_org_admin()
  )
  WITH CHECK (
    organization_id = public.user_organization_id()
    AND public.is_org_admin()
  );

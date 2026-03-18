CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  performed_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL DEFAULT 'user',
  target_id TEXT,
  target_name TEXT,
  details JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Org admins can view audit logs for their own organisation
CREATE POLICY "Org admins can view audit logs" ON audit_logs
  FOR SELECT USING (
    organization_id = public.user_organization_id()
    AND EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

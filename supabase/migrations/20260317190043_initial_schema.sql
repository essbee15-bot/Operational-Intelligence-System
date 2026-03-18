-- Enums
CREATE TYPE user_role AS ENUM ('admin', 'manager', 'contributor');
CREATE TYPE template_type AS ENUM ('1_on_1', 'team_meeting', 'project');
CREATE TYPE project_status AS ENUM ('planning', 'active', 'completed', 'failed');
CREATE TYPE action_status AS ENUM ('pending', 'in_progress', 'completed');

-- 1. organizations (Tenants)
CREATE TABLE organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    stripe_customer_id TEXT,
    subscription_status TEXT,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- 2. users (References auth.users)
CREATE TABLE users (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    full_name TEXT,
    role user_role NOT NULL DEFAULT 'contributor',
    manager_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- 3. teams (Org Units)
CREATE TABLE teams (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    lead_id UUID REFERENCES users(id) ON DELETE SET NULL
);

-- 4. templates (Meetings & Projects)
CREATE TABLE templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    type template_type NOT NULL,
    name TEXT NOT NULL,
    structure JSONB DEFAULT '{}'::jsonb NOT NULL
);

-- 5. meetings (1:1s & Team Meetings)
CREATE TABLE meetings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    template_id UUID REFERENCES templates(id) ON DELETE SET NULL,
    previous_meeting_id UUID REFERENCES meetings(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    organizer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    attendee_id UUID REFERENCES users(id) ON DELETE CASCADE,
    date TIMESTAMPTZ NOT NULL,
    rating_last_month INTEGER CHECK (rating_last_month >= 1 AND rating_last_month <= 10),
    performance_reasons TEXT,
    success_failure_surprises TEXT,
    development_requests TEXT,
    project_involvement_notes TEXT,
    tests_experiments_notes TEXT,
    general_notes TEXT,
    outcomes TEXT
);

-- 6. projects
CREATE TABLE projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    template_id UUID REFERENCES templates(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status project_status NOT NULL DEFAULT 'planning',
    capacity_impact INTEGER,
    start_date TIMESTAMPTZ,
    end_date TIMESTAMPTZ,
    outcomes TEXT
);

-- 7. action_items
CREATE TABLE action_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    assignee_id UUID REFERENCES users(id) ON DELETE CASCADE,
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    meeting_id UUID REFERENCES meetings(id) ON DELETE CASCADE,
    status action_status NOT NULL DEFAULT 'pending',
    due_date TIMESTAMPTZ
);

-- 8. kpis
CREATE TABLE kpis (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    owner_id UUID REFERENCES users(id) ON DELETE CASCADE,
    target_value DECIMAL,
    unit TEXT,
    placeholders JSONB DEFAULT '{}'::jsonb
);

-- 9. kpi_records
CREATE TABLE kpi_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kpi_id UUID NOT NULL REFERENCES kpis(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    value DECIMAL NOT NULL,
    date TIMESTAMPTZ NOT NULL DEFAULT now(),
    notes TEXT
);

-- Enable RLS on all tables
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE action_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE kpis ENABLE ROW LEVEL SECURITY;
ALTER TABLE kpi_records ENABLE ROW LEVEL SECURITY;

-- Helper Function to get the Current User's Organization ID
-- This allows us to strictly enforce tenant isolation automatically in Policies
create or replace function public.user_organization_id()
returns uuid
language sql stable
as $$
  select organization_id from public.users where id = auth.uid();
$$;

-- RLS Policies Examples (Tenant Isolation)
-- ORGANIZATIONS: A user can only view their own organization
CREATE POLICY "Users can view their own organization" ON organizations
  FOR SELECT USING (id = public.user_organization_id());

-- USERS: A user can view anyone in their own organization
CREATE POLICY "Users can view members of their organization" ON users
  FOR SELECT USING (organization_id = public.user_organization_id());

-- Same fallback for all other tables ensuring hard tenant boundaries for SELECT:
CREATE POLICY "Tenant isolation for teams" ON teams FOR SELECT USING (organization_id = public.user_organization_id());
CREATE POLICY "Tenant isolation for templates" ON templates FOR SELECT USING (organization_id = public.user_organization_id());
CREATE POLICY "Tenant isolation for meetings" ON meetings FOR SELECT USING (organization_id = public.user_organization_id());
CREATE POLICY "Tenant isolation for projects" ON projects FOR SELECT USING (organization_id = public.user_organization_id());
CREATE POLICY "Tenant isolation for action_items" ON action_items FOR SELECT USING (organization_id = public.user_organization_id());
CREATE POLICY "Tenant isolation for kpis" ON kpis FOR SELECT USING (organization_id = public.user_organization_id());
CREATE POLICY "Tenant isolation for kpi_records" ON kpi_records FOR SELECT USING (organization_id = public.user_organization_id());

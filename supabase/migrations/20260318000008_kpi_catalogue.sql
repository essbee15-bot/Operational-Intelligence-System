-- ─── Migration: KPI Catalogue ────────────────────────────────────────────────
--
-- Extends the kpis table to support a system-level KPI catalogue maintained
-- by platform admins. System KPIs have organization_id = NULL and act as
-- templates that can be assigned to (i.e. copied into) an organisation.
-- Org-specific KPIs have organization_id set, and may optionally track the
-- system template they were derived from via template_kpi_id.

-- 1. Make organization_id nullable (system templates have no org)
ALTER TABLE kpis
  ALTER COLUMN organization_id DROP NOT NULL;

-- 2. Add catalogue / metadata columns
ALTER TABLE kpis
  ADD COLUMN IF NOT EXISTS category         TEXT NOT NULL DEFAULT 'other'
    CHECK (category IN ('sales','finance','operations','customer','hr','projects','other')),
  ADD COLUMN IF NOT EXISTS description      TEXT,
  ADD COLUMN IF NOT EXISTS target_frequency TEXT NOT NULL DEFAULT 'monthly'
    CHECK (target_frequency IN ('daily','weekly','monthly','quarterly','annual','ad_hoc')),
  ADD COLUMN IF NOT EXISTS is_active        BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS display_order    INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS template_kpi_id  UUID REFERENCES kpis(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS created_at       TIMESTAMPTZ NOT NULL DEFAULT now();

-- 3. Update RLS so system templates (null org_id) are visible to all org users
--    (they need to see the catalogue to pick from it)
DROP POLICY IF EXISTS "Tenant isolation for kpis" ON kpis;

CREATE POLICY "KPI catalogue and org select" ON kpis
  FOR SELECT USING (
    organization_id = public.user_organization_id()
    OR organization_id IS NULL
  );

-- Org members can insert/update/delete within their own org
CREATE POLICY "Org members can manage their kpis" ON kpis
  FOR ALL
  USING (organization_id = public.user_organization_id())
  WITH CHECK (organization_id = public.user_organization_id());

-- 4. Seed system KPI catalogue (organization_id = NULL)
--    These are the most common KPIs across business functions.
--    Platform admins can add/remove/edit these via /platform-admin/kpis.

INSERT INTO kpis (organization_id, name, category, description, unit, target_frequency, display_order) VALUES
  -- Sales & Revenue
  (NULL, 'Monthly Revenue',              'sales',      'Total revenue generated in the month',              '£',        'monthly',   1),
  (NULL, 'Revenue vs Target',            'sales',      'Actual revenue as % of monthly target',             '%',        'monthly',   2),
  (NULL, 'New Clients Won',              'sales',      'Number of new client accounts signed',              'count',    'monthly',   3),
  (NULL, 'Pipeline Value',              'sales',      'Total value of active sales pipeline',              '£',        'monthly',   4),
  (NULL, 'Conversion Rate',             'sales',      'Leads converted to customers (%)',                  '%',        'monthly',   5),
  (NULL, 'Average Deal Size',           'sales',      'Average value per closed deal',                     '£',        'monthly',   6),

  -- Finance & Costs
  (NULL, 'Gross Margin',                'finance',    'Gross profit as a percentage of revenue',           '%',        'monthly',   1),
  (NULL, 'Operating Costs',             'finance',    'Total operational expenditure for the period',      '£',        'monthly',   2),
  (NULL, 'Cost per Hire',               'finance',    'Average cost to recruit one person',                '£',        'quarterly', 3),
  (NULL, 'Budget Utilisation',          'finance',    'Actual spend vs budget (%)',                        '%',        'monthly',   4),

  -- Operations & Delivery
  (NULL, 'On-Time Delivery Rate',       'operations', 'Projects / orders delivered on time (%)',           '%',        'monthly',   1),
  (NULL, 'Capacity Utilisation',        'operations', 'Billable / productive hours as % of available',    '%',        'monthly',   2),
  (NULL, 'Error / Rework Rate',         'operations', 'Work requiring rework as % of total output',       '%',        'monthly',   3),
  (NULL, 'Average Project Duration',    'operations', 'Mean time to complete a project (days)',            'days',     'quarterly', 4),

  -- Customer & Quality
  (NULL, 'Net Promoter Score (NPS)',    'customer',   'Customer likelihood to recommend (0–10 scale)',     'score',    'quarterly', 1),
  (NULL, 'Customer Satisfaction (CSAT)','customer',   'Customer satisfaction rating (%)',                  '%',        'monthly',   2),
  (NULL, 'Client Retention Rate',       'customer',   'Percentage of clients retained period-on-period',  '%',        'quarterly', 3),
  (NULL, 'Support Tickets Raised',      'customer',   'Number of customer support issues raised',          'count',    'monthly',   4),
  (NULL, 'Average Resolution Time',     'customer',   'Mean time to resolve a customer issue (hours)',     'hours',    'monthly',   5),

  -- People & HR
  (NULL, 'Employee Satisfaction Score', 'hr',         'Internal survey satisfaction rating (1–10)',        'score/10', 'quarterly', 1),
  (NULL, 'Staff Turnover Rate',         'hr',         'Employees leaving as % of headcount',              '%',        'quarterly', 2),
  (NULL, 'Absence Rate',                'hr',         'Sick / unplanned absence days as % of working days','%',       'monthly',   3),
  (NULL, 'Training Hours per Person',   'hr',         'Average learning & development hours per employee', 'hours',    'quarterly', 4),
  (NULL, 'Headcount',                   'hr',         'Total number of employees (FTE)',                   'count',    'monthly',   5),
  (NULL, 'Open Roles',                  'hr',         'Number of unfilled vacancies',                      'count',    'monthly',   6),

  -- Projects & Delivery
  (NULL, 'Projects On Track',           'projects',   'Percentage of active projects meeting schedule',    '%',        'monthly',   1),
  (NULL, 'Milestones Hit This Month',   'projects',   'Count of project milestones completed on time',     'count',    'monthly',   2),
  (NULL, 'Overdue Actions',             'projects',   'Number of past-due action items across all projects','count',   'monthly',   3),
  (NULL, 'Projects Delivered on Budget','projects',   'Projects completed within budget (%)',              '%',        'quarterly', 4);

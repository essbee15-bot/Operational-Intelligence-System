-- ─── Migration: KPI Catalogue Key ────────────────────────────────────────────
--
-- Adds a stable `catalogue_key` TEXT slug to system KPIs (organization_id IS
-- NULL).  This allows future migrations — and a new updateSystemKpi action —
-- to upsert catalogue entries by key rather than by UUID, so renaming a KPI
-- or updating its wording never orphans rows or produces duplicates.
--
-- Usage in future migrations:
--   INSERT INTO kpis (catalogue_key, organization_id, name, ...)
--   VALUES ('monthly_revenue', NULL, 'Total Monthly Revenue', ...)
--   ON CONFLICT ON CONSTRAINT kpis_catalogue_key_system
--   DO UPDATE SET name = EXCLUDED.name,
--                 description = EXCLUDED.description,
--                 unit = EXCLUDED.unit;

-- 1. Add the column
ALTER TABLE kpis
  ADD COLUMN IF NOT EXISTS catalogue_key TEXT;

-- 2. Unique partial index — one system template per catalogue_key
CREATE UNIQUE INDEX IF NOT EXISTS kpis_catalogue_key_system
  ON kpis (catalogue_key)
  WHERE organization_id IS NULL AND catalogue_key IS NOT NULL;

-- 3. Backfill catalogue_keys for all 29 seeded system KPIs
UPDATE kpis SET catalogue_key = CASE name
  -- Sales & Revenue
  WHEN 'Monthly Revenue'                 THEN 'monthly_revenue'
  WHEN 'Revenue vs Target'               THEN 'revenue_vs_target'
  WHEN 'New Clients Won'                 THEN 'new_clients_won'
  WHEN 'Pipeline Value'                  THEN 'pipeline_value'
  WHEN 'Conversion Rate'                 THEN 'conversion_rate'
  WHEN 'Average Deal Size'               THEN 'average_deal_size'
  -- Finance & Costs
  WHEN 'Gross Margin'                    THEN 'gross_margin'
  WHEN 'Operating Costs'                 THEN 'operating_costs'
  WHEN 'Cost per Hire'                   THEN 'cost_per_hire'
  WHEN 'Budget Utilisation'              THEN 'budget_utilisation'
  -- Operations & Delivery
  WHEN 'On-Time Delivery Rate'           THEN 'on_time_delivery_rate'
  WHEN 'Capacity Utilisation'            THEN 'capacity_utilisation'
  WHEN 'Error / Rework Rate'             THEN 'error_rework_rate'
  WHEN 'Average Project Duration'        THEN 'average_project_duration'
  -- Customer & Quality
  WHEN 'Net Promoter Score (NPS)'        THEN 'nps_score'
  WHEN 'Customer Satisfaction (CSAT)'    THEN 'csat_score'
  WHEN 'Client Retention Rate'           THEN 'client_retention_rate'
  WHEN 'Support Tickets Raised'          THEN 'support_tickets_raised'
  WHEN 'Average Resolution Time'         THEN 'average_resolution_time'
  -- People & HR
  WHEN 'Employee Satisfaction Score'     THEN 'employee_satisfaction_score'
  WHEN 'Staff Turnover Rate'             THEN 'staff_turnover_rate'
  WHEN 'Absence Rate'                    THEN 'absence_rate'
  WHEN 'Training Hours per Person'       THEN 'training_hours_per_person'
  WHEN 'Headcount'                       THEN 'headcount'
  WHEN 'Open Roles'                      THEN 'open_roles'
  -- Projects & Delivery
  WHEN 'Projects On Track'              THEN 'projects_on_track'
  WHEN 'Milestones Hit This Month'       THEN 'milestones_hit_monthly'
  WHEN 'Overdue Actions'                 THEN 'overdue_actions'
  WHEN 'Projects Delivered on Budget'    THEN 'projects_on_budget'
  ELSE NULL
END
WHERE organization_id IS NULL;

# Data Model

This document outlines the relational data model for the SaaS platform. It is designed for multi-tenancy from Day 1.

## Core Entities & Tables

### 1. `organizations` (Tenants)
- `id` (UUID, Primary Key)
- `name` (String)
- `stripe_customer_id` (String, Optional) - *For Stripe billing*
- `subscription_status` (String, Optional)
- `created_at` (Timestamp)
- *Purpose:* The root container for all data. Every other table (except core user auth) must reference this to ensure strict tenant isolation.

### 2. `users`
- `id` (UUID, Primary Key, linked to Supabase Auth)
- `organization_id` (UUID, Foreign Key)
- `email` (String)
- `full_name` (String)
- `role` (Enum: 'admin', 'manager', 'contributor')
- `manager_id` (UUID, Foreign Key to `users`) - *For reporting lines*
- `created_at` (Timestamp)

### 3. `teams` (Org Units)
- `id` (UUID, Primary Key)
- `organization_id` (UUID, Foreign Key)
- `name` (String)
- `lead_id` (UUID, Foreign Key to `users`) - *Team manager*

### 4. `templates` (Meetings & Projects)
- `id` (UUID, Primary Key)
- `organization_id` (UUID, Foreign Key)
- `type` (Enum: '1_on_1', 'team_meeting', 'project')
- `name` (String)
- `structure` (JSONB) - *Defines the specific fields/questions required by the custom template*

### 5. `meetings` (1:1s & Team Meetings)
- `id` (UUID, Primary Key)
- `organization_id` (UUID, Foreign Key)
- `template_id` (UUID, Foreign Key to `templates`, Optional)
- `previous_meeting_id` (UUID, Foreign Key to `meetings`, Optional) - *Used to auto-populate previously discussed items and actions*
- `title` (String)
- `organizer_id` (UUID, Foreign Key to `users`)
- `attendee_id` (UUID, Foreign Key to `users` - Optional for 1:1s)
- `date` (Timestamp)
- `rating_last_month` (Integer) - *1-10 scale rating for previous period actions*
- `performance_reasons` (Text) - *Why performance was at that level*
- `success_failure_surprises` (Text)
- `development_requests` (Text)
- `project_involvement_notes` (Text)
- `tests_experiments_notes` (Text)
- `general_notes` (Text)
- `outcomes` (Text) - *Capturing the "how" and behaviors*

### 6. `projects`
- `id` (UUID, Primary Key)
- `organization_id` (UUID, Foreign Key)
- `template_id` (UUID, Foreign Key to `templates`, Optional)
- `name` (String)
- `owner_id` (UUID, Foreign Key to `users`)
- `status` (Enum: 'planning', 'active', 'completed', 'failed')
- `capacity_impact` (Integer) - *Estimated hours or capacity points*
- `start_date` (Timestamp)
- `end_date` (Timestamp)
- `outcomes` (Text) - *What worked/didn't work for future AI prediction*

### 7. `action_items`
- `id` (UUID, Primary Key)
- `organization_id` (UUID, Foreign Key)
- `title` (String)
- `assignee_id` (UUID, Foreign Key to `users`)
- `project_id` (UUID, Foreign Key, Optional)
- `meeting_id` (UUID, Foreign Key, Optional)
- `status` (Enum: 'pending', 'in_progress', 'completed')
- `due_date` (Timestamp)
- *Purpose:* Feeds into individual performance scores and visibility of execution.

### 8. `kpis`
- `id` (UUID, Primary Key)
- `organization_id` (UUID, Foreign Key)
- `team_id` (UUID, Foreign Key to `teams`, Optional) - *Allows tailoring KPIs to specific departments/teams*
- `name` (String)
- `owner_id` (UUID, Foreign Key to `users`, Optional)
- `target_value` (Decimal)
- `unit` (String)
- `placeholders` (JSONB) - *Used to customize department-specific variables in the KPI*

### 9. `kpi_records`
- `id` (UUID, Primary Key)
- `kpi_id` (UUID, Foreign Key)
- `organization_id` (UUID, Foreign Key)
- `value` (Decimal)
- `date` (Timestamp)
- `notes` (Text) - *Context on why the KPI was hit or missed*

## Relationships & Security Constraints
- **Row Level Security (RLS) in Supabase:**
  - `organization_id` must match the user's `organization_id` for ALL queries.
  - Users can read/write their own `action_items` and `KPIs`.
  - Managers can read/write data for users where `manager_id` matches their user ID, or for teams where they are `lead_id`.
  - Admins have full access within their `organization_id`.

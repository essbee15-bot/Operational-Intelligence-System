# Permissions Model

This document outlines the role-based and hierarchy-based access controls for the platform.

## User Roles
1. **Admin:** Full access to all data and settings within their specific Organization (tenant). Can manage billing, users, system settings, and organization-wide templates.
2. **Manager:** Access to their own data, plus read/write access to data for any user who reports to them (where `manager_id` equals the Manager's `id`), or teams they lead (`lead_id`).
3. **Contributor:** Access only to their own individual data (their 1:1s, projects they own, actions assigned to them, their own KPIs).

## Hierarchy & Visibility Logic
- **Direct Reports:** A Manager can view the 1:1s, Action Items, Projects, and KPIs of their direct reports.
- **Team Leadership:** A Team Lead can view aggregated team KPIs and projects associated with their `team_id`.
- **Peer Visibility:** By default, 1:1s and personal KPIs are strictly private. Projects may be visible organization-wide or team-wide depending on template settings, to encourage transparency without exposing sensitive performance conversations.

## Tenant Isolation (Crucial)
- **Rule:** Every query in the application MUST filter by `organization_id`.
- **Implementation:** Supabase Row Level Security (RLS) policies will enforce tenant isolation at the database level. An authenticated user can never read or write records where the `organization_id` does not match their own `organization_id`.
- **Global Admin:** There is no "global" superadmin role in the app UI. Database administration across tenants is restricted to backend secure access only (e.g., Supabase dashboard).

## Sensitive Data Considerations
- **1:1 Meeting Notes:** Often contain sensitive HR or performance data. These must be rigorously protected by RLS so that only the organizer, attendee, and organizational admins can access them.
- **Billing:** Stripe customer IDs and subscription statuses must be locked down and never exposed to Contributors or Managers.

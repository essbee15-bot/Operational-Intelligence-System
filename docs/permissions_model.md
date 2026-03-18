# Permissions Model

This document outlines the full access control model for the platform, covering platform-level administration, organisation-level roles, and database-level enforcement.

---

## Access Tiers

### Tier 0: Platform Owner (You)
- **Who:** The system operator — a single trusted individual with `is_platform_admin = TRUE` in the database.
- **How to set:** Must be set directly in the Supabase dashboard (cannot be set via the app UI — blocked by RLS).
- **What they can do:**
  - Access `/platform-admin` (blocked to all others via middleware)
  - Create new organisations
  - Create the first admin user for each organisation (email + temporary password)
  - View a list of all organisations on the platform
- **What they cannot do:** Manage day-to-day data inside organisations (use the Supabase dashboard for that if needed).

### Tier 1: Organisation Admin
- **Who:** The primary contact/administrator for a company, created by the Platform Owner.
- **Can access:** `/admin/users`
- **What they can do:**
  - Create new users (manager or contributor — not admin) within their organisation
  - Assign reporting lines (manager_id) when creating users
  - Update user profiles and roles within their org
  - Manage teams, templates, KPIs
  - View all meetings they organised or were part of, plus all meetings in the org (admin visibility)
  - View all action items in the org
- **What they cannot do:** Create organisations, access another organisation's data, promote themselves to platform admin.

### Tier 2: Manager
- **Who:** Created by an Org Admin.
- **What they can do:**
  - Create and manage meetings (as organiser)
  - Create and manage projects
  - Create and manage templates
  - Create and manage KPIs / KPI records
  - View action items for their direct reports
  - View their own meetings and meetings where they are attendee
- **What they cannot do:** Create users, manage billing, access admin routes.

### Tier 3: Contributor
- **Who:** Created by an Org Admin.
- **What they can do:**
  - View meetings they organised or attended
  - Create projects (as owner) and action items
  - Update their own action item statuses
  - View KPIs in their organisation
- **What they cannot do:** Create users, view other people's meetings, create/delete KPIs.

---

## No Self-Registration
- **There is no public signup.** The login page accepts credentials only.
- Only the Platform Owner can create new organisations.
- Only Org Admins (or the Platform Owner via Supabase dashboard) can create new user accounts.
- New users receive a temporary password from whoever created them and are expected to change it at `/account/change-password` after first login.

---

## Tenant Isolation (Crucial)
- **Rule:** Every query is automatically filtered by `organization_id`.
- **Implementation:** Supabase Row Level Security (RLS) policies enforce this at the database layer. An authenticated user can never read or write records from another organisation regardless of how the request is made.
- **Helper function:** `public.user_organization_id()` returns the current user's org ID and is used in all RLS policies.
- **Global admin:** There is no cross-tenant superadmin role in the application UI. Cross-tenant access is restricted to the Supabase dashboard only.

---

## RLS Policy Summary

| Table         | SELECT                                  | INSERT                        | UPDATE                             | DELETE                |
|---------------|-----------------------------------------|-------------------------------|------------------------------------|-----------------------|
| organizations | Own org only                            | ❌ Blocked (service role only) | Org admin only                     | ❌ Blocked             |
| users         | All members of own org                  | Org admin only                | Own profile (no role change) / Org admin | Org admin (not self) |
| teams         | All members of own org                  | Org admin only                | Org admin                          | Org admin             |
| templates     | All members of own org                  | Manager or admin              | Manager or admin                   | Org admin             |
| meetings      | Organiser / attendee / org admin only   | Manager or admin (as organiser) | Organiser or org admin            | Organiser or org admin |
| projects      | All members of own org                  | Any org member (as owner)     | Owner / manager / admin            | Owner or org admin    |
| action_items  | Own / direct reports (manager) / all (admin) | Any org member           | Assignee or org admin              | Org admin             |
| kpis          | All members of own org                  | Manager or admin              | Manager or admin                   | Org admin             |
| kpi_records   | All members of own org                  | Manager or admin              | Manager or admin                   | Org admin             |

---

## Sensitive Data Considerations
- **1:1 Meeting Notes:** Private to organiser, attendee, and org admins only. The SELECT RLS policy enforces this — org members cannot browse each other's meeting records.
- **Billing:** Stripe customer IDs and subscription statuses are stored on `organizations` and are only visible if a user can SELECT their own org row (org-level, not exposed to contributors in the UI).
- **is_platform_admin:** Cannot be set via app. RLS prevents any user from updating this column on their own or another's profile.
- **Service Role Key:** Used server-side only in `src/utils/supabase/admin.ts`. Never exposed to the client. Never prefixed with `NEXT_PUBLIC_`.

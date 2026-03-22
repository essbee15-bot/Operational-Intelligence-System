# Platform Dashboard & Org Setup — Design

**Date:** 2026-03-22
**Status:** Approved

---

## Problem

The platform admin account (`hello@clearmeasures.co.uk`) has `organization_id = null`, so all org-scoped queries (meetings, projects, KPIs) return empty. There is also no high-level view of platform health and adoption — no way to see which orgs are active, growing, or going quiet.

---

## Approach — Option C (approved)

1. One-time SQL migration creates the "Clear Measures" org and assigns the platform admin to it as an org admin, keeping `is_platform_admin = true`. No code changes — purely a data fix.
2. A "Platform" tab is added to the home dashboard (`/`), visible only to `is_platform_admin = true` users, showing adoption and health metrics across all orgs.
3. The existing `/platform-admin` pages are unchanged — they remain the management area for creating orgs, managing users, and audit.

---

## Section 1 — Organisation Setup

### Migration script
- Insert a new row into `organizations` for "Clear Measures"
- Update the platform admin's `users` row: set `organization_id` to the new org's UUID, `role = 'admin'`, keep `is_platform_admin = true`
- Use `ON CONFLICT DO NOTHING` guards so re-running is safe

### Result
The platform admin account behaves like any org admin for their own team data (meetings, projects, 1:1s, KPIs) while retaining full platform admin access.

---

## Section 2 — Platform Tab Metrics

### Tab visibility
Rendered only when `is_platform_admin = true`. Regular org users never see it.

### Adoption panel
- Summary cards: total orgs, total users, total meetings logged, total active projects
- Per-org breakdown table:
  - Org name
  - User count
  - Meetings logged in last 30 days
  - Active projects count
  - Last activity date (most recent meeting or login)

### Health panel
- Subscription status per org (active / trial / inactive)
- Orgs with no user logins in 30+ days
- Orgs with no meetings logged in 30+ days
- New orgs created in the last 30 days

### Implementation
- Server component — all queries run at request time using `createAdminClient()` (bypasses RLS, sees all orgs)
- No new API routes
- Tab added inline with existing "Overview" and "Team" tabs on `src/app/page.tsx`

---

## Section 3 — Navigation

- "Platform" tab sits inline with "Overview" and "Team" in the home page header
- Conditionally rendered: `{isPlatformAdmin && <PlatformTab />}`
- Existing `/platform-admin` nav links unchanged
- Platform tab is read-only metrics; all management actions remain in `/platform-admin`

---

## Files to Change

| File | Change |
|------|--------|
| `supabase/migrations/YYYYMMDDHHMMSS_clear_measures_org.sql` | Create org, assign platform admin |
| `src/app/page.tsx` | Add Platform tab, fetch cross-org metrics via admin client |

---

## Out of Scope

- Per-org drill-down pages (future)
- Automated churn alerts / emails (future)
- Billing / revenue metrics (future)

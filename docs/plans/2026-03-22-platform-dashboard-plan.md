# Platform Dashboard & Org Setup — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Assign the platform admin to a "Clear Measures" org so the full app works for their team, and add a Platform tab to the home dashboard showing cross-org adoption and health metrics.

**Architecture:** One SQL migration sets up the org and assigns the platform admin. The home page (`src/app/page.tsx`) gains a third tab — "Platform" — visible only to `is_platform_admin = true`, fetching cross-org metrics server-side via `createAdminClient()`. No new routes, no new components beyond the tab section in `page.tsx`.

**Tech Stack:** Next.js 16 App Router (server components), Supabase admin client, inline styles (consistent with existing page.tsx pattern)

---

## Task 1: SQL Migration — Create Clear Measures org and assign platform admin

**Files:**
- Create: `supabase/migrations/20260322000019_clear_measures_org.sql`

**Step 1: Create the migration file**

```sql
-- supabase/migrations/20260322000019_clear_measures_org.sql
-- Creates the Clear Measures organisation and assigns the platform admin to it.
-- Safe to re-run: uses ON CONFLICT DO NOTHING.

DO $$
DECLARE
  org_id UUID := gen_random_uuid();
  existing_org_id UUID;
BEGIN
  -- Check if Clear Measures org already exists
  SELECT id INTO existing_org_id
  FROM public.organizations
  WHERE name = 'Clear Measures'
  LIMIT 1;

  -- Create org only if it doesn't exist
  IF existing_org_id IS NULL THEN
    INSERT INTO public.organizations (id, name, subscription_status, created_at, updated_at)
    VALUES (org_id, 'Clear Measures', 'active', now(), now());
  ELSE
    org_id := existing_org_id;
  END IF;

  -- Assign the platform admin to this org as admin
  -- (keeps is_platform_admin = true)
  UPDATE public.users
  SET
    organization_id = org_id,
    role = 'admin',
    updated_at = now()
  WHERE email = 'hello@clearmeasures.co.uk'
    AND is_platform_admin = true;
END;
$$;
```

**Step 2: Apply the migration in Supabase**

Go to Supabase dashboard → SQL Editor → paste the file contents → Run.

Verify with:
```sql
SELECT u.email, u.role, u.is_platform_admin, o.name as org_name
FROM public.users u
LEFT JOIN public.organizations o ON o.id = u.organization_id
WHERE u.email = 'hello@clearmeasures.co.uk';
```

Expected: one row with `org_name = 'Clear Measures'`, `role = 'admin'`, `is_platform_admin = true`.

**Step 3: Commit**

```bash
git add supabase/migrations/20260322000019_clear_measures_org.sql
git commit -m "feat: create Clear Measures org and assign platform admin"
```

---

## Task 2: Add Platform tab data fetching to home page

**Files:**
- Modify: `src/app/page.tsx`

**Context:** The home page already has an `isPlatformAdmin` boolean (line 37). The existing org-scoped data queries are wrapped in `if (!isPlatformAdmin && profile?.organization_id)` (line 68). We need to:
1. Fix that guard so platform admins WITH an org_id also get org data
2. Add a parallel platform metrics fetch guarded by `isPlatformAdmin`

**Step 1: Fix the org data guard**

Find this line (~line 68):
```typescript
if (!isPlatformAdmin && profile?.organization_id) {
```

Change to:
```typescript
if (profile?.organization_id) {
```

This ensures the platform admin (who now has an org) also loads their own team's widgets.

**Step 2: Add platform metrics fetch**

After the existing org data block (after the closing `}` of the `if (profile?.organization_id)` block), add:

```typescript
// ── Platform metrics (platform admin only) ──────────────────────────────────
interface OrgRow {
  id: string
  name: string
  subscription_status: string | null
  created_at: string
}
interface OrgMetric {
  id: string
  name: string
  subscription_status: string | null
  created_at: string
  userCount: number
  meetingsLast30: number
  activeProjects: number
  lastActivityDate: string | null
}

let platformOrgs: OrgMetric[] = []
let platformTotals = { orgs: 0, users: 0, meetings: 0, activeProjects: 0 }
let quietOrgs: string[] = []      // no meetings in 30 days
let newOrgsLast30 = 0

if (isPlatformAdmin) {
  const adminClient = createAdminClient()
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

  // All orgs
  const { data: orgsRaw } = await adminClient
    .from('organizations')
    .select('id, name, subscription_status, created_at')
    .order('created_at', { ascending: false })

  const orgs: OrgRow[] = orgsRaw ?? []
  platformTotals.orgs = orgs.length
  newOrgsLast30 = orgs.filter(o => o.created_at >= thirtyDaysAgo).length

  // User counts per org
  const { data: usersRaw } = await adminClient
    .from('users')
    .select('organization_id')
  const userCountByOrg: Record<string, number> = {}
  ;(usersRaw ?? []).forEach(u => {
    if (u.organization_id) {
      userCountByOrg[u.organization_id] = (userCountByOrg[u.organization_id] ?? 0) + 1
    }
  })
  platformTotals.users = Object.values(userCountByOrg).reduce((s, c) => s + c, 0)

  // Meetings in last 30 days per org
  const { data: meetingsRaw } = await adminClient
    .from('meetings')
    .select('organization_id, date')
    .gte('date', thirtyDaysAgo)
  const meetingCountByOrg: Record<string, number> = {}
  const lastMeetingByOrg: Record<string, string> = {}
  ;(meetingsRaw ?? []).forEach(m => {
    if (m.organization_id) {
      meetingCountByOrg[m.organization_id] = (meetingCountByOrg[m.organization_id] ?? 0) + 1
      if (!lastMeetingByOrg[m.organization_id] || m.date > lastMeetingByOrg[m.organization_id]!) {
        lastMeetingByOrg[m.organization_id] = m.date
      }
    }
  })
  platformTotals.meetings = Object.values(meetingCountByOrg).reduce((s, c) => s + c, 0)

  // Active projects per org
  const { data: projectsRaw } = await adminClient
    .from('projects')
    .select('organization_id, status')
    .eq('status', 'active')
  const projectCountByOrg: Record<string, number> = {}
  ;(projectsRaw ?? []).forEach(p => {
    if (p.organization_id) {
      projectCountByOrg[p.organization_id] = (projectCountByOrg[p.organization_id] ?? 0) + 1
    }
  })
  platformTotals.activeProjects = Object.values(projectCountByOrg).reduce((s, c) => s + c, 0)

  // Assemble per-org metrics
  platformOrgs = orgs.map(o => ({
    id: o.id,
    name: o.name,
    subscription_status: o.subscription_status,
    created_at: o.created_at,
    userCount: userCountByOrg[o.id] ?? 0,
    meetingsLast30: meetingCountByOrg[o.id] ?? 0,
    activeProjects: projectCountByOrg[o.id] ?? 0,
    lastActivityDate: lastMeetingByOrg[o.id] ?? null,
  }))

  // Quiet orgs: no meetings in last 30 days (exclude brand new orgs < 7 days old)
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  quietOrgs = platformOrgs
    .filter(o => o.meetingsLast30 === 0 && o.created_at < sevenDaysAgo)
    .map(o => o.name)
}
```

**Step 3: Update the activeTab logic to support the platform tab**

Find (~line 26):
```typescript
const activeTab = tab === 'team' ? 'team' : 'overview'
```

Replace with:
```typescript
const activeTab = tab === 'platform' ? 'platform' : tab === 'team' ? 'team' : 'overview'
```

**Step 4: Commit data layer**

```bash
git add src/app/page.tsx
git commit -m "feat: fetch cross-org platform metrics on home page"
```

---

## Task 3: Add Platform tab UI to home page

**Files:**
- Modify: `src/app/page.tsx` (JSX section)

**Context:** Find where the existing tab bar is rendered (look for `tab === 'team'` or `?tab=team` in the JSX). The tab bar needs a third "Platform" tab, and a new JSX block for the platform tab content.

**Step 1: Add Platform tab to the tab bar**

Find the tab bar JSX — it will look something like:
```tsx
<a href="/?tab=overview" ...>Overview</a>
<a href="/?tab=team" ...>Team</a>
```

Add after the Team tab link, wrapped in `{isPlatformAdmin && ...}`:
```tsx
{isPlatformAdmin && (
  <a
    href="/?tab=platform"
    style={{
      padding: '0.5rem 1rem',
      borderRadius: '6px',
      textDecoration: 'none',
      fontSize: '0.875rem',
      fontWeight: activeTab === 'platform' ? 600 : 400,
      backgroundColor: activeTab === 'platform' ? '#111827' : 'transparent',
      color: activeTab === 'platform' ? 'white' : '#6b7280',
    }}
  >
    Platform
  </a>
)}
```

**Step 2: Add Platform tab content panel**

Find where the existing tab content renders (look for `activeTab === 'team'` conditional blocks). Add a new block after:

```tsx
{activeTab === 'platform' && isPlatformAdmin && (
  <div>
    {/* Summary cards */}
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', marginBottom: '2rem' }}>
      {[
        { label: 'Organisations', value: platformTotals.orgs },
        { label: 'Total Users', value: platformTotals.users },
        { label: 'Meetings (30d)', value: platformTotals.meetings },
        { label: 'Active Projects', value: platformTotals.activeProjects },
      ].map(card => (
        <div key={card.label} style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '1.25rem' }}>
          <p style={{ margin: 0, fontSize: '0.75rem', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{card.label}</p>
          <p style={{ margin: '0.25rem 0 0 0', fontSize: '1.75rem', fontWeight: 700, color: '#111827' }}>{card.value}</p>
        </div>
      ))}
    </div>

    {/* Health alerts */}
    {(quietOrgs.length > 0 || newOrgsLast30 > 0) && (
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '2rem' }}>
        {quietOrgs.length > 0 && (
          <div style={{ backgroundColor: '#fef2f2', border: '1px solid #fca5a5', borderRadius: '8px', padding: '1rem' }}>
            <p style={{ margin: 0, fontWeight: 600, color: '#991b1b', fontSize: '0.875rem' }}>⚠ Going quiet ({quietOrgs.length})</p>
            <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.8125rem', color: '#7f1d1d' }}>No meetings in 30+ days</p>
            <ul style={{ margin: '0.5rem 0 0 0', paddingLeft: '1.25rem', fontSize: '0.8125rem', color: '#991b1b' }}>
              {quietOrgs.map(name => <li key={name}>{name}</li>)}
            </ul>
          </div>
        )}
        {newOrgsLast30 > 0 && (
          <div style={{ backgroundColor: '#f0fdf4', border: '1px solid #86efac', borderRadius: '8px', padding: '1rem' }}>
            <p style={{ margin: 0, fontWeight: 600, color: '#166534', fontSize: '0.875rem' }}>✓ New this month</p>
            <p style={{ margin: '0.25rem 0 0 0', fontSize: '2rem', fontWeight: 700, color: '#166534' }}>{newOrgsLast30}</p>
            <p style={{ margin: 0, fontSize: '0.8125rem', color: '#166534' }}>organisations joined in the last 30 days</p>
          </div>
        )}
      </div>
    )}

    {/* Per-org table */}
    <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', overflow: 'hidden' }}>
      <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid #e5e7eb' }}>
        <h3 style={{ margin: 0, fontSize: '0.9375rem', fontWeight: 600 }}>All Organisations</h3>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
        <thead>
          <tr style={{ backgroundColor: '#f9fafb' }}>
            {['Organisation', 'Status', 'Users', 'Meetings (30d)', 'Active Projects', 'Last Meeting'].map(h => (
              <th key={h} style={{ padding: '0.625rem 1rem', textAlign: 'left', fontWeight: 500, color: '#6b7280', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {platformOrgs.map((org, i) => (
            <tr key={org.id} style={{ borderTop: i > 0 ? '1px solid #f3f4f6' : 'none' }}>
              <td style={{ padding: '0.75rem 1rem', fontWeight: 500 }}>{org.name}</td>
              <td style={{ padding: '0.75rem 1rem' }}>
                <span style={{
                  display: 'inline-block', padding: '0.125rem 0.5rem', borderRadius: '9999px', fontSize: '0.75rem', fontWeight: 500,
                  backgroundColor: org.subscription_status === 'active' ? '#dcfce7' : org.subscription_status === 'trial' ? '#fef9c3' : '#f3f4f6',
                  color: org.subscription_status === 'active' ? '#166534' : org.subscription_status === 'trial' ? '#854d0e' : '#6b7280',
                }}>
                  {org.subscription_status ?? 'unknown'}
                </span>
              </td>
              <td style={{ padding: '0.75rem 1rem' }}>{org.userCount}</td>
              <td style={{ padding: '0.75rem 1rem' }}>
                <span style={{ color: org.meetingsLast30 === 0 ? '#dc2626' : '#111827' }}>{org.meetingsLast30}</span>
              </td>
              <td style={{ padding: '0.75rem 1rem' }}>{org.activeProjects}</td>
              <td style={{ padding: '0.75rem 1rem', color: '#6b7280' }}>
                {org.lastActivityDate
                  ? new Date(org.lastActivityDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
                  : '—'}
              </td>
            </tr>
          ))}
          {platformOrgs.length === 0 && (
            <tr>
              <td colSpan={6} style={{ padding: '2rem', textAlign: 'center', color: '#9ca3af' }}>No organisations yet</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  </div>
)}
```

**Step 3: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: no errors.

**Step 4: Build check**

```bash
npx next build 2>&1 | tail -20
```

Expected: clean build, `/` listed as dynamic route.

**Step 5: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat: add Platform tab to home dashboard with cross-org metrics"
```

---

## Verification

1. Sign in as platform admin (`hello@clearmeasures.co.uk`)
2. Home page **Overview** tab shows your Clear Measures team widgets (not empty)
3. Home page **Platform** tab visible and shows:
   - 4 summary cards (orgs, users, meetings, projects)
   - Clear Measures row in the org table
   - Health alerts if any orgs qualify
4. Sign in as a regular org user → Platform tab is **not visible**
5. Navigate to `/meetings/new` as platform admin → works normally, scoped to Clear Measures org

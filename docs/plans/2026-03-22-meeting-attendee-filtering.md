# Meeting Attendee Filtering Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the "all org users" attendee dropdowns on the New Meeting form with smart filtered defaults and a chip-based typeahead picker so booking a meeting takes seconds rather than scrolling through thousands of names.

**Architecture:** Server-side filtering loads the right people per meeting type (direct reports, team members, project team). A single `AttendeesPicker` client component renders chips + typeahead search against a new auth-gated `/api/users/search` route for adding extras. Project meetings gain a URL-param-driven project selector so the server can load the correct attendees before the form renders.

**Tech Stack:** Next.js 16 App Router, Supabase SSR client, React useState/useEffect for the picker, no external libraries.

---

### Task 1: DB Migration — add `project_id` to meetings

**Files:**
- Create: `supabase/migrations/20260322000018_meeting_project_id.sql`

**Step 1: Create the migration file**

```sql
-- Allow meetings to be linked to a specific project
-- (used by project_meeting type to carry forward attendees correctly)
ALTER TABLE meetings
  ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE SET NULL;
```

**Step 2: Apply the migration**

Run in terminal:
```bash
npx supabase db push
```
Expected: migration applies cleanly, no errors.

**Step 3: Verify**

In the Supabase dashboard → Table Editor → meetings table → confirm `project_id` column exists (nullable UUID).

**Step 4: Commit**

```bash
git add supabase/migrations/20260322000018_meeting_project_id.sql
git commit -m "feat: add project_id column to meetings for project meeting linking"
```

---

### Task 2: User Search API Route

**Files:**
- Create: `src/app/api/users/search/route.ts`

**Context:**
- Must be auth-gated — only returns users from the caller's organisation.
- `exclude` param is a comma-separated list of UUIDs to omit from results (already-selected attendees).
- Returns max 10 results ordered by `full_name`.
- Excludes anonymised users.

**Step 1: Create the route file**

```typescript
import { createClient } from '@/utils/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ users: [] }, { status: 401 })

  const { data: profile } = await supabase
    .from('users')
    .select('organization_id')
    .eq('id', user.id)
    .single()
  if (!profile) return NextResponse.json({ users: [] }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const q = (searchParams.get('q') ?? '').trim()
  const excludeParam = searchParams.get('exclude') ?? ''
  const excludeIds = excludeParam.split(',').filter(Boolean)

  if (q.length < 3) return NextResponse.json({ users: [] })

  let query = supabase
    .from('users')
    .select('id, full_name, email')
    .eq('organization_id', profile.organization_id)
    .eq('is_anonymised', false)
    .neq('id', user.id)
    .or(`full_name.ilike.%${q}%,email.ilike.%${q}%`)
    .order('full_name')
    .limit(10)

  if (excludeIds.length > 0) {
    query = query.not('id', 'in', `(${excludeIds.join(',')})`)
  }

  const { data: users } = await query
  return NextResponse.json({ users: users ?? [] })
}
```

**Step 2: Verify the route builds**

```bash
cd C:\Users\essbe\Ai\leadership-hub
npx next build 2>&1 | tail -20
```
Expected: `✓ Compiled successfully` with no TypeScript errors.

**Step 3: Commit**

```bash
git add src/app/api/users/search/route.ts
git commit -m "feat: add auth-gated org-scoped user search API route"
```

---

### Task 3: AttendeesPicker Client Component

**Files:**
- Create: `src/components/AttendeesPicker.tsx`

**Context:**
- Used for team_meeting and project_meeting (multi-attendee forms).
- `defaultAttendees` = pre-filtered list loaded server-side, shown as pre-selected chips.
- Outputs hidden `<input name="attendee_ids[]">` per chip — compatible with existing server action.
- Search fires at 3+ characters, debounced 300ms.
- Dropdown shows up to 10 results, click to add.
- If `defaultAttendees` is empty, the search input is auto-focused.

**Step 1: Create the component**

```typescript
'use client'

import { useState, useEffect, useRef } from 'react'

interface User {
  id: string
  full_name: string | null
  email: string
}

interface AttendeesPickerProps {
  defaultAttendees: User[]
}

export function AttendeesPicker({ defaultAttendees }: AttendeesPickerProps) {
  const [selected, setSelected] = useState<User[]>(defaultAttendees)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<User[]>([])
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // Auto-focus if no defaults
  useEffect(() => {
    if (defaultAttendees.length === 0) inputRef.current?.focus()
  }, [defaultAttendees.length])

  // Debounced search
  useEffect(() => {
    if (query.length < 3) {
      setResults([])
      return
    }
    const timer = setTimeout(async () => {
      setLoading(true)
      try {
        const exclude = selected.map(u => u.id).join(',')
        const res = await fetch(
          `/api/users/search?q=${encodeURIComponent(query)}&exclude=${encodeURIComponent(exclude)}`
        )
        const data = await res.json()
        setResults(data.users ?? [])
      } finally {
        setLoading(false)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [query, selected])

  function addUser(u: User) {
    setSelected(prev => [...prev, u])
    setResults([])
    setQuery('')
    inputRef.current?.focus()
  }

  function removeUser(id: string) {
    setSelected(prev => prev.filter(u => u.id !== id))
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      {/* Hidden inputs for server action */}
      {selected.map(u => (
        <input key={u.id} type="hidden" name="attendee_ids[]" value={u.id} />
      ))}

      {/* Chips */}
      {selected.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem' }}>
          {selected.map(u => (
            <span
              key={u.id}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '0.25rem',
                padding: '0.25rem 0.625rem', backgroundColor: '#f3f4f6',
                border: '1px solid #d1d5db', borderRadius: '999px',
                fontSize: '0.8125rem', color: '#111827',
              }}
            >
              {u.full_name ?? u.email}
              <button
                type="button"
                onClick={() => removeUser(u.id)}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  padding: '0', lineHeight: 1, color: '#6b7280', fontSize: '1rem',
                }}
                aria-label={`Remove ${u.full_name ?? u.email}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Search input */}
      <div style={{ position: 'relative' }}>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={selected.length === 0 ? 'Type a name to search…' : 'Add another person…'}
          style={{
            width: '100%', padding: '0.5rem', border: '1px solid #d1d5db',
            borderRadius: '4px', fontSize: '0.875rem', boxSizing: 'border-box',
          }}
        />

        {/* Dropdown results */}
        {(results.length > 0 || loading) && (
          <div style={{
            position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10,
            backgroundColor: 'white', border: '1px solid #d1d5db',
            borderTop: 'none', borderRadius: '0 0 4px 4px',
            boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
          }}>
            {loading && (
              <div style={{ padding: '0.5rem 0.75rem', fontSize: '0.8125rem', color: '#9ca3af' }}>
                Searching…
              </div>
            )}
            {results.map(u => (
              <button
                key={u.id}
                type="button"
                onClick={() => addUser(u)}
                style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  padding: '0.5rem 0.75rem', background: 'none', border: 'none',
                  cursor: 'pointer', fontSize: '0.875rem', color: '#111827',
                }}
                onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#f9fafb')}
                onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
              >
                {u.full_name ?? u.email}
                {u.full_name && (
                  <span style={{ color: '#9ca3af', marginLeft: '0.5rem', fontSize: '0.8125rem' }}>
                    {u.email}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {selected.length === 0 && query.length < 3 && (
        <p style={{ margin: 0, fontSize: '0.8125rem', color: '#9ca3af' }}>
          Type at least 3 characters to search all staff.
        </p>
      )}
    </div>
  )
}
```

**Step 2: Verify it compiles**

```bash
npx next build 2>&1 | tail -20
```
Expected: `✓ Compiled successfully`.

**Step 3: Commit**

```bash
git add src/components/AttendeesPicker.tsx
git commit -m "feat: add AttendeesPicker client component with chip ui and typeahead search"
```

---

### Task 4: Update 1:1 and Performance Review — filter to direct reports

**Files:**
- Modify: `src/app/meetings/new/page.tsx`

**Context:**
- Currently loads all org users into `orgUsers` and passes them to both the 1:1 and performance review `<select>` elements.
- Change: load direct reports separately as `directReports` (users where `manager_id = current user's id`).
- Keep the `<select>` element for these two types (single-person selection, small list).
- If zero direct reports: fall back to showing all org users with a helper note.

**Step 1: Add `directReports` query after the existing `orgUsers` query**

In `src/app/meetings/new/page.tsx`, after the `orgUsers` query (line 55), add:

```typescript
// Direct reports — for 1:1 and performance review selectors
const { data: directReports } = await supabase
  .from('users')
  .select('id, full_name, email')
  .eq('organization_id', profile.organization_id)
  .eq('manager_id', user.id)
  .eq('is_anonymised', false)
  .order('full_name')

// Fall back to all org users if manager has no direct reports
const oneOnOnePool = (directReports && directReports.length > 0)
  ? directReports
  : (orgUsers ?? [])
const showingAllForOneOnOne = !directReports || directReports.length === 0
```

**Step 2: Update the 1:1 `<select>` to use `oneOnOnePool`**

Replace (around line 136):
```tsx
{(orgUsers ?? []).map(u => (
  <option key={u.id} value={u.id}>{u.full_name ?? u.email}</option>
))}
```
With:
```tsx
{showingAllForOneOnOne && (
  <option value="" disabled>No direct reports found — showing all staff</option>
)}
{oneOnOnePool.map(u => (
  <option key={u.id} value={u.id}>{u.full_name ?? u.email}</option>
))}
```

**Step 3: Do the same for the performance review `<select>` (around line 195)**

Same replacement — use `oneOnOnePool` and the same fallback note.

**Step 4: Verify build**

```bash
npx next build 2>&1 | tail -20
```
Expected: `✓ Compiled successfully`.

**Step 5: Commit**

```bash
git add src/app/meetings/new/page.tsx
git commit -m "feat: filter 1:1 and review attendee dropdowns to direct reports"
```

---

### Task 5: Update Team Meeting — smart defaults with AttendeesPicker

**Files:**
- Modify: `src/app/meetings/new/page.tsx`

**Context:**
- Team meeting attendees = direct reports + members of teams the current user belongs to (deduplicated), minus the current user.
- "Subsequent booking" carry-forward: if there's a previous team_meeting by this organiser, pre-select those attendees instead.
- Replace the `<select multiple>` with `<AttendeesPicker defaultAttendees={teamDefaults} />`.

**Step 1: Add the team meeting defaults query**

After the `oneOnOnePool` block (Task 4), add:

```typescript
// Team meeting defaults: direct reports + team members, deduplicated
// First check for previous team meeting attendees (carry-forward)
const { data: prevTeamMeeting } = await supabase
  .from('meetings')
  .select('id')
  .eq('organization_id', profile.organization_id)
  .eq('meeting_type', 'team_meeting')
  .eq('organizer_id', user.id)
  .order('date', { ascending: false })
  .limit(1)
  .maybeSingle()

let teamDefaults: { id: string; full_name: string | null; email: string }[] = []

if (prevTeamMeeting) {
  // Carry forward previous attendees
  const { data: prevAttendees } = await supabase
    .from('meeting_attendees')
    .select('users(id, full_name, email)')
    .eq('meeting_id', prevTeamMeeting.id)
  teamDefaults = (prevAttendees ?? [])
    .map(row => (row.users as { id: string; full_name: string | null; email: string } | null))
    .filter((u): u is { id: string; full_name: string | null; email: string } => u !== null)
} else {
  // First booking: direct reports + team members
  const { data: myTeamMemberships } = await supabase
    .from('team_members')
    .select('team_id')
    .eq('user_id', user.id)

  const teamIds = (myTeamMemberships ?? []).map(m => m.team_id)

  let teamMates: { id: string; full_name: string | null; email: string }[] = []
  if (teamIds.length > 0) {
    const { data: members } = await supabase
      .from('team_members')
      .select('users(id, full_name, email)')
      .in('team_id', teamIds)
      .neq('user_id', user.id)
    teamMates = (members ?? [])
      .map(row => (row.users as { id: string; full_name: string | null; email: string } | null))
      .filter((u): u is { id: string; full_name: string | null; email: string } => u !== null)
  }

  // Merge direct reports + team mates, deduplicate by id
  const seen = new Set<string>()
  teamDefaults = [...(directReports ?? []), ...teamMates].filter(u => {
    if (seen.has(u.id)) return false
    seen.add(u.id)
    return true
  })
}
```

**Step 2: Add the import at the top of the file**

```typescript
import { AttendeesPicker } from '@/components/AttendeesPicker'
```

**Step 3: Replace the team meeting `<select multiple>` with AttendeesPicker**

Remove (around lines 270–283):
```tsx
<div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
  <label style={{ fontSize: '0.875rem', fontWeight: 500 }}>
    Attendees <span style={{ color: '#9ca3af', fontWeight: 400 }}>(hold Ctrl/Cmd to select multiple)</span>
  </label>
  <select
    name="attendee_ids[]"
    multiple
    size={Math.min(8, (orgUsers ?? []).length + 1)}
    style={{ padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem', backgroundColor: 'white' }}
  >
    {(orgUsers ?? []).map(u => (
      <option key={u.id} value={u.id}>{u.full_name ?? u.email}</option>
    ))}
  </select>
</div>
```

Replace with:
```tsx
<div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
  <label style={{ fontSize: '0.875rem', fontWeight: 500 }}>Attendees</label>
  {prevTeamMeeting && (
    <p style={{ margin: 0, fontSize: '0.8125rem', color: '#6b7280' }}>
      Pre-filled from your last team meeting — adjust as needed.
    </p>
  )}
  <AttendeesPicker defaultAttendees={teamDefaults} />
</div>
```

**Step 4: Verify build**

```bash
npx next build 2>&1 | tail -20
```
Expected: `✓ Compiled successfully`.

**Step 5: Commit**

```bash
git add src/app/meetings/new/page.tsx
git commit -m "feat: team meeting attendees smart defaults with carry-forward and chip picker"
```

---

### Task 6: Update Project Meeting — project selector + smart defaults

**Files:**
- Modify: `src/app/meetings/new/page.tsx`

**Context:**
- Add a project selector as the first field of the project meeting form.
- When `?type=project_meeting&project_id=<id>` is in the URL, pre-populate attendees from:
  1. Previous project meeting for that project (carry-forward), or
  2. The project's team members (first booking).
- The project selector navigates to `?type=project_meeting&project_id=<id>` on change (client-side onChange).
- Replace the `<select multiple>` with `<AttendeesPicker defaultAttendees={projectDefaults} />`.

**Step 1: Add `project_id` to the page's searchParams type**

Change the function signature at the top of the page:
```typescript
export default async function NewMeetingPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; message?: string; project_id?: string }>
})
```

And destructure it:
```typescript
const { type: typeParam, message, project_id: projectIdParam } = await searchParams
```

**Step 2: Add org projects query and project meeting defaults**

After the `teamDefaults` block (Task 5), add:

```typescript
// Projects for project meeting selector
const { data: orgProjects } = await supabase
  .from('projects')
  .select('id, name, team_id')
  .eq('organization_id', profile.organization_id)
  .order('name')

// Project meeting defaults
let projectDefaults: { id: string; full_name: string | null; email: string }[] = []

if (activeType === 'project_meeting' && projectIdParam) {
  // Check for previous project meeting for this project (carry-forward)
  const { data: prevProjectMeeting } = await supabase
    .from('meetings')
    .select('id')
    .eq('organization_id', profile.organization_id)
    .eq('meeting_type', 'project_meeting')
    .eq('project_id', projectIdParam)
    .order('date', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (prevProjectMeeting) {
    const { data: prevAttendees } = await supabase
      .from('meeting_attendees')
      .select('users(id, full_name, email)')
      .eq('meeting_id', prevProjectMeeting.id)
    projectDefaults = (prevAttendees ?? [])
      .map(row => (row.users as { id: string; full_name: string | null; email: string } | null))
      .filter((u): u is { id: string; full_name: string | null; email: string } => u !== null)
  } else {
    // First booking: load project team members
    const project = (orgProjects ?? []).find(p => p.id === projectIdParam)
    if (project?.team_id) {
      const { data: members } = await supabase
        .from('team_members')
        .select('users(id, full_name, email)')
        .eq('team_id', project.team_id)
        .neq('user_id', user.id)
      projectDefaults = (members ?? [])
        .map(row => (row.users as { id: string; full_name: string | null; email: string } | null))
        .filter((u): u is { id: string; full_name: string | null; email: string } => u !== null)
    }
  }
}
```

**Step 3: Replace the project meeting form**

Replace the entire project meeting `<form>` section with:

```tsx
{activeType === 'project_meeting' && (
  <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '1.5rem' }}>
    <h2 style={{ margin: '0 0 0.25rem 0', fontSize: '1.0625rem', fontWeight: 600 }}>Project Meeting Details</h2>
    <p style={{ margin: '0 0 1.25rem 0', fontSize: '0.8125rem', color: '#6b7280' }}>
      Select a project — attendees will pre-fill from your last meeting for that project.
    </p>
    <form style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <input type="hidden" name="meeting_type" value="project_meeting" />
      {projectIdParam && <input type="hidden" name="project_id" value={projectIdParam} />}

      {/* Project selector — navigates via URL param */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
        <label htmlFor="project_selector" style={{ fontSize: '0.875rem', fontWeight: 500 }}>Project</label>
        <select
          id="project_selector"
          defaultValue={projectIdParam ?? ''}
          onChange="window.location.href='/meetings/new?type=project_meeting&project_id='+this.value"
          style={{ padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem', backgroundColor: 'white' }}
        >
          <option value="">Select a project…</option>
          {(orgProjects ?? []).map(p => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>

      {projectIdParam && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
              <label htmlFor="date" style={{ fontSize: '0.875rem', fontWeight: 500 }}>Date</label>
              <input
                id="date" name="date" type="date" required
                defaultValue={today}
                style={{ padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem' }}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
              <label htmlFor="time" style={{ fontSize: '0.875rem', fontWeight: 500 }}>Time</label>
              <input
                id="time" name="time" type="time" defaultValue="09:00"
                style={{ padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem' }}
              />
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
            <label htmlFor="purpose" style={{ fontSize: '0.875rem', fontWeight: 500 }}>Purpose / Title</label>
            <input
              id="purpose" name="purpose" type="text" required maxLength={300}
              placeholder="e.g. Sprint Review"
              style={{ padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem' }}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
            <label style={{ fontSize: '0.875rem', fontWeight: 500 }}>Attendees</label>
            <AttendeesPicker defaultAttendees={projectDefaults} />
          </div>

          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.25rem' }}>
            <button
              formAction={createMeeting}
              style={{ padding: '0.625rem 1.25rem', backgroundColor: '#111827', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.875rem' }}
            >
              Create Meeting
            </button>
            <a
              href="/meetings/new"
              style={{ padding: '0.625rem 1rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem', color: '#374151', textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}
            >
              ← Change type
            </a>
          </div>
        </>
      )}
    </form>
  </div>
)}
```

**Note on project selector onChange:** The `onChange` as a string won't work in JSX. Create a tiny client component wrapper `src/components/ProjectSelector.tsx`:

```typescript
'use client'

interface Project { id: string; name: string }

export function ProjectSelector({ projects, currentProjectId }: { projects: Project[]; currentProjectId?: string }) {
  return (
    <select
      id="project_selector"
      defaultValue={currentProjectId ?? ''}
      onChange={e => {
        if (e.target.value) {
          window.location.href = `/meetings/new?type=project_meeting&project_id=${e.target.value}`
        }
      }}
      style={{ padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem', backgroundColor: 'white' }}
    >
      <option value="">Select a project…</option>
      {projects.map(p => (
        <option key={p.id} value={p.id}>{p.name}</option>
      ))}
    </select>
  )
}
```

Use `<ProjectSelector projects={orgProjects ?? []} currentProjectId={projectIdParam} />` in the form instead of the raw `<select>`.

**Step 4: Verify build**

```bash
npx next build 2>&1 | tail -20
```
Expected: `✓ Compiled successfully`.

**Step 5: Commit**

```bash
git add src/app/meetings/new/page.tsx src/components/ProjectSelector.tsx
git commit -m "feat: project meeting form with project selector and smart attendee defaults"
```

---

### Task 7: Update createMeeting action to store project_id

**Files:**
- Modify: `src/app/meetings/new/actions.ts`

**Context:**
- The project meeting branch of `createMeeting` needs to read `project_id` from the form and store it on the meeting row.
- This enables future carry-forward queries to find meetings for the same project.

**Step 1: Add project_id extraction in the `team_meeting / project_meeting` branch**

In `src/app/meetings/new/actions.ts`, inside the `else` block (around line 141), after `const purpose = ...`, add:

```typescript
const projectId = meetingType === 'project_meeting'
  ? (formData.get('project_id') as string | null) || null
  : null
```

**Step 2: Add `project_id` to the insert payload**

In the `.insert({...})` call (around line 170), add:

```typescript
project_id: projectId,
```

**Step 3: Verify build**

```bash
npx next build 2>&1 | tail -20
```
Expected: `✓ Compiled successfully`.

**Step 4: Commit**

```bash
git add src/app/meetings/new/actions.ts
git commit -m "feat: store project_id on project meetings for carry-forward attendee logic"
```

---

### Task 8: Manual Verification

**Step 1: Start the dev server**

```bash
cd C:\Users\essbe\Ai\leadership-hub
npx next dev
```

**Step 2: Verify each form type**

| Scenario | Expected |
|---|---|
| New → 1:1 → Employee dropdown | Shows only direct reports (not all org users) |
| New → 1:1 (no direct reports) | Shows all users with "No direct reports found" note |
| New → Performance Review | Same filtering as 1:1 |
| New → Team Meeting (first booking) | AttendeesPicker pre-filled with direct reports + team members |
| New → Team Meeting (prev meeting exists) | AttendeesPicker pre-filled with last meeting's attendees + carry-forward note |
| New → Project Meeting | Project selector shown; no attendees/date until project selected |
| New → Project Meeting → select project | Attendees pre-fill from project team; full form appears |
| Type 3+ chars in AttendeesPicker | Dropdown of matching org users appears |
| Type fewer than 3 chars | No dropdown, hint text shown |
| Click ✕ on chip | Person removed from selection |
| Submit form | Meeting created, redirected to meeting detail page |

**Step 3: Commit any fixes found during verification**

```bash
git add -p
git commit -m "fix: address issues found during manual attendee picker verification"
```

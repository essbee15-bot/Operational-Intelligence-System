# External Attendees — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow meetings to include external attendees (free-text names) and make internal attendees optional so solo and external-only meetings can be logged.

**Architecture:** One migration adds `external_attendees TEXT NULL` to the meetings table. The new meeting form gains a text input on all four types. The server action relaxes attendee validation and stores the field. The detail view surfaces external names alongside internal attendees.

**Tech Stack:** Next.js 16 App Router, Supabase, server actions, inline styles

---

## Task 1: SQL Migration — add external_attendees column

**Files:**
- Create: `supabase/migrations/20260322000020_external_attendees.sql`

**Step 1: Create the migration file**

```sql
-- supabase/migrations/20260322000020_external_attendees.sql
-- Adds optional free-text external attendees to meetings.
ALTER TABLE meetings
  ADD COLUMN IF NOT EXISTS external_attendees TEXT NULL;
```

**Step 2: Apply in Supabase dashboard**

Go to Supabase dashboard → SQL Editor → paste and run:
```sql
ALTER TABLE meetings
  ADD COLUMN IF NOT EXISTS external_attendees TEXT NULL;
```

Verify:
```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'meetings' AND column_name = 'external_attendees';
```
Expected: one row, `data_type = text`, `is_nullable = YES`.

**Step 3: Commit the file**
```bash
git add supabase/migrations/20260322000020_external_attendees.sql
git commit -m "feat: add external_attendees column to meetings"
```

---

## Task 2: Add external attendees input to the new meeting form

**Files:**
- Modify: `src/app/meetings/new/page.tsx`

**Context:** The page renders four separate form blocks based on `activeType`. Each block needs a new optional text input for external attendees. The input appears below the existing attendee selector/picker in each form block. Read the full file before editing — each form block is clearly separated.

**Step 1: Add the input to the 1:1 form block**

Find the 1:1 form section (look for `meeting_type` hidden input with value `one_on_one`). After the employee `<select>` and before the date/time fields, add:

```tsx
<div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
  <label htmlFor="external_attendees_1on1" style={{ fontSize: '0.875rem', fontWeight: 500 }}>
    External attendees <span style={{ color: '#9ca3af', fontWeight: 400 }}>(optional)</span>
  </label>
  <input
    id="external_attendees_1on1"
    name="external_attendees"
    type="text"
    maxLength={500}
    placeholder="e.g. John Smith, Sarah Jones"
    style={{ padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem' }}
  />
</div>
```

**Step 2: Add the same input to the performance review form block**

Find the `performance_review` form section. Add the same input block after the employee `<select>`, changing `id` to `external_attendees_review`.

**Step 3: Add to the team meeting form block**

Find the `team_meeting` section (contains `<AttendeesPicker`). Add the same input after the `<AttendeesPicker />`, changing `id` to `external_attendees_team`.

**Step 4: Add to the project meeting form block**

Find the `project_meeting` section (contains `<ProjectSelector` and `<AttendeesPicker`). Add the same input after the `<AttendeesPicker />`, changing `id` to `external_attendees_project`.

**Step 5: TypeScript check**
```bash
cd "C:/Users/essbe/Ai/leadership-hub" && npx tsc --noEmit 2>&1
```
Expected: no errors.

**Step 6: Commit**
```bash
git add src/app/meetings/new/page.tsx
git commit -m "feat: add external attendees input to all meeting form types"
```

---

## Task 3: Update the server action to store external attendees

**Files:**
- Modify: `src/app/meetings/new/actions.ts`

**Context:** Read the full file. It has three branches: `one_on_one`, `performance_review`, and `else` (team/project). Each branch needs:
1. Extract `external_attendees` from formData
2. Relax mandatory `attendee_id` validation
3. Use external name in title fallback when no internal attendee
4. Add `external_attendees` to the insert payload

**Step 1: Extract and sanitise external_attendees at the top of each branch**

In the `one_on_one` branch, add after the existing `attendeeId` extraction:

```typescript
const rawExternal = (formData.get('external_attendees') as string ?? '').trim()
const externalAttendees = rawExternal.slice(0, 500) || null
```

**Step 2: Relax the 1:1 attendee_id redirect**

Find:
```typescript
if (!attendeeId) {
  redirect('/meetings/new?type=one_on_one&message=Please select an employee')
}
if (!UUID_RE.test(attendeeId)) {
  redirect('/meetings/new?type=one_on_one&message=Invalid employee selection')
}
```

Replace with:
```typescript
const safeAttendeeId = attendeeId && UUID_RE.test(attendeeId) ? attendeeId : null
```

**Step 3: Update the 1:1 title generation to handle no internal attendee**

Find the title generation block that fetches the attendee's name. Replace it with:

```typescript
let attendeeName = 'Unknown'
if (safeAttendeeId) {
  const { data: attendee } = await adminClient
    .from('users')
    .select('full_name, email')
    .eq('id', safeAttendeeId)
    .single()
  attendeeName = attendee?.full_name ?? attendee?.email ?? 'Unknown'
} else if (externalAttendees) {
  // Use first external name for title
  attendeeName = externalAttendees.split(',')[0]?.trim() ?? 'External'
}

const title = attendeeName !== 'Unknown' && attendeeName !== 'External' || externalAttendees
  ? `1:1 — ${attendeeName} — ${new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`
  : `1:1 — ${new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`
```

Simplify the above — use this cleaner version:

```typescript
let attendeeName: string | null = null
if (safeAttendeeId) {
  const { data: attendee } = await adminClient
    .from('users').select('full_name, email').eq('id', safeAttendeeId).single()
  attendeeName = attendee?.full_name ?? attendee?.email ?? null
} else if (externalAttendees) {
  attendeeName = externalAttendees.split(',')[0]?.trim() ?? null
}
const datePart = new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
const title = attendeeName ? `1:1 — ${attendeeName} — ${datePart}` : `1:1 — ${datePart}`
```

**Step 4: Add external_attendees and update attendee_id in the 1:1 insert payload**

Find the `meetings` insert in the `one_on_one` branch. Update it:

```typescript
const { data: meeting, error } = await adminClient
  .from('meetings')
  .insert({
    organization_id: orgId,
    meeting_type: 'one_on_one',
    title,
    organizer_id: user.id,
    attendee_id: safeAttendeeId,       // was attendeeId — now nullable
    date: dateTime.toISOString(),
    previous_meeting_id: previousMeetingId,
    external_attendees: externalAttendees,
  })
  .select('id')
  .single()
```

**Step 5: Apply same changes to performance_review branch**

Repeat steps 1–4 for the `performance_review` branch:
- Extract `externalAttendees`
- Replace mandatory redirect with `safeAttendeeId` pattern
- Update title generation:
  ```typescript
  let attendeeName: string | null = null
  if (safeAttendeeId) {
    const { data: attendee } = await adminClient
      .from('users').select('full_name, email').eq('id', safeAttendeeId).single()
    attendeeName = attendee?.full_name ?? attendee?.email ?? null
  } else if (externalAttendees) {
    attendeeName = externalAttendees.split(',')[0]?.trim() ?? null
  }
  const datePart = new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  const title = attendeeName
    ? `Review — ${attendeeName} — ${reviewPeriod ?? datePart}`
    : `Review — ${reviewPeriod ?? datePart}`
  ```
- Add `external_attendees: externalAttendees` and `attendee_id: safeAttendeeId` to insert

**Step 6: Add external_attendees to the team/project branch**

In the `else` block (team_meeting / project_meeting), add after the existing `attendeeIds` line:

```typescript
const rawExternal = (formData.get('external_attendees') as string ?? '').trim()
const externalAttendees = rawExternal.slice(0, 500) || null
```

Add `external_attendees: externalAttendees` to the meetings insert payload.

**Step 7: Update the previousMeeting query for 1:1 to use safeAttendeeId**

The existing `.or()` filter uses `attendeeId`. Update it to use `safeAttendeeId`, and guard the whole query:

```typescript
let previousMeetingId: string | null = null
if (safeAttendeeId) {
  const { data: prevMeeting } = await adminClient
    .from('meetings')
    .select('id')
    .eq('organization_id', orgId)
    .eq('meeting_type', 'one_on_one')
    .or(`and(organizer_id.eq.${user.id},attendee_id.eq.${safeAttendeeId}),and(organizer_id.eq.${safeAttendeeId},attendee_id.eq.${user.id})`)
    .order('date', { ascending: false })
    .limit(1)
    .maybeSingle()
  previousMeetingId = prevMeeting?.id ?? null
}
```

**Step 8: TypeScript check**
```bash
npx tsc --noEmit 2>&1
```
Fix any errors before committing.

**Step 9: Commit**
```bash
git add src/app/meetings/new/actions.ts
git commit -m "feat: store external_attendees, make internal attendee optional"
```

---

## Task 4: Display external attendees on the meeting detail page

**Files:**
- Modify: `src/app/meetings/[id]/page.tsx`

**Context:** The detail page builds a `participantsLine` string (around line 292) used in the subtitle. It also shows structured attendee sections further down. Read the file to find these exact locations.

**Step 1: Add external_attendees to the meeting select query**

Find the meeting fetch query (it selects `id, title, meeting_type, ...`). Add `external_attendees` to the select string:

```typescript
.select('id, title, meeting_type, organizer_id, attendee_id, date, purpose, notes, review_period, previous_meeting_id, external_attendees')
```

**Step 2: Update participantsLine to include external names**

Find (around line 292–297):
```typescript
let participantsLine = ''
```

After the existing `participantsLine` is built (after the if/else block), append external names:

```typescript
const externalNames = (meeting.external_attendees as string | null)?.trim()
if (externalNames) {
  participantsLine = participantsLine
    ? `${participantsLine}, ${externalNames} (external)`
    : `${externalNames} (external)`
}
```

**Step 3: Display external attendees in the attendees section**

Find where internal attendees are displayed in JSX (look for `participantsLine` in JSX or the attendees detail section). After the internal attendees display, add:

```tsx
{(meeting.external_attendees as string | null) && (
  <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.8125rem', color: '#6b7280' }}>
    <span style={{ fontWeight: 500 }}>External: </span>
    {meeting.external_attendees as string}
  </p>
)}
```

**Step 4: TypeScript check**
```bash
npx tsc --noEmit 2>&1
```

**Step 5: Build check**
```bash
npx next build 2>&1 | tail -15
```
Expected: clean build.

**Step 6: Commit**
```bash
git add src/app/meetings/[id]/page.tsx
git commit -m "feat: display external attendees on meeting detail page"
```

---

## Verification

1. Go to `/meetings/new` → select **1:1** → leave employee dropdown blank → enter "John Smith" in External attendees → submit → meeting created with title `1:1 — John Smith — 22 Mar 2026`
2. Open the created meeting → "External: John Smith" visible in attendees section
3. Create a **1:1** with an internal attendee AND external name → both appear correctly
4. Create a **team meeting** → add external names → detail page shows them
5. Create a meeting with no internal and no external attendees → submits as a solo meeting with title `1:1 — 22 Mar 2026`

# Meeting Attendee Filtering Design

**Date:** 2026-03-22
**Status:** Approved

## Problem

The "New Meeting" form loads every user in the organisation into the attendee dropdown. At scale (e.g. 3,000 people) this is unusable. Leaders also shouldn't need to hunt for the right people — the system already knows who their team is.

## Approach

Option B: server-side smart defaults + client-side chip picker with typeahead search.

## Architecture

```
New Meeting page (server component)
  │
  ├── Loads filtered user list server-side (per meeting type)
  │     ├── 1:1 / Review   → direct reports only  (manager_id = you)
  │     ├── Team Meeting   → direct reports + your team members (deduplicated)
  │     └── Project Meeting → team members of the selected project
  │
  ├── AttendeesPicker  ('use client' component)
  │     ├── Pre-selected chips = filtered defaults
  │     ├── Search input (3+ chars) → /api/users/search?q=&exclude=
  │     ├── Dropdown shows up to 10 results from rest of org
  │     └── Hidden inputs  attendee_ids[]  for existing server action
  │
  └── /api/users/search  (route handler)
        ├── Auth-gated, own org only
        └── Returns id, full_name, email  matching query (max 10)
```

## Smart Defaults — "Complex Once"

| Meeting type | First booking | Subsequent bookings |
|---|---|---|
| 1:1 / Performance Review | Dropdown of direct reports | Same (fixed set) |
| Team Meeting | Pre-selected: direct reports + team members | Pre-selected: attendees from last team meeting |
| Project Meeting | Pick project → pre-selected: project's team members | Pre-selected: attendees from last meeting for that project |

The project selector is only required the first time. After that the system carries forward the previous meeting's attendee list, matching the existing action carry-forward pattern.

## Component Detail

### AttendeesPicker
- Chip per selected person with ✕ to remove
- Search fires at 3+ characters, debounced
- Dropdown shows up to 10 org users not already selected
- Click to add as a chip
- One hidden `<input name="attendee_ids[]">` per chip for server action compatibility
- If no pre-selected people (e.g. manager with no reports), search box is focused automatically

### /api/users/search
- `GET /api/users/search?q=<query>&exclude=<comma-separated-ids>`
- Requires active session
- Scoped to current user's organisation — no cross-org leakage
- Returns max 10 results ordered by `full_name`
- Excludes anonymised users

### Project Meeting — project selector
- Added as step one of the project meeting form
- Loads the current user's org projects
- On selection, pre-populates attendees from that project's team (`projects.team_id → team_members`)
- Falls back to empty + open search if project has no team assigned

## Edge Cases

| Scenario | Behaviour |
|---|---|
| Manager has no direct reports | 1:1 / Team Meeting starts empty, search box focused |
| Project has no team assigned | Falls back to empty pre-selection + search |
| No previous meeting found for project | Falls back to project team members (first-booking logic) |
| Person leaves org (anonymised) | Excluded from search results and stripped from pre-selection |

## Files to Create / Modify

| File | Change |
|---|---|
| `src/app/meetings/new/page.tsx` | Add smart defaults query logic per meeting type; add project selector for project_meeting; pass defaults to AttendeesPicker |
| `src/components/AttendeesPicker.tsx` | New client component — chip picker with typeahead |
| `src/app/api/users/search/route.ts` | New route handler — auth-gated org-scoped user search |

## Out of Scope

- Calendar integration (deferred — app is a meeting records tool for now)
- Removing date/time fields (kept for records accuracy)
- Scheduling / sending invites (future phase)

# External Attendees — Design

**Date:** 2026-03-22
**Status:** Approved

---

## Problem

All meeting attendees must currently be registered users in the org. This prevents logging sales calls, diagnostic sessions, and prospect meetings with external parties who are not in the system. It also prevents solo meetings (notes-only, no attendee required).

---

## Approach — Option A (approved)

Add a single `external_attendees TEXT NULL` column to `meetings`. Plain comma-separated names, display-only. Internal attendees become optional so solo and external-only meetings are valid. No new table, no new queries.

---

## Section 1 — Data Layer

- Migration adds `external_attendees TEXT NULL` to `meetings` — nullable, no default, no index
- Existing meetings unaffected (null = no external attendees)
- Internal attendee fields (`attendee_id` for 1:1/review, `meeting_attendees` rows for team/project) become optional — form no longer redirects if empty
- Solo meeting with no attendees at all is valid

---

## Section 2 — Form Changes

All four meeting type forms gain an optional "External attendees" text input below the existing attendee picker:

- Label: **External attendees** *(optional)*
- Placeholder: `e.g. John Smith, Sarah Jones`
- Input: free text, comma-separated names
- Submitted as `external_attendees` form field, stored as-is (trimmed, max 500 chars)

**1:1 and Performance Review:**
- Remove redirect when `attendee_id` is empty
- Auto-title fallback when no internal attendee selected: `"1:1 — 22 Mar 2026"` / `"Review — 22 Mar 2026"`
- If external names are provided but no internal attendee, use first external name in title: `"1:1 — John Smith — 22 Mar 2026"`

**Team and Project meetings:**
- No change to chip picker logic
- External names simply stored alongside internal attendees

---

## Section 3 — Meeting Detail View

On `/meetings/[id]`, the attendees section shows:
- Internal attendees (existing display, unchanged)
- External attendees line below, plain text — hidden if null/empty

---

## Files to Change

| File | Change |
|------|--------|
| `supabase/migrations/20260322000020_external_attendees.sql` | Add `external_attendees TEXT NULL` to meetings |
| `src/app/meetings/new/page.tsx` | Add external attendees input to all four form types |
| `src/app/meetings/new/actions.ts` | Extract, trim, and store `external_attendees`; relax attendee_id requirement for 1:1/review; use external name in title fallback |
| `src/app/meetings/[id]/page.tsx` | Display external attendees below internal attendees section |

---

## Out of Scope

- Email/company fields for external attendees (add to notes or CRM)
- Searching/filtering meetings by external attendee name
- External attendee follow-up or invitation flows

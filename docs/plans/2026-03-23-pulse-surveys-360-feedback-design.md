# Pulse Surveys & 360 Feedback Design

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add anonymous pulse surveys for team health checks and 360 feedback for upward manager assessment, with aggregated results, anonymity guarantees, and integration into the scoring system.

**Architecture:** Two separate modules sharing the same anonymity model (responses have no user_id, completions tracked separately). Pulse surveys are fully configurable; 360 feedback has fixed core questions + up to 3 custom. Both enforce a 3-response minimum before showing results.

**Tech Stack:** Next.js 16 App Router, Supabase (RLS + admin client), Server Actions, inline styles (matching existing codebase).

---

## Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| 360 result visibility | Manager + skip-level + admin | Growth-focused, encourages self-improvement |
| Separate vs shared module | Separate tables and pages | Different audiences, visibility rules, and result displays |
| 360 question model | Fixed core + up to 3 custom | Consistency across org, mirrors scoring system pattern |

---

## Pulse Surveys

### Schema

- `pulse_surveys` — definitions (name, description, frequency, questions JSONB, is_active)
- `pulse_periods` — open/close cycles per survey (period_label, opens_at, closes_at, is_closed)
- `pulse_responses` — anonymous (NO user_id), linked to period + team, contains answers JSONB
- `pulse_completions` — tracks who responded (user_id + team_id + period_id PK), not joinable to responses

### Question Types

| DB value | UI | Results display |
|---|---|---|
| `rating_5` | 1-5 number buttons | Average + distribution bar |
| `rating_10` | 1-10 number buttons | Average + distribution bar |
| `nps` | 0-10 buttons | NPS score (-100 to +100) |
| `yes_no` | Yes / No buttons | % Yes |
| `text` | Textarea | Anonymous pooled list (hidden if <3 text responses) |

### Pages

- `/admin/surveys` — create/manage surveys, list with question count and response rates
- `/admin/surveys/[id]` — setup tab (questions, periods) + results tab (team breakdown, best/worst)
- `/surveys` — employee view of open surveys
- `/surveys/[period_id]` — anonymous submission form

### Anonymity Model

| Table | Contains user_id? | Can link to response? |
|---|---|---|
| `pulse_responses` | No | — |
| `pulse_completions` | Yes | Only "did they respond", not "what" |

---

## 360 Feedback

### Schema

- `review_cycles` — admin creates cycles (name, opens_at, closes_at, is_closed, custom_questions JSONB)
- `review_responses` — anonymous (NO user_id), linked to cycle + manager_id + team_id, contains answers JSONB
- `review_completions` — tracks who submitted (user_id + manager_id + cycle_id PK), not joinable to responses

### Fixed Core Questions (rated 1-5, always included)

1. **Communication** — "How effectively does this manager communicate expectations and feedback?"
2. **Support & Development** — "How well does this manager support your growth and development?"
3. **Decision Making** — "How confident are you in this manager's decision-making?"
4. **Vision & Direction** — "How clearly does this manager set direction for the team?"
5. **Trust & Safety** — "How safe do you feel raising concerns or disagreements?"
6. **Open text** — "What could this manager do differently?" (hidden if <3 text responses)

### Custom Questions

Admin can add up to 3 extra questions per cycle (rating_5 or text type).

### Visibility Rules

- Manager sees their own aggregated results (averages, distribution) — never individual responses
- Skip-level manager sees all their direct managers' results
- Org admin sees everyone
- 3-response minimum before any results are shown

### Pages

- `/admin/360` — create/manage review cycles, org-wide manager comparison
- `/admin/360/[id]` — cycle detail: completion rates, per-manager results
- `/360` — employee view: which managers they need to review
- `/360/[cycle_id]` — anonymous review form for a specific manager

### Scoring Integration

Average 360 score feeds into the Manager Effectiveness / Team Development dimension as a data point alongside the existing score-delta metric.

---

## Dashboard Integration

### Sidebar

- All users: "My Surveys" → `/surveys`, "360 Reviews" → `/360`
- Admin section: "Pulse Surveys" → `/admin/surveys`, "360 Feedback" → `/admin/360`

### Homepage Widgets

- **Pulse** (all users): pending count or "All complete" checkmark
- **360** (all users): pending reviews count during open cycles
- **Admin pulse**: response rates, best/worst team from latest closed period
- **Admin 360**: completion rate, manager comparison from latest closed cycle

---

## Carry-Forward Fix

Meeting forms auto-select the most recent previous meeting of the same type as the "previous meeting" dropdown default, so open actions carry forward automatically.

# 360 Feedback & Sidebar Updates Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add 360 feedback (team assesses manager) with fixed core questions + custom, anonymous responses, and 3-response thresholds — plus sidebar nav links for both surveys and 360.

**Architecture:** Separate module from pulse surveys. Three tables (review_cycles, review_responses, review_completions) following the same anonymity model. Manager sees own aggregated results; skip-level and admin see all. Admin creates cycles, employees submit anonymous reviews of their managers.

**Tech Stack:** Next.js 16 App Router, Supabase with RLS + admin client, Server Actions (`'use server'`), inline styles matching existing codebase patterns.

**Existing patterns to follow:**
- Auth: `createClient()` → `getUser()` → query `users` for profile → redirect if not authorised
- Admin check: `profile.role !== 'admin'` → redirect `/?message=Unauthorised`
- Data access: `createAdminClient()` for cross-user reads
- Forms: `formAction={serverAction}`, hidden inputs for IDs, redirect with `?message=`
- Anonymity model: responses table has NO user_id; completions table tracks who responded but is not joinable

**Note:** Pulse surveys are already fully implemented (migration 014, all pages, dashboard widget). The carry-forward fix is already handled (auto-detect in meeting creation action). This plan only covers what's missing.

---

## Task 1: 360 Feedback Migration

**Files:**
- Create: `supabase/migrations/20260323000010_360_feedback.sql`

**Step 1: Write the migration**

```sql
-- ============================================================
-- 360 Feedback: review cycles, anonymous responses, completions
-- ============================================================

-- 1. Review cycles (admin creates these)
CREATE TABLE review_cycles (
  id              UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            VARCHAR(200) NOT NULL,
  description     TEXT,
  opens_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  closes_at       TIMESTAMPTZ,
  is_closed       BOOLEAN     NOT NULL DEFAULT false,
  custom_questions JSONB      NOT NULL DEFAULT '[]',
  -- each: {key, label, type:'rating_5'|'text', required}
  -- max 3 custom questions enforced in app layer
  created_by      UUID        REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE review_cycles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Org members read review cycles"  ON review_cycles FOR SELECT
  USING (organization_id = public.user_organization_id());
CREATE POLICY "Org admins manage review cycles" ON review_cycles FOR ALL
  USING (organization_id = public.user_organization_id() AND public.is_org_admin());

-- 2. Anonymous responses — DELIBERATELY no user_id
CREATE TABLE review_responses (
  id              UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  cycle_id        UUID        NOT NULL REFERENCES review_cycles(id)   ON DELETE CASCADE,
  organization_id UUID        NOT NULL REFERENCES organizations(id)   ON DELETE CASCADE,
  manager_id      UUID        NOT NULL REFERENCES users(id)           ON DELETE CASCADE,
  answers         JSONB       NOT NULL,
  -- fixed core: [{key:'communication',value:N}, {key:'support_development',value:N},
  --              {key:'decision_making',value:N}, {key:'vision_direction',value:N},
  --              {key:'trust_safety',value:N}, {key:'open_text',value:'...'}]
  -- plus any custom question answers
  submitted_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE review_responses ENABLE ROW LEVEL SECURITY;
-- Only org members can insert (app layer verifies they report to manager_id)
CREATE POLICY "Org members insert review responses" ON review_responses FOR INSERT
  WITH CHECK (organization_id = public.user_organization_id());
-- Admins can read all responses (aggregated in app layer)
CREATE POLICY "Org admins read review responses" ON review_responses FOR SELECT
  USING (organization_id = public.user_organization_id() AND public.is_org_admin());
-- Managers can read their own responses (aggregated in app layer, never with user identity)
CREATE POLICY "Managers read own review responses" ON review_responses FOR SELECT
  USING (organization_id = public.user_organization_id() AND manager_id = auth.uid());

-- 3. Completion tracking — who reviewed whom (separate, NOT joinable to responses)
CREATE TABLE review_completions (
  cycle_id     UUID        NOT NULL REFERENCES review_cycles(id) ON DELETE CASCADE,
  user_id      UUID        NOT NULL REFERENCES users(id)         ON DELETE CASCADE,
  manager_id   UUID        NOT NULL REFERENCES users(id)         ON DELETE CASCADE,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (cycle_id, user_id, manager_id)
);
ALTER TABLE review_completions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own completions" ON review_completions FOR SELECT
  USING (user_id = auth.uid());
CREATE POLICY "Users insert own completions" ON review_completions FOR INSERT
  WITH CHECK (user_id = auth.uid() AND EXISTS (
    SELECT 1 FROM review_cycles rc WHERE rc.id = cycle_id
      AND rc.organization_id = public.user_organization_id()
  ));
CREATE POLICY "Admins read all completions" ON review_completions FOR SELECT
  USING (public.is_org_admin());

-- Index for fast lookups
CREATE INDEX idx_review_responses_cycle_manager ON review_responses(cycle_id, manager_id);
CREATE INDEX idx_review_completions_cycle ON review_completions(cycle_id);
```

**Step 2: Commit**

```bash
git add supabase/migrations/20260323000010_360_feedback.sql
git commit -m "feat(schema): add 360 feedback tables (review cycles, anonymous responses, completions)"
```

---

## Task 2: 360 Admin Actions

**Files:**
- Create: `src/app/admin/360/actions.ts`

**Step 1: Write server actions**

```typescript
'use server'

import { createClient } from '@/utils/supabase/server'
import { createAdminClient } from '@/utils/supabase/admin'
import { redirect } from 'next/navigation'

// ── Auth helper ──────────────────────────────────────────────

async function verifyOrgAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users')
    .select('id, organization_id, role')
    .eq('id', user.id)
    .single()

  if (!profile) redirect('/login')
  if (profile.role !== 'admin') redirect('/?message=Unauthorised')

  return { adminClient: createAdminClient(), user, profile }
}

function toFieldKey(label: string): string {
  return label.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

// ── Cycle CRUD ───────────────────────────────────────────────

export async function createCycle(formData: FormData) {
  const { adminClient, profile } = await verifyOrgAdmin()

  const name = (formData.get('name') as string)?.trim()
  if (!name) redirect('/admin/360?message=Name is required')

  const description = (formData.get('description') as string)?.trim() || null
  const opensAt = (formData.get('opens_at') as string) || new Date().toISOString()

  const { data: cycle, error } = await adminClient
    .from('review_cycles')
    .insert({
      organization_id: profile.organization_id,
      name,
      description,
      opens_at: opensAt,
      created_by: profile.id,
    })
    .select('id')
    .single()

  if (error || !cycle) redirect('/admin/360?message=Failed to create cycle')
  redirect(`/admin/360/${cycle.id}?message=Cycle created`)
}

export async function closeCycle(formData: FormData) {
  const { adminClient, profile } = await verifyOrgAdmin()

  const cycleId = formData.get('cycle_id') as string
  if (!cycleId) redirect('/admin/360?message=Missing cycle ID')

  await adminClient
    .from('review_cycles')
    .update({ is_closed: true, closes_at: new Date().toISOString() })
    .eq('id', cycleId)
    .eq('organization_id', profile.organization_id)

  redirect(`/admin/360/${cycleId}?message=Cycle closed`)
}

export async function reopenCycle(formData: FormData) {
  const { adminClient, profile } = await verifyOrgAdmin()

  const cycleId = formData.get('cycle_id') as string
  if (!cycleId) redirect('/admin/360?message=Missing cycle ID')

  await adminClient
    .from('review_cycles')
    .update({ is_closed: false, closes_at: null })
    .eq('id', cycleId)
    .eq('organization_id', profile.organization_id)

  redirect(`/admin/360/${cycleId}?message=Cycle reopened`)
}

export async function addCustomQuestion(formData: FormData) {
  const { adminClient, profile } = await verifyOrgAdmin()

  const cycleId = formData.get('cycle_id') as string
  const label   = (formData.get('label') as string)?.trim()
  const type    = (formData.get('type') as string) || 'rating_5'

  if (!cycleId || !label) redirect(`/admin/360/${cycleId}?message=Label is required`)
  if (!['rating_5', 'text'].includes(type)) redirect(`/admin/360/${cycleId}?message=Invalid question type`)

  const { data: cycle } = await adminClient
    .from('review_cycles')
    .select('custom_questions')
    .eq('id', cycleId)
    .eq('organization_id', profile.organization_id)
    .single()

  if (!cycle) redirect('/admin/360?message=Cycle not found')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const questions = (cycle.custom_questions as any[]) ?? []
  if (questions.length >= 3) redirect(`/admin/360/${cycleId}?message=Maximum 3 custom questions`)

  let key = toFieldKey(label)
  const existingKeys = new Set(questions.map((q: { key: string }) => q.key))
  let suffix = 1
  while (existingKeys.has(key)) { key = `${toFieldKey(label)}_${suffix++}` }

  questions.push({ key, label, type, required: false })

  await adminClient
    .from('review_cycles')
    .update({ custom_questions: questions })
    .eq('id', cycleId)
    .eq('organization_id', profile.organization_id)

  redirect(`/admin/360/${cycleId}?message=Question added`)
}

export async function removeCustomQuestion(formData: FormData) {
  const { adminClient, profile } = await verifyOrgAdmin()

  const cycleId     = formData.get('cycle_id') as string
  const questionKey = formData.get('question_key') as string

  if (!cycleId || !questionKey) redirect(`/admin/360/${cycleId}?message=Missing data`)

  const { data: cycle } = await adminClient
    .from('review_cycles')
    .select('custom_questions')
    .eq('id', cycleId)
    .eq('organization_id', profile.organization_id)
    .single()

  if (!cycle) redirect('/admin/360?message=Cycle not found')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const questions = ((cycle.custom_questions as any[]) ?? []).filter(
    (q: { key: string }) => q.key !== questionKey
  )

  await adminClient
    .from('review_cycles')
    .update({ custom_questions: questions })
    .eq('id', cycleId)
    .eq('organization_id', profile.organization_id)

  redirect(`/admin/360/${cycleId}?message=Question removed`)
}
```

**Step 2: Commit**

```bash
git add src/app/admin/360/actions.ts
git commit -m "feat: add 360 feedback admin server actions"
```

---

## Task 3: 360 Admin List Page

**Files:**
- Create: `src/app/admin/360/page.tsx`

**Context:**
- Follow the same pattern as `src/app/admin/surveys/page.tsx`
- Auth: admin only
- List all review cycles with name, status (open/closed badge), response count, completion rate
- "Create Cycle" form at top: name (required), description (optional), opens_at (datetime-local, defaults to now)
- Each row links to `/admin/360/[id]`

**Step 1: Write the page**

```typescript
import { createClient } from '@/utils/supabase/server'
import { createAdminClient } from '@/utils/supabase/admin'
import { redirect } from 'next/navigation'
import { createCycle } from './actions'
import PageShell from '@/components/PageShell'

export default async function Admin360Page({
  searchParams,
}: {
  searchParams: Promise<{ message?: string }>
}) {
  const { message } = await searchParams

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users')
    .select('id, organization_id, role')
    .eq('id', user.id)
    .single()

  if (!profile) redirect('/login')
  if (profile.role !== 'admin') redirect('/?message=Unauthorised')

  const adminClient = createAdminClient()

  // Load all cycles for this org
  const { data: cycles } = await adminClient
    .from('review_cycles')
    .select('id, name, description, is_closed, opens_at, closes_at, custom_questions, created_at')
    .eq('organization_id', profile.organization_id)
    .order('created_at', { ascending: false })

  // For each cycle, get response + completion counts
  const cycleStats: Array<{
    cycle: (typeof cycles extends (infer T)[] | null ? T : never)
    responseCount: number
    completionCount: number
    managerCount: number
  }> = []

  for (const cycle of cycles ?? []) {
    const { count: responseCount } = await adminClient
      .from('review_responses')
      .select('id', { count: 'exact', head: true })
      .eq('cycle_id', cycle.id as string)
      .eq('organization_id', profile.organization_id)

    const { count: completionCount } = await adminClient
      .from('review_completions')
      .select('cycle_id', { count: 'exact', head: true })
      .eq('cycle_id', cycle.id as string)

    // Count distinct managers who have at least one response
    const { data: managerRows } = await adminClient
      .from('review_responses')
      .select('manager_id')
      .eq('cycle_id', cycle.id as string)
      .eq('organization_id', profile.organization_id)

    const uniqueManagers = new Set((managerRows ?? []).map(r => r.manager_id as string))

    cycleStats.push({
      cycle,
      responseCount: responseCount ?? 0,
      completionCount: completionCount ?? 0,
      managerCount: uniqueManagers.size,
    })
  }

  const isSuccess = message && (message.includes('created') || message.includes('closed') || message.includes('reopened'))

  return (
    <PageShell>
    <div className="page-content">
      <div className="page-header">
        <div>
          <h1 className="page-title">360 Feedback</h1>
          <p className="page-subtitle">Create review cycles for anonymous upward feedback on managers.</p>
        </div>
      </div>

      {message && (
        <div style={{
          padding: '0.75rem 1rem', borderRadius: '6px', marginBottom: '1.25rem',
          backgroundColor: isSuccess ? '#f0fdf4' : '#fef2f2',
          border: `1px solid ${isSuccess ? '#86efac' : '#fca5a5'}`,
          color: isSuccess ? '#166534' : '#991b1b',
          fontSize: '0.875rem',
        }}>
          {message}
        </div>
      )}

      {/* Create cycle form */}
      <div className="card" style={{ marginBottom: '1.25rem' }}>
        <div className="card-header"><h3 className="card-title">New Review Cycle</h3></div>
        <div className="card-body">
          <form action={createCycle}>
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div style={{ flex: '1 1 200px' }}>
                <label className="form-label">Name *</label>
                <input name="name" required className="form-input" placeholder="Q1 2026 Manager Review" />
              </div>
              <div style={{ flex: '1 1 200px' }}>
                <label className="form-label">Description</label>
                <input name="description" className="form-input" placeholder="Optional description" />
              </div>
              <div style={{ flex: '0 0 auto' }}>
                <label className="form-label">Opens</label>
                <input name="opens_at" type="datetime-local" className="form-input"
                  defaultValue={new Date().toISOString().slice(0, 16)} />
              </div>
              <button type="submit" className="btn btn-primary">Create Cycle</button>
            </div>
          </form>
        </div>
      </div>

      {/* Cycles list */}
      {cycleStats.length === 0 ? (
        <div className="card">
          <div className="card-body" style={{ textAlign: 'center', padding: '2.5rem' }}>
            <p style={{ margin: '0 0 0.5rem 0', fontWeight: 500, color: 'var(--text)' }}>No review cycles yet</p>
            <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text-muted)' }}>
              Create your first 360 review cycle to start collecting anonymous manager feedback.
            </p>
          </div>
        </div>
      ) : (
        <div className="card">
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
            <thead>
              <tr style={{ backgroundColor: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)' }}>
                <th style={{ textAlign: 'left', padding: '0.5rem 0.875rem', fontWeight: 600 }}>Cycle</th>
                <th style={{ textAlign: 'center', padding: '0.5rem 0.875rem', fontWeight: 600 }}>Status</th>
                <th style={{ textAlign: 'right', padding: '0.5rem 0.875rem', fontWeight: 600 }}>Responses</th>
                <th style={{ textAlign: 'right', padding: '0.5rem 0.875rem', fontWeight: 600 }}>Managers</th>
                <th style={{ textAlign: 'right', padding: '0.5rem 0.875rem', fontWeight: 600 }}>Completions</th>
                <th style={{ padding: '0.5rem 0.875rem' }}></th>
              </tr>
            </thead>
            <tbody>
              {cycleStats.map(({ cycle, responseCount, completionCount, managerCount }, idx) => (
                <tr key={cycle.id as string} style={{ borderBottom: idx < cycleStats.length - 1 ? '1px solid var(--border-light)' : 'none' }}>
                  <td style={{ padding: '0.625rem 0.875rem' }}>
                    <div style={{ fontWeight: 500, color: 'var(--text)' }}>{cycle.name as string}</div>
                    {cycle.description && (
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.125rem' }}>{cycle.description as string}</div>
                    )}
                  </td>
                  <td style={{ padding: '0.625rem 0.875rem', textAlign: 'center' }}>
                    <span className={`badge ${cycle.is_closed ? 'badge-muted' : 'badge-green'}`}>
                      {cycle.is_closed ? 'Closed' : 'Open'}
                    </span>
                  </td>
                  <td style={{ padding: '0.625rem 0.875rem', textAlign: 'right', color: 'var(--text-muted)' }}>
                    {responseCount}
                  </td>
                  <td style={{ padding: '0.625rem 0.875rem', textAlign: 'right', color: 'var(--text-muted)' }}>
                    {managerCount}
                  </td>
                  <td style={{ padding: '0.625rem 0.875rem', textAlign: 'right', color: 'var(--text-muted)' }}>
                    {completionCount}
                  </td>
                  <td style={{ padding: '0.625rem 0.875rem', textAlign: 'right' }}>
                    <a href={`/admin/360/${cycle.id as string}`} style={{ fontSize: '0.75rem', color: 'var(--primary)', textDecoration: 'none' }}>
                      Manage →
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
    </PageShell>
  )
}
```

**Step 2: Commit**

```bash
git add src/app/admin/360/page.tsx
git commit -m "feat: add 360 feedback admin list page"
```

---

## Task 4: 360 Admin Detail Page (Setup + Results)

**Files:**
- Create: `src/app/admin/360/[id]/page.tsx`

**Context:**
- Follow `src/app/admin/surveys/[id]/page.tsx` pattern (two tabs: Setup | Results)
- **Setup tab**: shows fixed core questions (read-only), custom questions list with Remove button, "Add Custom Question" form, Close/Reopen cycle button
- **Results tab**: for each manager with 3+ responses, show aggregated scores per core question (avg, distribution), custom question results, and pooled anonymous text. Managers with <3 responses show "Not enough responses yet". Admin and skip-level visibility.
- The page needs to determine which users are managers (have direct reports) in the org

**Step 1: Write the page**

The page should:

1. Auth check: admin only (or manager viewing their own reports — handled via a separate user-facing page)
2. Load the cycle by ID with `organization_id` check
3. Load all responses for this cycle grouped by `manager_id`
4. Load all completions for this cycle
5. Load org's managers (users who have at least one direct report: `SELECT DISTINCT manager_id FROM users WHERE organization_id = ? AND manager_id IS NOT NULL`)
6. For each manager: count responses, compute averages per question, pool text answers
7. Display Setup tab (core questions info, custom questions management, cycle controls)
8. Display Results tab (manager cards with scores, 3-response threshold)

Fixed core questions constant (used for display):
```typescript
const CORE_QUESTIONS = [
  { key: 'communication',       label: 'Communication',         description: 'How effectively does this manager communicate expectations and feedback?' },
  { key: 'support_development', label: 'Support & Development', description: 'How well does this manager support your growth and development?' },
  { key: 'decision_making',     label: 'Decision Making',       description: 'How confident are you in this manager\'s decision-making?' },
  { key: 'vision_direction',    label: 'Vision & Direction',    description: 'How clearly does this manager set direction for the team?' },
  { key: 'trust_safety',        label: 'Trust & Safety',        description: 'How safe do you feel raising concerns or disagreements?' },
]

const OPEN_TEXT_KEY = 'open_text'
```

The results section should show:
- Manager name, response count, average across all core questions
- Per-question average with a visual bar (0-5 scale)
- Distribution: count of 1s, 2s, 3s, 4s, 5s
- Custom rating questions: same treatment
- Text responses: anonymous bullet list (hidden if <3 text answers for that manager)
- Sort managers by average score descending
- Highlight best (green badge) and worst (red badge) managers

The full implementation should be ~350-450 lines following the exact inline style patterns from the existing admin survey detail page. Import `closeCycle`, `reopenCycle`, `addCustomQuestion`, `removeCustomQuestion` from `../actions`.

**Step 2: Commit**

```bash
git add src/app/admin/360/[id]/page.tsx
git commit -m "feat: add 360 feedback admin detail page with setup and results tabs"
```

---

## Task 5: Employee 360 Review Pages

**Files:**
- Create: `src/app/360/page.tsx`
- Create: `src/app/360/[cycle_id]/page.tsx`
- Create: `src/app/360/[cycle_id]/actions.ts`

**Context:**
- Follow `src/app/surveys/page.tsx` and `src/app/surveys/[period_id]/page.tsx` patterns

### 5a: `/360/page.tsx` — List of pending/completed reviews

- Auth: any org member (redirect platform admins without org to `/`)
- Load open review cycles for org (not closed)
- Load user's manager_id from profile
- Load user's completions for open cycles
- Show pending reviews: one card per open cycle where not yet completed for their manager
  - "Q1 2026 Manager Review · Open until [closes_at or 'No end date']"
  - Link: `/360/[cycle_id]`
- Show completed (greyed, checkmark)
- If user has no manager (`manager_id IS NULL`): "You don't have a reporting manager assigned. Contact your admin."

### 5b: `/360/[cycle_id]/page.tsx` — Review submission form

- Auth: any org member
- Load cycle + check it's open
- Load user's manager from profile (must have one)
- Check completions: if already submitted → "Already submitted" state with green banner
- Display review form:
  - Header: "🔒 This review is completely anonymous — your responses cannot be linked to you."
  - Manager name shown: "You are reviewing: [Manager Name]"
  - 5 core questions: each shows label + description, with 1-5 radio-style number buttons
  - Custom questions (from cycle.custom_questions): rating_5 buttons or textarea
  - Open text: "What could this manager do differently?" textarea (optional, max 500 chars)
  - "Submit anonymously" button

### 5c: `/360/[cycle_id]/actions.ts` — Submit response

```typescript
'use server'

import { createClient } from '@/utils/supabase/server'
import { createAdminClient } from '@/utils/supabase/admin'
import { redirect } from 'next/navigation'

export async function submitReview(formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users')
    .select('id, organization_id, manager_id')
    .eq('id', user.id)
    .single()

  if (!profile) redirect('/login')
  if (!profile.manager_id) redirect('/360?message=No manager assigned')

  const adminClient = createAdminClient()
  const cycleId = formData.get('cycle_id') as string
  if (!cycleId) redirect('/360?message=Missing cycle')

  // Verify cycle exists, is open, belongs to org
  const { data: cycle } = await adminClient
    .from('review_cycles')
    .select('id, is_closed, custom_questions')
    .eq('id', cycleId)
    .eq('organization_id', profile.organization_id)
    .single()

  if (!cycle) redirect('/360?message=Review cycle not found')
  if (cycle.is_closed) redirect('/360?message=This review cycle has closed')

  // Check for duplicate submission
  const { data: existing } = await adminClient
    .from('review_completions')
    .select('cycle_id')
    .eq('cycle_id', cycleId)
    .eq('user_id', user.id)
    .eq('manager_id', profile.manager_id)
    .maybeSingle()

  if (existing) redirect('/360?message=You have already submitted this review')

  // Build answers array from form data
  const coreKeys = ['communication', 'support_development', 'decision_making', 'vision_direction', 'trust_safety']
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const answers: Array<{ key: string; value: any }> = []

  for (const key of coreKeys) {
    const val = formData.get(key)
    if (val) answers.push({ key, value: Number(val) })
  }

  // Open text
  const openText = (formData.get('open_text') as string)?.trim()
  if (openText) answers.push({ key: 'open_text', value: openText })

  // Custom questions
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const customQs = (cycle.custom_questions as any[]) ?? []
  for (const q of customQs) {
    const val = formData.get(q.key as string)
    if (val) {
      answers.push({
        key: q.key as string,
        value: q.type === 'rating_5' ? Number(val) : (val as string).trim(),
      })
    }
  }

  // 1. Insert completion (PK rejects duplicates)
  const { error: compError } = await adminClient
    .from('review_completions')
    .insert({
      cycle_id: cycleId,
      user_id: user.id,
      manager_id: profile.manager_id,
    })

  if (compError) {
    redirect('/360?message=You have already submitted this review')
  }

  // 2. Insert anonymous response (NO user_id)
  await adminClient
    .from('review_responses')
    .insert({
      cycle_id: cycleId,
      organization_id: profile.organization_id,
      manager_id: profile.manager_id,
      answers,
    })

  redirect('/360?message=Thank you! Your review has been recorded anonymously.')
}
```

**Step 2: Commit**

```bash
git add src/app/360/page.tsx src/app/360/[cycle_id]/page.tsx src/app/360/[cycle_id]/actions.ts
git commit -m "feat: add employee 360 review pages (list, form, submission)"
```

---

## Task 6: Sidebar Nav Links

**Files:**
- Modify: `src/components/Sidebar.tsx`

**Context:**
- Add a `surveys` icon (clipboard/poll icon) to the icons object
- Add nav links for both surveys and 360

**Step 1: Add icon and links**

Add a `surveys` icon to the icons object (a clipboard-style SVG matching the existing strokeWidth="1.4" pattern).

Add to both the `isPlatformAdmin && hasOrg` block AND the regular user block:
- After "My Scores" (and "Team Rankings" for managers): add `{ label: 'My Surveys', href: '/surveys', icon: 'surveys' }` and `{ label: '360 Reviews', href: '/360', icon: 'surveys' }`
- In the admin section: add `{ label: 'Pulse Surveys', href: '/admin/surveys', icon: 'surveys' }` and `{ label: '360 Feedback', href: '/admin/360', icon: 'surveys' }`

**Step 2: Commit**

```bash
git add src/components/Sidebar.tsx
git commit -m "feat: add sidebar nav links for pulse surveys and 360 feedback"
```

---

## Task 7: Dashboard 360 Widget

**Files:**
- Modify: `src/app/page.tsx`

**Context:**
- Add a 360 feedback widget to the homepage dashboard, alongside the existing pulse surveys widget
- Follow the existing pulse surveys widget pattern in the "Row 2: Projects + Pulse" section

**Step 1: Add 360 data loading**

After the pulse surveys data loading block (around line 145-195), add:

```typescript
// 8. 360 Feedback
let pending360Count = 0
let has360Cycles = false
let admin360Stats: { bestManager: string | null; worstManager: string | null; responseCount: number; cycleName: string } | null = null

const { data: activeCycles } = await adminClient
  .from('review_cycles').select('id')
  .eq('organization_id', profile.organization_id)
  .eq('is_closed', false)

has360Cycles = (activeCycles ?? []).length > 0

if (has360Cycles && profile.manager_id) {
  // Count pending reviews for this user
  for (const cycle of activeCycles ?? []) {
    const { data: completion } = await adminClient
      .from('review_completions')
      .select('cycle_id')
      .eq('cycle_id', cycle.id as string)
      .eq('user_id', profile.id)
      .eq('manager_id', profile.manager_id)
      .maybeSingle()

    if (!completion) pending360Count++
  }
}

if (isAdmin) {
  // Get latest closed cycle for admin stats
  const { data: latestClosed } = await adminClient
    .from('review_cycles')
    .select('id, name')
    .eq('organization_id', profile.organization_id)
    .eq('is_closed', true)
    .order('closes_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (latestClosed) {
    const { data: responses } = await adminClient
      .from('review_responses')
      .select('manager_id, answers')
      .eq('cycle_id', latestClosed.id as string)
      .eq('organization_id', profile.organization_id)

    if (responses && responses.length > 0) {
      // Group by manager, compute averages
      const byManager = new Map<string, number[]>()
      for (const r of responses) {
        const mid = r.manager_id as string
        if (!byManager.has(mid)) byManager.set(mid, [])
        const numericAnswers = ((r.answers as Array<{key: string; value: unknown}>) ?? [])
          .filter(a => typeof a.value === 'number')
          .map(a => a.value as number)
        byManager.get(mid)!.push(...numericAnswers)
      }

      // Find best/worst
      let best: { id: string; avg: number } | null = null
      let worst: { id: string; avg: number } | null = null
      for (const [mid, scores] of byManager) {
        if (scores.length < 3) continue // 3-response threshold
        const avg = scores.reduce((a, b) => a + b, 0) / scores.length
        if (!best || avg > best.avg) best = { id: mid, avg }
        if (!worst || avg < worst.avg) worst = { id: mid, avg }
      }

      // Look up names
      const ids = [best?.id, worst?.id].filter(Boolean) as string[]
      const { data: managers } = ids.length > 0
        ? await adminClient.from('users').select('id, full_name').in('id', ids)
        : { data: [] }

      const nameMap = new Map((managers ?? []).map(m => [m.id as string, m.full_name as string]))

      admin360Stats = {
        bestManager: best ? nameMap.get(best.id) ?? null : null,
        worstManager: worst && worst.id !== best?.id ? nameMap.get(worst.id) ?? null : null,
        responseCount: responses.length,
        cycleName: latestClosed.name as string,
      }
    }
  }
}
```

**Step 2: Add 360 widget to the grid**

Update the "Row 2" section to include the 360 widget. The grid should now accommodate Projects, Pulse Surveys, and 360 Feedback. Adjust the `gridTemplateColumns` to handle up to 3 cards.

The 360 widget follows the same card pattern as pulse:
- Non-admin: pending count with "Review →" link, or "All reviews submitted" checkmark, or "No manager assigned" if no manager_id
- Admin: latest closed cycle name, response count, best/worst manager badges

**Step 3: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat: add 360 feedback dashboard widget"
```

---

## Task 8: Build Verification

**Step 1: Run build**

```bash
npx next build
```

Expected: clean compilation with new routes:
- `/admin/360`
- `/admin/360/[id]`
- `/360`
- `/360/[cycle_id]`

All existing routes should still compile.

**Step 2: Commit and push**

```bash
git push origin feat/ranking-scoring-system
```

---

## Implementation Order Summary

| Task | Description | New Files | Modified Files |
|------|-------------|-----------|----------------|
| 1 | Migration | 1 | 0 |
| 2 | Admin actions | 1 | 0 |
| 3 | Admin list page | 1 | 0 |
| 4 | Admin detail page | 1 | 0 |
| 5 | Employee pages + actions | 3 | 0 |
| 6 | Sidebar nav links | 0 | 1 |
| 7 | Dashboard widget | 0 | 1 |
| 8 | Build verification | 0 | 0 |

**Total: 7 new files, 2 modified files, 1 migration**

import { createAdminClient } from '@/utils/supabase/admin'
import type { ScoreConfig } from './types'

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

export async function computeExecution(
  userId: string,
  orgId: string,
  windowStart: string,
  config: ScoreConfig,
): Promise<{ score: number; dataPoints: number } | null> {
  const supabase = createAdminClient()

  // Fetch action items for user in window
  const { data: actions, error } = await supabase
    .from('action_items')
    .select('id, status, due_date, completed_at, is_closed')
    .eq('organization_id', orgId)
    .eq('assignee_id', userId)
    .gte('created_at', windowStart)

  if (error) throw error
  if (!actions || actions.length < config.min_actions_system) return null

  const total = actions.length
  const completed = actions.filter(
    (a) => a.status === 'complete' || a.is_closed,
  ).length
  const completionRate = total > 0 ? completed / total : 0

  // On-time rate: completed before due_date among actions that have due dates
  const withDueDate = actions.filter((a) => a.due_date != null)
  let onTimeRate = 0.5 // default if no due dates
  if (withDueDate.length > 0) {
    const completedOnTime = withDueDate.filter(
      (a) =>
        (a.status === 'complete' || a.is_closed) &&
        a.completed_at != null &&
        a.completed_at <= a.due_date,
    ).length
    onTimeRate = completedOnTime / withDueDate.length
  }

  // Milestone hit rate
  const { data: milestones, error: mErr } = await supabase
    .from('milestones')
    .select('id, status')
    .eq('organization_id', orgId)
    .eq('owner_id', userId)
    .gte('created_at', windowStart)

  if (mErr) throw mErr

  let milestoneHitRate = 0.5 // default if no milestones
  if (milestones && milestones.length > 0) {
    const completedMilestones = milestones.filter(
      (m) => m.status === 'complete',
    ).length
    milestoneHitRate = completedMilestones / milestones.length
  }

  const base =
    completionRate * 0.5 + onTimeRate * 0.3 + milestoneHitRate * 0.2
  const score = clamp(1.0 + base * 8.0, 1, 9)

  return { score: round2(score), dataPoints: total }
}

// ---------------------------------------------------------------------------
// Reliability
// ---------------------------------------------------------------------------

export async function computeReliability(
  userId: string,
  orgId: string,
  windowStart: string,
  config: ScoreConfig,
): Promise<{ score: number; dataPoints: number } | null> {
  const supabase = createAdminClient()

  const { data: actions, error } = await supabase
    .from('action_items')
    .select('id, status, due_date, completed_at, is_closed, created_at')
    .eq('organization_id', orgId)
    .eq('assignee_id', userId)
    .gte('created_at', windowStart)

  if (error) throw error
  if (!actions || actions.length < config.min_actions_system) return null

  const actionIds = actions.map((a) => a.id)

  // Carry-forward rate from action_reviews
  const { data: reviews, error: rErr } = await supabase
    .from('action_reviews')
    .select('action_id, outcome')
    .in('action_id', actionIds)

  if (rErr) throw rErr

  let carryForwardRate = 0
  if (reviews && reviews.length > 0) {
    const ongoing = reviews.filter((r) => r.outcome === 'ongoing').length
    carryForwardRate = ongoing / reviews.length
  }

  // Overdue rate: open actions past due_date / open actions with due dates
  const openActions = actions.filter(
    (a) => a.status !== 'complete' && !a.is_closed,
  )
  const openWithDue = openActions.filter((a) => a.due_date != null)
  let overdueRate = 0
  if (openWithDue.length > 0) {
    const now = new Date().toISOString()
    const overdue = openWithDue.filter((a) => a.due_date < now).length
    overdueRate = overdue / openWithDue.length
  }

  // Consistency: stddev of monthly completion rates
  const monthlyMap = new Map<string, { total: number; completed: number }>()
  for (const a of actions) {
    const month = (a.created_at as string).slice(0, 7) // YYYY-MM
    const entry = monthlyMap.get(month) ?? { total: 0, completed: 0 }
    entry.total++
    if (a.status === 'complete' || a.is_closed) entry.completed++
    monthlyMap.set(month, entry)
  }

  const monthlyRates = Array.from(monthlyMap.values()).map((e) =>
    e.total > 0 ? e.completed / e.total : 0,
  )

  let consistency = 0
  if (monthlyRates.length > 1) {
    const mean =
      monthlyRates.reduce((s, v) => s + v, 0) / monthlyRates.length
    const variance =
      monthlyRates.reduce((s, v) => s + (v - mean) ** 2, 0) /
      monthlyRates.length
    const stddev = Math.sqrt(variance)
    consistency = Math.min(stddev / 0.5, 1)
  }

  const base =
    (1 - carryForwardRate) * 0.4 +
    (1 - overdueRate) * 0.4 +
    (1 - consistency) * 0.2
  const score = clamp(1.0 + base * 8.0, 1, 9)

  return { score: round2(score), dataPoints: actions.length }
}

// ---------------------------------------------------------------------------
// Collaboration
// ---------------------------------------------------------------------------

export interface OrgMedians {
  projects: number
  meetings: number
  delegated: number
}

export async function computeCollaboration(
  userId: string,
  orgId: string,
  windowStart: string,
  config: ScoreConfig,
  orgMedians: OrgMedians,
): Promise<{ score: number; dataPoints: number } | null> {
  const supabase = createAdminClient()

  // Distinct projects (owned or has actions in)
  const { data: ownedProjects } = await supabase
    .from('projects')
    .select('id')
    .eq('organization_id', orgId)
    .eq('owner_id', userId)
    .gte('created_at', windowStart)

  const { data: actionProjects } = await supabase
    .from('action_items')
    .select('project_id')
    .eq('organization_id', orgId)
    .eq('assignee_id', userId)
    .gte('created_at', windowStart)
    .not('project_id', 'is', null)

  const projectIds = new Set<string>()
  ownedProjects?.forEach((p) => projectIds.add(p.id))
  actionProjects?.forEach((a) => {
    if (a.project_id) projectIds.add(a.project_id)
  })
  const projectCount = projectIds.size

  // Meetings attended or organised
  const { data: meetings } = await supabase
    .from('meetings')
    .select('id')
    .eq('organization_id', orgId)
    .or(`organizer_id.eq.${userId},attendee_id.eq.${userId}`)
    .gte('date', windowStart)

  const meetingCount = meetings?.length ?? 0

  // Actions delegated: in meetings user organised, assigned to others
  const { data: organisedMeetings } = await supabase
    .from('meetings')
    .select('id')
    .eq('organization_id', orgId)
    .eq('organizer_id', userId)
    .gte('date', windowStart)

  let delegatedCount = 0
  if (organisedMeetings && organisedMeetings.length > 0) {
    const meetingIds = organisedMeetings.map((m) => m.id)
    const { data: delegatedActions } = await supabase
      .from('action_items')
      .select('id')
      .in('meeting_id', meetingIds)
      .neq('assignee_id', userId)

    delegatedCount = delegatedActions?.length ?? 0
  }

  const totalDataPoints = projectCount + meetingCount + delegatedCount
  if (totalDataPoints < config.min_actions_system) return null

  // Normalise each against org median
  const normProjects =
    orgMedians.projects > 0
      ? Math.min(projectCount / (orgMedians.projects * 2), 1)
      : 0.5
  const normMeetings =
    orgMedians.meetings > 0
      ? Math.min(meetingCount / (orgMedians.meetings * 2), 1)
      : 0.5
  const normDelegated =
    orgMedians.delegated > 0
      ? Math.min(delegatedCount / (orgMedians.delegated * 2), 1)
      : 0.5

  const base =
    normProjects * 0.4 + normMeetings * 0.3 + normDelegated * 0.3
  const score = clamp(1.0 + Math.min(1, base) * 8.0, 1, 9)

  return { score: round2(score), dataPoints: totalDataPoints }
}
